import { buildNull } from "runtime";
import type { AnyValue } from "runtime";
import type { StateModel } from "../types/turnout-model_pb.js";
import { StateError } from "../executor/errors.js";
import type { StateManager } from "./state-types.js";
import { assertSafePath, assertKnownPath, assertValidWrite } from "./state-validation.js";
import { matchesSchemaType } from "./schema-types.js";
import { literalToValue } from "./state-proto.js";

// Re-export everything so existing importers stay unchanged.
export type { StateReader, StateManager } from "./state-types.js";
export { protoValueToJs, literalToValue } from "./state-proto.js";
export { matchesSchemaType } from "./schema-types.js";
export { assertSafePath } from "./state-validation.js";

function make(
  state: Record<string, AnyValue>,
  validPaths: ReadonlySet<string> | null,
  typeMap: ReadonlyMap<string, string> | null = null,
): StateManager {
  return {
    read: (path) => {
      assertKnownPath(path, validPaths);
      return state[path] ?? buildNull("missing");
    },
    isDeclared: (path) => {
      assertSafePath(path);
      if (validPaths === null) return true;
      return validPaths.has(path);
    },
    exists: (path) => {
      assertSafePath(path);
      return Object.prototype.hasOwnProperty.call(state, path);
    },
    write: (path, value) => {
      assertValidWrite(path, value, validPaths, typeMap);
      return make({ ...state, [path]: value }, validPaths, typeMap);
    },
    writeBatch: (batch) => {
      const newState = { ...state };
      for (const [path, value] of Object.entries(batch)) {
        assertValidWrite(path, value, validPaths, typeMap);
        newState[path] = value;
      }
      return make(newState, validPaths, typeMap);
    },
    snapshot: () => ({ ...state }),
    forEach: (cb) => {
      for (const [path, value] of Object.entries(state)) {
        cb(path, value as AnyValue);
      }
    },
    validPaths: () => validPaths,
    isSchemaManaged: () => validPaths !== null,
    readOrUndefined: (path) => {
      assertSafePath(path);
      if (validPaths !== null && !validPaths.has(path)) return undefined;
      return state[path];
    },
  };
}

/**
 * Create a StateManager from a flat initial state record with no path
 * validation. Any `write()` call succeeds regardless of the path, making this
 * constructor suitable for partial or ad-hoc states where the full schema is
 * not available. Use `stateManagerFromStrict` or `stateManagerFromSchema` when
 * typo-safety matters.
 */
export function stateManagerFromUnchecked(initial: Record<string, AnyValue>): StateManager {
  for (const key of Object.keys(initial)) assertSafePath(key);
  return make({ ...initial }, null);
}

/**
 * Create a StateManager from a flat initial state record, enforcing that every
 * subsequent `write()` targets one of the paths in `validPaths`. Throws
 * immediately on an unknown path, making it safe to use in tests where typo'd
 * state paths should surface as hard errors.
 *
 * When `typeMap` is provided, `write()` also validates that the value's runtime
 * type matches the declared schema type for that path.
 */
export function stateManagerFromStrict(
  initial: Record<string, AnyValue>,
  validPaths: ReadonlySet<string>,
  typeMap?: ReadonlyMap<string, string>,
): StateManager {
  for (const key of Object.keys(initial)) {
    assertSafePath(key);
    if (!validPaths.has(key)) {
      throw new StateError(
        "UnknownPath",
        `unknown initial path "${key}". Valid paths: ${[...validPaths].join(", ")}`,
        key,
      );
    }
    if (typeMap !== undefined) {
      const expectedType = typeMap.get(key);
      const value = initial[key];
      if (
        expectedType !== undefined &&
        value !== undefined &&
        !matchesSchemaType(value, expectedType)
      ) {
        throw new StateError(
          "TypeMismatch",
          `type mismatch in initial state for "${key}": expected ${expectedType}, got ${value.symbol}`,
          key,
        );
      }
    }
  }
  return make({ ...initial }, validPaths, typeMap ?? null);
}

/**
 * Create a StateManager from a STATE schema, populating each field with
 * its declared default value. Fields present in `overrides` take precedence.
 *
 * `write()` on the returned manager (and any manager derived from it) will
 * throw immediately for any path not declared in the schema.
 */
export function stateManagerFromSchema(
  stateModel: StateModel,
  overrides: Record<string, AnyValue> = {},
): StateManager {
  const defaults: Record<string, AnyValue> = {};
  const validPaths = new Set<string>();
  const typeMap = new Map<string, string>();
  for (const ns of stateModel.namespaces) {
    for (const field of ns.fields) {
      const path = `${ns.name}.${field.name}`;
      defaults[path] = literalToValue(field.value, field.type);
      validPaths.add(path);
      typeMap.set(path, field.type);
    }
  }
  for (const [path, value] of Object.entries(overrides)) {
    assertSafePath(path);
    if (!validPaths.has(path)) {
      throw new StateError(
        "UnknownPath",
        `unknown override path "${path}". Valid paths: ${[...validPaths].join(", ")}`,
        path,
      );
    }
    const expectedType = typeMap.get(path);
    if (expectedType !== undefined && !matchesSchemaType(value, expectedType)) {
      throw new StateError(
        "TypeMismatch",
        `type mismatch in override for "${path}": expected ${expectedType}, got ${value.symbol}`,
        path,
      );
    }
  }
  // make() spreads into a new object on every write, so the defaults reference
  // is never exposed to callers — no freeze needed.
  return make({ ...defaults, ...overrides }, validPaths, typeMap);
}

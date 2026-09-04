import { buildNull } from "runtime";
import { defaultZigRuntimeClient, fromCanonicalValue, toCanonicalValue } from "runtime/zig-runtime";
import type { AnyValue } from "runtime";
import type { StateModel } from "../types/turnout-model_pb.js";
import { StateError } from "../errors.js";
import type { StateManager } from "./state-types.js";
import { assertSafePath, assertKnownPath, assertValidWrite } from "./state-validation.js";
import { matchesSchemaType } from "./schema-types.js";
import { literalToValue } from "./state-proto.js";

// Re-export everything so existing importers stay unchanged.
export type { StateReader, StateManager } from "./state-types.js";
export { protoValueToJs, literalToValue } from "./state-proto.js";
export { matchesSchemaType } from "./schema-types.js";
export { assertSafePath } from "./state-validation.js";

/**
 * Detach a caller-owned value from the caller and make it safe to hand back
 * without copying again: the Zig runtime rebuilds it (which is also where the
 * nesting-depth limit is enforced) and the result is deep-frozen.
 *
 * This is the only place a value crosses the WASM boundary. It runs once per
 * value as it enters state — never on the way out, because what comes back is
 * already frozen and therefore already safe to share.
 */
function normalizeValue(value: AnyValue): AnyValue {
  const response = defaultZigRuntimeClient.value({
    operation: "normalize",
    value: toCanonicalValue(value),
  });
  if (response.status !== "ok") {
    throw new StateError("ValueTooDeep", "state value exceeds the maximum nesting depth");
  }
  return deepFreeze(fromCanonicalValue(response.payload));
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function normalizeState(state: Record<string, AnyValue>): Record<string, AnyValue> {
  const next: Record<string, AnyValue> = {};
  for (const [path, value] of Object.entries(state)) {
    next[path] = normalizeValue(value);
  }
  return next;
}

/** Shared frozen result for a read of a path that holds no value. */
const MISSING_VALUE: AnyValue = deepFreeze(buildNull("missing"));

/**
 * Build a StateManager over an already-normalized state record.
 *
 * The invariant every accessor below relies on: every value in `state` has been
 * through `normalizeValue`, so it is detached from any caller and deep-frozen.
 * Reads can therefore return stored values directly, and a write only has to
 * normalize the one value being written rather than the whole record.
 *
 * Callers outside this file must go through the three public constructors,
 * which establish the invariant.
 */
function make(
  state: Record<string, AnyValue>,
  validPaths: ReadonlySet<string> | null,
  typeMap: ReadonlyMap<string, string> | null = null,
): StateManager {
  const frozenState = Object.freeze(state);
  return {
    read: (path) => {
      assertKnownPath(path, validPaths);
      return frozenState[path] ?? MISSING_VALUE;
    },
    isDeclared: (path) => {
      assertSafePath(path);
      if (validPaths === null) return true;
      return validPaths.has(path);
    },
    exists: (path) => {
      assertSafePath(path);
      return Object.prototype.hasOwnProperty.call(frozenState, path);
    },
    write: (path, value) => {
      assertValidWrite(path, value, validPaths, typeMap);
      return make({ ...frozenState, [path]: normalizeValue(value) }, validPaths, typeMap);
    },
    writeBatch: (batch) => {
      const newState = { ...frozenState };
      for (const [path, value] of Object.entries(batch)) {
        assertValidWrite(path, value, validPaths, typeMap);
        newState[path] = normalizeValue(value);
      }
      return make(newState, validPaths, typeMap);
    },
    // A shallow copy, per StateReader.snapshot: the record is the caller's to
    // hold, while the values inside it stay the shared frozen ones.
    snapshot: () => Object.freeze({ ...frozenState }),
    forEach: (cb) => {
      for (const [path, value] of Object.entries(frozenState)) {
        cb(path, value);
      }
    },
    validPaths: () => validPaths,
    isSchemaManaged: () => validPaths !== null,
    readOrUndefined: (path) => {
      assertSafePath(path);
      if (validPaths !== null && !validPaths.has(path)) return undefined;
      return frozenState[path];
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
  return make(normalizeState(initial), null);
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
  return make(normalizeState(initial), validPaths, typeMap ?? null);
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
  const state: Record<string, AnyValue> = {};
  const validPaths = new Set<string>();
  const typeMap = new Map<string, string>();
  for (const ns of stateModel.namespaces) {
    for (const field of ns.fields) {
      const path = `${ns.name}.${field.name}`;
      state[path] = literalToValue(field.value, field.type);
      validPaths.add(path);
      typeMap.set(path, field.type);
    }
  }
  // Validate and apply overrides in a single pass, writing directly into state
  // so no second spread over overrides is needed.
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
    state[path] = value;
  }
  return make(normalizeState(state), validPaths, typeMap);
}

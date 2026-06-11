import {
  buildNumber,
  buildString,
  buildBoolean,
  buildArray,
  buildArrayNumber,
  buildArrayString,
  buildArrayBoolean,
  buildNull,
} from 'runtime';
import type { AnyValue } from 'runtime';
import { toJson } from '@bufbuild/protobuf';
import { ValueSchema } from '@bufbuild/protobuf/wkt';
import type { Value } from '@bufbuild/protobuf/wkt';
import type { StateModel } from '../types/turnout-model_pb.js';

/**
 * StateManager holds STATE as a flat Record keyed by dotted path
 * ("namespace.field"). All mutations return a new instance, preserving
 * immutability across action boundaries.
 */
export interface StateManager {
  /**
   * Read a value by dotted path, throwing if the path is unknown in schema-backed managers.
   * For unchecked managers, treats all paths as valid and returns buildNull('missing') when absent.
   * Use this to distinguish a known-but-absent path from a typo'd path.
   */
  read(path: string): AnyValue;
  /**
   * Return true if path is declared in the schema (schema-backed managers), or
   * always true for unchecked managers (all paths are treated as valid).
   * Use `exists()` to check whether a value has actually been written to `path`.
   */
  isDeclared(path: string): boolean;
  /**
   * Return true if a value has been written to `path` in the current state.
   * Unlike `isDeclared()`, this works correctly in both schema-backed and
   * unchecked managers: it reflects actual written state, not schema membership.
   */
  exists(path: string): boolean;
  /**
   * Return a new StateManager with the given path set to value.
   * Does not mutate the current instance.
   */
  write(path: string, value: AnyValue): StateManager;
  /**
   * Return a new StateManager with all entries in `batch` applied atomically.
   * Validates all paths and types before writing — throws on the first violation.
   * Prefer this over repeated `write()` calls when merging multiple bindings at
   * once: it allocates a single new state object regardless of batch size.
   */
  writeBatch(batch: Record<string, AnyValue>): StateManager;
  /** Return a shallow copy of the current state record. */
  snapshot(): Readonly<Record<string, AnyValue>>;
  /**
   * Return the set of declared valid paths, or null for unchecked managers.
   * Useful for test introspection and tooling.
   */
  validPaths(): ReadonlySet<string> | null;
  /**
   * Like read() but returns undefined when the path is undeclared (schema-backed managers)
   * or absent (unchecked managers), instead of throwing or returning buildNull('missing').
   * Use this to distinguish "path not found" from "path found, value is null".
   */
  readOrUndefined(path: string): AnyValue | undefined;
}

const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function assertSafePath(path: string): void {
  if (RESERVED_KEYS.has(path)) {
    throw new Error(`StateManager: reserved path "${path}" is not allowed`);
  }
}

function make(
  state: Record<string, AnyValue>,
  validPaths: ReadonlySet<string> | null,
  typeMap: ReadonlyMap<string, string> | null = null,
): StateManager {
  return {
    read: (path) => {
      assertSafePath(path);
      if (validPaths !== null && !validPaths.has(path)) {
        throw new Error(
          `StateManager: unknown path "${path}". Valid paths: ${[...validPaths].join(', ')}`,
        );
      }
      return state[path] ?? buildNull('missing');
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
      assertSafePath(path);
      if (validPaths !== null && !validPaths.has(path)) {
        throw new Error(
          `StateManager: unknown path "${path}". Valid paths: ${[...validPaths].join(', ')}`,
        );
      }
      if (typeMap !== null) {
        const expectedType = typeMap.get(path);
        if (expectedType !== undefined && !matchesSchemaType(value, expectedType)) {
          throw new Error(
            `StateManager: type mismatch for "${path}": expected ${expectedType}, got ${value.symbol}`,
          );
        }
      }
      return make({ ...state, [path]: value }, validPaths, typeMap);
    },
    writeBatch: (batch) => {
      for (const [path, value] of Object.entries(batch)) {
        assertSafePath(path);
        if (validPaths !== null && !validPaths.has(path)) {
          throw new Error(
            `StateManager: unknown path "${path}". Valid paths: ${[...validPaths].join(', ')}`,
          );
        }
        if (typeMap !== null) {
          const expectedType = typeMap.get(path);
          if (expectedType !== undefined && !matchesSchemaType(value, expectedType)) {
            throw new Error(
              `StateManager: type mismatch for "${path}": expected ${expectedType}, got ${value.symbol}`,
            );
          }
        }
      }
      return make({ ...state, ...batch }, validPaths, typeMap);
    },
    snapshot: () => ({ ...state }),
    validPaths: () => validPaths,
    readOrUndefined: (path) => {
      assertSafePath(path);
      if (validPaths !== null && !validPaths.has(path)) return undefined;
      return state[path];
    },
  };
}

function matchesSchemaType(value: AnyValue, schemaType: string): boolean {
  switch (schemaType) {
    case 'number': return value.symbol === 'number';
    case 'str': return value.symbol === 'string';
    case 'bool': return value.symbol === 'boolean';
    case 'arr<number>': return value.symbol === 'array' && matchesArraySubtype(value, 'number');
    case 'arr<str>':    return value.symbol === 'array' && matchesArraySubtype(value, 'string');
    case 'arr<bool>':   return value.symbol === 'array' && matchesArraySubtype(value, 'boolean');
    default:
      throw new Error(`StateManager: unknown schema type "${schemaType}"`);
  }
}

/**
 * Returns true when an array value's subSymbol matches the expected element type.
 * An untyped empty array (subSymbol === undefined, length === 0) is accepted for
 * any element type — it carries no conflicting type information. Non-empty arrays
 * must declare the correct subSymbol.
 */
function matchesArraySubtype(value: AnyValue, expected: 'number' | 'string' | 'boolean'): boolean {
  if (value.subSymbol === expected) return true;
  // Allow untyped empty arrays: buildArray([]) has subSymbol === undefined but
  // contains no elements, so there is no actual type conflict.
  return value.subSymbol === undefined && Array.isArray(value.value) && value.value.length === 0;
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
  for (const path of Object.keys(overrides)) {
    assertSafePath(path);
    if (!validPaths.has(path)) {
      throw new Error(
        `StateManager: unknown override path "${path}". Valid paths: ${[...validPaths].join(', ')}`,
      );
    }
  }
  return make({ ...defaults, ...overrides }, validPaths, typeMap);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Unwrap a protobuf `google.protobuf.Value` message to a plain JS primitive.
 * If the input is not a protobuf Value (already a primitive), it is returned as-is.
 */
export function protoValueToJs(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (isProtoValue(v)) {
    return toJson(ValueSchema, v);
  }
  return v;
}


function isProtoValue(v: unknown): v is Value {
  if (typeof v !== 'object' || v === null) return false;

  const candidate = v as { readonly $typeName?: unknown; readonly kind?: unknown };
  if (candidate.$typeName !== 'google.protobuf.Value') return false;

  if (typeof candidate.kind !== 'object' || candidate.kind === null) return false;
  const kind = candidate.kind as { readonly case?: unknown; readonly value?: unknown };
  return typeof kind.case === 'string' && 'value' in kind;
}

/**
 * Convert a JSON literal value (from the schema default) to a typed AnyValue.
 */
function literalToValue(
  value: unknown,
  type: string,
): AnyValue {
  const raw = protoValueToJs(value);
  if (raw === null || raw === undefined) {
    return buildNull('missing');
  }
  switch (type) {
    case 'number':
      if (typeof raw !== 'number') throw new Error(`literalToValue: schema type "number" but got ${typeof raw} (${JSON.stringify(raw)})`);
      return buildNumber(raw);
    case 'str':
      if (typeof raw !== 'string') throw new Error(`literalToValue: schema type "str" but got ${typeof raw} (${JSON.stringify(raw)})`);
      return buildString(raw);
    case 'bool':
      if (typeof raw !== 'boolean') throw new Error(`literalToValue: schema type "bool" but got ${typeof raw} (${JSON.stringify(raw)})`);
      return buildBoolean(raw);
    case 'arr<number>': {
      if (!Array.isArray(raw)) throw new Error(`literalToValue: schema type "arr<number>" but got ${typeof raw}`);
      return buildArrayNumber(raw.map((v) => {
        if (typeof v !== 'number') throw new Error(`literalToValue: arr<number> element is ${typeof v} (${JSON.stringify(v)})`);
        return buildNumber(v);
      }));
    }
    case 'arr<str>': {
      if (!Array.isArray(raw)) throw new Error(`literalToValue: schema type "arr<str>" but got ${typeof raw}`);
      return buildArrayString(raw.map((v) => {
        if (typeof v !== 'string') throw new Error(`literalToValue: arr<str> element is ${typeof v} (${JSON.stringify(v)})`);
        return buildString(v);
      }));
    }
    case 'arr<bool>': {
      if (!Array.isArray(raw)) throw new Error(`literalToValue: schema type "arr<bool>" but got ${typeof raw}`);
      return buildArrayBoolean(raw.map((v) => {
        if (typeof v !== 'boolean') throw new Error(`literalToValue: arr<bool> element is ${typeof v} (${JSON.stringify(v)})`);
        return buildBoolean(v);
      }));
    }
    default:
      throw new Error(`literalToValue: unknown schema type "${type}"`);
  }
}

/**
 * Exposed for use by the prepare resolver and test helpers.
 * Converts a raw JSON literal to a typed AnyValue given its field type string.
 */
export { literalToValue };


import {
  buildNumber,
  buildString,
  buildBoolean,
  buildArray,
  buildArrayNumber,
  buildArrayString,
  buildArrayBoolean,
  buildNull,
  isNumber,
  isString,
  isBoolean,
  isArray,
} from 'runtime';
import type { AnyValue } from 'runtime';
import { toJson } from '@bufbuild/protobuf';
import { ValueSchema } from '@bufbuild/protobuf/wkt';
import type { Value } from '@bufbuild/protobuf/wkt';
import type { StateModel } from '../types/turnout-model_pb.js';

/**
 * Read-only view of STATE. Callers that only need to inspect state (not mutate
 * it) should accept `StateReader` rather than the full `StateManager` so the
 * data-flow contract is explicit at each call site.
 */
export interface StateReader {
  /**
   * Read a value by dotted path, throwing if the path is unknown in schema-backed managers.
   * For unchecked managers, treats all paths as valid and returns buildNull('missing') when absent.
   */
  read(path: string): AnyValue;
  /**
   * Like read() but returns undefined when the path is undeclared (schema-backed managers)
   * or absent (unchecked managers), instead of throwing or returning buildNull('missing').
   */
  readOrUndefined(path: string): AnyValue | undefined;
  /**
   * Return true if path is declared in the schema (schema-backed managers), or
   * always true for unchecked managers (all paths are treated as valid).
   */
  isDeclared(path: string): boolean;
  /**
   * Return true if a value has been written to `path` in the current state.
   * Unlike `isDeclared()`, this reflects actual written state, not schema membership.
   */
  exists(path: string): boolean;
  /** Return a shallow copy of the current state record. */
  snapshot(): Readonly<Record<string, AnyValue>>;
  /**
   * Invoke `cb` for each path that has a written value in the current state.
   * Unlike `snapshot()`, this does not allocate a copy of the state record —
   * prefer it when you only need to iterate without retaining the entries.
   */
  forEach(cb: (path: string, value: AnyValue) => void): void;
  /**
   * Return the set of declared valid paths, or null for unchecked managers.
   * Prefer `isSchemaManaged()` to branch on schema presence; use `validPaths()`
   * only when you need to enumerate the declared path set.
   */
  validPaths(): ReadonlySet<string> | null;
  /**
   * Return true when this manager enforces path and type validation on every write.
   */
  isSchemaManaged(): boolean;
}

/**
 * StateManager holds STATE as a flat Record keyed by dotted path
 * ("namespace.field"). All mutations return a new instance, preserving
 * immutability across action boundaries.
 */
export interface StateManager extends StateReader {
  /**
   * Return a new StateManager with the given path set to value.
   * Does not mutate the current instance.
   *
   * @performance Creates a new state object on every call. Prefer `writeBatch()`
   * when writing multiple fields at once to avoid O(n) intermediate allocations.
   */
  write(path: string, value: AnyValue): StateManager;
  /**
   * Return a new StateManager with all entries in `batch` applied atomically.
   * Validates all paths and types before writing — throws on the first violation.
   * Prefer this over repeated `write()` calls when merging multiple bindings at
   * once: it allocates a single new state object regardless of batch size.
   *
   * @example
   * // Merge all action output bindings into state in one allocation:
   * const nextState = state.writeBatch({
   *   'player.score': buildNumber(42),
   *   'player.label': buildString('winner'),
   * });
   */
  writeBatch(batch: Record<string, AnyValue>): StateManager;
}

const RESERVED_KEYS = new Set([
  '__proto__', 'constructor', 'prototype',
  'hasOwnProperty', 'toString', 'valueOf',
  'toLocaleString', 'isPrototypeOf', 'propertyIsEnumerable',
]);

function assertSafePath(path: string): void {
  if (RESERVED_KEYS.has(path)) {
    throw new Error(`StateManager: reserved path "${path}" is not allowed`);
  }
}

// assertKnownPath combines the safe-path guard with the schema membership check
// used by read operations. Throws on reserved or undeclared paths.
function assertKnownPath(path: string, validPaths: ReadonlySet<string> | null): void {
  assertSafePath(path);
  if (validPaths !== null && !validPaths.has(path)) {
    throw new Error(
      `StateManager: unknown path "${path}". Valid paths: ${[...validPaths].join(', ')}`,
    );
  }
}

// assertValidWrite combines the known-path check with the schema type check
// used by write operations. Throws on reserved paths, undeclared paths, or
// type mismatches.
function assertValidWrite(
  path: string,
  value: AnyValue,
  validPaths: ReadonlySet<string> | null,
  typeMap: ReadonlyMap<string, string> | null,
): void {
  assertKnownPath(path, validPaths);
  if (typeMap !== null) {
    const expectedType = typeMap.get(path);
    if (expectedType !== undefined && !matchesSchemaType(value, expectedType)) {
      throw new Error(
        `StateManager: type mismatch for "${path}": expected ${expectedType}, got ${value.symbol}`,
      );
    }
  }
}

function make(
  state: Record<string, AnyValue>,
  validPaths: ReadonlySet<string> | null,
  typeMap: ReadonlyMap<string, string> | null = null,
): StateManager {
  return {
    read: (path) => {
      assertKnownPath(path, validPaths);
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

type SchemaTypeEntry = {
  guard(v: AnyValue): boolean;
  build(raw: unknown): AnyValue;
};

const schemaTypeTable: Record<string, SchemaTypeEntry> = {
  number: {
    guard: (v) => isNumber(v),
    build: (raw) => {
      if (typeof raw !== 'number') throw new Error(`literalToValue: schema type "number" but got ${typeof raw} (${JSON.stringify(raw)})`);
      return buildNumber(raw);
    },
  },
  str: {
    guard: (v) => isString(v),
    build: (raw) => {
      if (typeof raw !== 'string') throw new Error(`literalToValue: schema type "str" but got ${typeof raw} (${JSON.stringify(raw)})`);
      return buildString(raw);
    },
  },
  bool: {
    guard: (v) => isBoolean(v),
    build: (raw) => {
      if (typeof raw !== 'boolean') throw new Error(`literalToValue: schema type "bool" but got ${typeof raw} (${JSON.stringify(raw)})`);
      return buildBoolean(raw);
    },
  },
  'arr<number>': {
    guard: (v) => isArray(v) && matchesArraySubtype(v, 'number'),
    build: (raw) => {
      if (!Array.isArray(raw)) throw new Error(`literalToValue: schema type "arr<number>" but got ${typeof raw}`);
      return buildArrayNumber(raw.map((v) => {
        if (typeof v !== 'number') throw new Error(`literalToValue: arr<number> element is ${typeof v} (${JSON.stringify(v)})`);
        return buildNumber(v);
      }));
    },
  },
  'arr<str>': {
    guard: (v) => isArray(v) && matchesArraySubtype(v, 'string'),
    build: (raw) => {
      if (!Array.isArray(raw)) throw new Error(`literalToValue: schema type "arr<str>" but got ${typeof raw}`);
      return buildArrayString(raw.map((v) => {
        if (typeof v !== 'string') throw new Error(`literalToValue: arr<str> element is ${typeof v} (${JSON.stringify(v)})`);
        return buildString(v);
      }));
    },
  },
  'arr<bool>': {
    guard: (v) => isArray(v) && matchesArraySubtype(v, 'boolean'),
    build: (raw) => {
      if (!Array.isArray(raw)) throw new Error(`literalToValue: schema type "arr<bool>" but got ${typeof raw}`);
      return buildArrayBoolean(raw.map((v) => {
        if (typeof v !== 'boolean') throw new Error(`literalToValue: arr<bool> element is ${typeof v} (${JSON.stringify(v)})`);
        return buildBoolean(v);
      }));
    },
  },
};

function matchesSchemaType(value: AnyValue, schemaType: string): boolean {
  const entry = schemaTypeTable[schemaType];
  if (!entry) throw new Error(`StateManager: unknown schema type "${schemaType}"`);
  return entry.guard(value);
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
  for (const [path, value] of Object.entries(overrides)) {
    assertSafePath(path);
    if (!validPaths.has(path)) {
      throw new Error(
        `StateManager: unknown override path "${path}". Valid paths: ${[...validPaths].join(', ')}`,
      );
    }
    const expectedType = typeMap.get(path);
    if (expectedType !== undefined && !matchesSchemaType(value, expectedType)) {
      throw new Error(
        `StateManager: type mismatch in override for "${path}": expected ${expectedType}, got ${value.symbol}`,
      );
    }
  }
  // make() spreads into a new object on every write, so the defaults reference
  // is never exposed to callers — no freeze needed.
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
  const entry = schemaTypeTable[type];
  if (!entry) throw new Error(`literalToValue: unknown schema type "${type}"`);
  return entry.build(raw);
}

/**
 * Exposed for use by the prepare resolver and test helpers.
 * Converts a raw JSON literal to a typed AnyValue given its field type string.
 */
export { literalToValue };


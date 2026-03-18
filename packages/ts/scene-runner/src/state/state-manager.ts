import {
  buildNumber,
  buildString,
  buildBoolean,
  buildArray,
  buildNull,
} from 'turnout';
import type { AnyValue } from 'turnout';
import type { StateModel } from '../types/scene-model.js';

/**
 * StateManager holds STATE as a flat Record keyed by dotted path
 * ("namespace.field"). All mutations return a new instance, preserving
 * immutability across action boundaries.
 */
export class StateManager {
  private constructor(private readonly state: Record<string, AnyValue>) {}

  /** Create a StateManager from a flat initial state record. */
  static from(initial: Record<string, AnyValue>): StateManager {
    return new StateManager({ ...initial });
  }

  /**
   * Create a StateManager from a STATE schema, populating each field with
   * its declared default value. Fields present in `overrides` take precedence.
   */
  static fromSchema(
    stateModel: StateModel,
    overrides: Record<string, AnyValue> = {},
  ): StateManager {
    const defaults: Record<string, AnyValue> = {};
    for (const ns of stateModel.namespaces) {
      for (const field of ns.fields) {
        const path = `${ns.name}.${field.name}`;
        defaults[path] = literalToValue(field.value, field.type);
      }
    }
    return new StateManager({ ...defaults, ...overrides });
  }

  /** Read a value by dotted path. Returns undefined if the path does not exist. */
  read(path: string): AnyValue | undefined {
    return this.state[path];
  }

  /**
   * Return a new StateManager with the given path set to value.
   * Does not mutate the current instance.
   */
  write(path: string, value: AnyValue): StateManager {
    return new StateManager({ ...this.state, [path]: value });
  }

  /** Return a shallow copy of the current state record. */
  snapshot(): Readonly<Record<string, AnyValue>> {
    return { ...this.state };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a JSON literal value (from the schema default) to a typed AnyValue.
 */
function literalToValue(
  value: unknown,
  type: string,
): AnyValue {
  if (value === null || value === undefined) {
    return buildNull('missing');
  }
  switch (type) {
    case 'number':
      return buildNumber(typeof value === 'number' ? value : Number(value));
    case 'str':
      return buildString(typeof value === 'string' ? value : String(value));
    case 'bool':
      return buildBoolean(Boolean(value));
    case 'arr<number>': {
      const arr = Array.isArray(value) ? value : [];
      return buildArray(arr.map((v) => buildNumber(Number(v))));
    }
    case 'arr<str>': {
      const arr = Array.isArray(value) ? value : [];
      return buildArray(arr.map((v) => buildString(String(v))));
    }
    case 'arr<bool>': {
      const arr = Array.isArray(value) ? value : [];
      return buildArray(arr.map((v) => buildBoolean(Boolean(v))));
    }
    default:
      return buildNull('unknown');
  }
}

/**
 * Exposed for use by the prepare resolver and test helpers.
 * Converts a raw JSON literal to a typed AnyValue given its field type string.
 */
export { literalToValue };

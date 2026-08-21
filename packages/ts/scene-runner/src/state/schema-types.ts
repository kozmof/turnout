import {
  buildNumber,
  buildString,
  buildBoolean,
  buildArrayNumber,
  buildArrayString,
  buildArrayBoolean,
  buildRecord,
  isNumber,
  isString,
  isBoolean,
  isArray,
  isRecord,
} from "runtime";
import type { AnyValue } from "runtime";
import { StateError } from "../executor/errors.js";

type SchemaTypeEntry = {
  guard(v: AnyValue): boolean;
  build(raw: unknown): AnyValue;
};

export const schemaTypeTable: Record<string, SchemaTypeEntry> = {
  number: {
    guard: (v) => isNumber(v),
    build: (raw) => {
      if (typeof raw !== "number")
        throw new StateError(
          "InvalidLiteral",
          `literalToValue: schema type "number" but got ${typeof raw} (${JSON.stringify(raw)})`,
        );
      return buildNumber(raw);
    },
  },
  str: {
    guard: (v) => isString(v),
    build: (raw) => {
      if (typeof raw !== "string")
        throw new StateError(
          "InvalidLiteral",
          `literalToValue: schema type "str" but got ${typeof raw} (${JSON.stringify(raw)})`,
        );
      return buildString(raw);
    },
  },
  bool: {
    guard: (v) => isBoolean(v),
    build: (raw) => {
      if (typeof raw !== "boolean")
        throw new StateError(
          "InvalidLiteral",
          `literalToValue: schema type "bool" but got ${typeof raw} (${JSON.stringify(raw)})`,
        );
      return buildBoolean(raw);
    },
  },
  "arr<number>": {
    guard: (v) => isArray(v) && matchesArraySubtype(v, "number"),
    build: (raw) => {
      if (!Array.isArray(raw))
        throw new StateError(
          "InvalidLiteral",
          `literalToValue: schema type "arr<number>" but got ${typeof raw}`,
        );
      return buildArrayNumber(
        raw.map((v) => {
          if (typeof v !== "number")
            throw new StateError(
              "InvalidLiteral",
              `literalToValue: arr<number> element is ${typeof v} (${JSON.stringify(v)})`,
            );
          return buildNumber(v);
        }),
      );
    },
  },
  "arr<str>": {
    guard: (v) => isArray(v) && matchesArraySubtype(v, "string"),
    build: (raw) => {
      if (!Array.isArray(raw))
        throw new StateError(
          "InvalidLiteral",
          `literalToValue: schema type "arr<str>" but got ${typeof raw}`,
        );
      return buildArrayString(
        raw.map((v) => {
          if (typeof v !== "string")
            throw new StateError(
              "InvalidLiteral",
              `literalToValue: arr<str> element is ${typeof v} (${JSON.stringify(v)})`,
            );
          return buildString(v);
        }),
      );
    },
  },
  "arr<bool>": {
    guard: (v) => isArray(v) && matchesArraySubtype(v, "boolean"),
    build: (raw) => {
      if (!Array.isArray(raw))
        throw new StateError(
          "InvalidLiteral",
          `literalToValue: schema type "arr<bool>" but got ${typeof raw}`,
        );
      return buildArrayBoolean(
        raw.map((v) => {
          if (typeof v !== "boolean")
            throw new StateError(
              "InvalidLiteral",
              `literalToValue: arr<bool> element is ${typeof v} (${JSON.stringify(v)})`,
            );
          return buildBoolean(v);
        }),
      );
    },
  },
};

function recordEntry(schemaType: string): SchemaTypeEntry | undefined {
  const match = /^Record<(str|number), (number|str|bool)>$/.exec(schemaType);
  if (!match) return undefined;
  const keyType = match[1];
  const valueType = match[2];
  const symbol = valueType === "str" ? "string" : valueType === "bool" ? "boolean" : "number";
  const validKey = (key: string) => keyType === "str" || /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(key);
  return {
    guard: (v) =>
      isRecord(v) &&
      Object.entries(v.value).every(([key, item]) => validKey(key) && item.symbol === symbol),
    build: (raw) => {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new StateError(
          "InvalidLiteral",
          `literalToValue: schema type "${schemaType}" requires an object`,
        );
      }
      const values: Record<string, AnyValue> = {};
      for (const [key, item] of Object.entries(raw)) {
        if (!validKey(key))
          throw new StateError("InvalidLiteral", `invalid ${keyType} record key "${key}"`);
        if (symbol === "number" && typeof item === "number") values[key] = buildNumber(item);
        else if (symbol === "string" && typeof item === "string") values[key] = buildString(item);
        else if (symbol === "boolean" && typeof item === "boolean")
          values[key] = buildBoolean(item);
        else
          throw new StateError(
            "InvalidLiteral",
            `record value at "${key}" does not match ${valueType}`,
          );
      }
      return buildRecord(values);
    },
  };
}

for (const type of [
  "Record<str, number>",
  "Record<str, str>",
  "Record<str, bool>",
  "Record<number, number>",
  "Record<number, str>",
  "Record<number, bool>",
]) {
  const entry = recordEntry(type);
  if (entry) schemaTypeTable[type] = entry;
}

export function getSchemaTypeEntry(schemaType: string): SchemaTypeEntry | undefined {
  return schemaTypeTable[schemaType] ?? recordEntry(schemaType);
}

export function matchesSchemaType(value: AnyValue, schemaType: string): boolean {
  const entry = getSchemaTypeEntry(schemaType);
  if (!entry) throw new StateError("UnknownSchemaType", `unknown schema type "${schemaType}"`);
  return entry.guard(value);
}

/**
 * Returns true when an array value's subSymbol matches the expected element type.
 * An untyped empty array (subSymbol === undefined, length === 0) is accepted for
 * any element type — it carries no conflicting type information. Non-empty arrays
 * must declare the correct subSymbol.
 */
export function matchesArraySubtype(
  value: AnyValue,
  expected: "number" | "string" | "boolean",
): boolean {
  if (value.subSymbol === expected) return true;
  // Allow untyped empty arrays: buildArray([]) has subSymbol === undefined but
  // contains no elements, so there is no actual type conflict.
  return value.subSymbol === undefined && Array.isArray(value.value) && value.value.length === 0;
}

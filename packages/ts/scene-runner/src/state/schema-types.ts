import {
  buildNumber,
  buildString,
  buildBoolean,
  buildArray,
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

type SchemaNode =
  | { kind: "primitive"; name: "number" | "str" | "bool" }
  | { kind: "array"; element: SchemaNode }
  | { kind: "record"; key: "str" | "number"; value: SchemaNode };

function parseSchemaType(source: string): SchemaNode | undefined {
  let index = 0;
  const spaces = () => {
    while (source[index] === " ") index++;
  };
  const parse = (): SchemaNode | undefined => {
    spaces();
    for (const name of ["number", "str", "bool"] as const) {
      if (source.startsWith(name, index)) {
        index += name.length;
        return { kind: "primitive", name };
      }
    }
    if (source.startsWith("arr<", index)) {
      index += 4;
      const element = parse();
      spaces();
      if (!element || source[index] !== ">") return undefined;
      index++;
      return { kind: "array", element };
    }
    if (source.startsWith("Record<", index)) {
      index += 7;
      spaces();
      const key = source.startsWith("str", index)
        ? "str"
        : source.startsWith("number", index)
          ? "number"
          : undefined;
      if (!key) return undefined;
      index += key.length;
      spaces();
      if (source[index] !== ",") return undefined;
      index++;
      const value = parse();
      spaces();
      if (!value || source[index] !== ">") return undefined;
      index++;
      return { kind: "record", key, value };
    }
    return undefined;
  };
  const node = parse();
  spaces();
  return node && index === source.length ? node : undefined;
}

function validNumberKey(key: string): boolean {
  return key.trim() !== "" && Number.isFinite(Number(key));
}

function matchesNode(value: AnyValue, node: SchemaNode): boolean {
  if (node.kind === "primitive")
    return node.name === "number"
      ? isNumber(value)
      : node.name === "str"
        ? isString(value)
        : isBoolean(value);
  if (node.kind === "array")
    return isArray(value) && value.value.every((item) => matchesNode(item, node.element));
  return (
    isRecord(value) &&
    Object.entries(value.value).every(
      ([key, item]) => (node.key === "str" || validNumberKey(key)) && matchesNode(item, node.value),
    )
  );
}

function buildNode(raw: unknown, node: SchemaNode, path: string): AnyValue {
  if (node.kind === "primitive") {
    if (node.name === "number" && typeof raw === "number") return buildNumber(raw);
    if (node.name === "str" && typeof raw === "string") return buildString(raw);
    if (node.name === "bool" && typeof raw === "boolean") return buildBoolean(raw);
    throw new StateError("InvalidLiteral", path + " does not match " + node.name);
  }
  if (node.kind === "array") {
    if (!Array.isArray(raw)) throw new StateError("InvalidLiteral", path + " requires an array");
    const items = raw.map((item, i) => buildNode(item, node.element, path + "[" + String(i) + "]"));
    if (node.element.kind === "primitive") {
      if (node.element.name === "number")
        return buildArrayNumber(items as ReturnType<typeof buildNumber>[]);
      if (node.element.name === "str")
        return buildArrayString(items as ReturnType<typeof buildString>[]);
      return buildArrayBoolean(items as ReturnType<typeof buildBoolean>[]);
    }
    return buildArray(items);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new StateError("InvalidLiteral", path + " requires an object");
  const values: Record<string, AnyValue> = {};
  for (const [key, item] of Object.entries(raw)) {
    if (node.key === "number" && !validNumberKey(key))
      throw new StateError("InvalidLiteral", "invalid number record key " + JSON.stringify(key));
    values[key] = buildNode(item, node.value, path + "." + key);
  }
  return buildRecord(values);
}

function schemaEntry(schemaType: string): SchemaTypeEntry | undefined {
  const node = parseSchemaType(schemaType);
  if (!node) return undefined;
  return {
    guard: (value) => matchesNode(value, node),
    build: (raw) =>
      buildNode(raw, node, "literalToValue: schema type " + JSON.stringify(schemaType)),
  };
}

const declaredSchemaTypes = [
  "number",
  "str",
  "bool",
  "arr<number>",
  "arr<str>",
  "arr<bool>",
  "Record<str, number>",
  "Record<str, str>",
  "Record<str, bool>",
  "Record<number, number>",
  "Record<number, str>",
  "Record<number, bool>",
  "arr<Record<str, number>>",
  "Record<str, arr<number>>",
] as const;

export const schemaTypeTable: Record<string, SchemaTypeEntry> = {};
for (const type of declaredSchemaTypes) {
  const entry = schemaEntry(type);
  if (entry) schemaTypeTable[type] = entry;
}

export function getSchemaTypeEntry(schemaType: string): SchemaTypeEntry | undefined {
  return schemaTypeTable[schemaType] ?? schemaEntry(schemaType);
}
export function matchesSchemaType(value: AnyValue, schemaType: string): boolean {
  const entry = getSchemaTypeEntry(schemaType);
  if (!entry)
    throw new StateError("UnknownSchemaType", "unknown schema type " + JSON.stringify(schemaType));
  return entry.guard(value);
}
export function matchesArraySubtype(
  value: AnyValue,
  expected: "number" | "string" | "boolean",
): boolean {
  return (
    isArray(value) &&
    (value.value.length === 0 || value.value.every((item) => item.symbol === expected))
  );
}

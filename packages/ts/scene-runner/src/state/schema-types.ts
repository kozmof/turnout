import { defaultZigRuntimeClient, fromCanonicalValue, toCanonicalValue } from "runtime/zig-runtime";
import type { AnyValue } from "runtime";
import { StateError, type StateErrorCode } from "../errors.js";

type SchemaTypeEntry = {
  guard(v: AnyValue): boolean;
  build(raw: unknown): AnyValue;
};

const declaredSchemaTypes = [
  "number",
  "str",
  "bool",
  "arr<number>",
  "arr<str>",
  "arr<bool>",
  "rec<str, number>",
  "rec<str, str>",
  "rec<str, bool>",
  "rec<number, number>",
  "rec<number, str>",
  "rec<number, bool>",
  "arr<rec<str, number>>",
  "rec<str, arr<number>>",
] as const;

export const schemaTypeTable: Record<string, SchemaTypeEntry> = Object.fromEntries(
  declaredSchemaTypes.map((schemaType) => [schemaType, schemaEntry(schemaType)]),
);

export function getSchemaTypeEntry(schemaType: string): SchemaTypeEntry {
  return schemaTypeTable[schemaType] ?? schemaEntry(schemaType);
}

export function matchesSchemaType(value: AnyValue, schemaType: string): boolean {
  const response = defaultZigRuntimeClient.value<{ matches: boolean }>({
    operation: "schemaMatches",
    value: toCanonicalValue(value),
    schemaType,
  });
  if (response.status !== "ok") {
    throw stateOperationError(
      "UnknownSchemaType",
      `unknown schema type ${JSON.stringify(schemaType)}`,
    );
  }
  return response.payload.matches;
}

function schemaEntry(schemaType: string): SchemaTypeEntry {
  return {
    guard: (value) => matchesSchemaType(value, schemaType),
    build: (raw) => buildSchemaLiteral(raw, schemaType),
  };
}

function buildSchemaLiteral(raw: unknown, schemaType: string): AnyValue {
  const response = defaultZigRuntimeClient.value({
    operation: "literalToValue",
    value: raw,
    schemaType,
  });
  if (response.status !== "ok") {
    const code = readError(response.payload);
    if (code === "UnknownSchemaType") {
      throw stateOperationError(
        code,
        `literalToValue: unknown schema type ${JSON.stringify(schemaType)}`,
      );
    }
    const valueType = [...schemaType.matchAll(/(number|str|bool)/g)].at(-1)?.[1];
    throw stateOperationError(
      "InvalidLiteral",
      (schemaType.startsWith("arr<") && !Array.isArray(raw)) ||
        (schemaType.startsWith("rec<") &&
          (typeof raw !== "object" || raw === null || Array.isArray(raw))) ||
        valueType === undefined ||
        schemaType === valueType
        ? `literalToValue: schema type ${JSON.stringify(schemaType)} rejected the literal`
        : `literalToValue: value does not match ${valueType}`,
    );
  }
  return fromCanonicalValue(response.payload);
}

function readError(payload: unknown): string {
  return typeof payload === "object" && payload !== null && "error" in payload
    ? String((payload as { error: unknown }).error)
    : "InvalidLiteral";
}

function stateOperationError(code: StateErrorCode, message: string): StateError {
  return new StateError(code, message);
}

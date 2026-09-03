import type { AnyValue } from "runtime";
import { toJson } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import type { Value } from "@bufbuild/protobuf/wkt";
import { getSchemaTypeEntry } from "./schema-types.js";

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
  if (typeof v !== "object" || v === null) return false;

  const candidate = v as { readonly $typeName?: unknown; readonly kind?: unknown };
  if (candidate.$typeName !== "google.protobuf.Value") return false;

  if (typeof candidate.kind !== "object" || candidate.kind === null) return false;
  const kind = candidate.kind as { readonly case?: unknown; readonly value?: unknown };
  return typeof kind.case === "string" && "value" in kind;
}

/**
 * Convert a JSON literal value (from the schema default) to a typed AnyValue.
 */
export function literalToValue(value: unknown, type: string): AnyValue {
  const raw = protoValueToJs(value);
  return getSchemaTypeEntry(type).build(raw ?? null);
}

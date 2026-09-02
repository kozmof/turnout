import type {
  AnyValue,
  ArrayBooleanValue,
  ArrayNullValue,
  ArrayNumberValue,
  ArrayStringValue,
  ArrayValue,
  BooleanValue,
  NullReasonSubSymbol,
  NullValue,
  NumberValue,
  RecordValue,
  StringValue,
  TagSymbol,
} from "./value.js";
import { createInvalidValueError } from "./errors.js";
import { callZigPreset } from "./preset-funcs/zig-preset.js";
import { defaultZigRuntimeClient } from "../zig-runtime/default-client.js";
import { fromCanonicalValue, toCanonicalOperationValue } from "../zig-runtime/value-codec.js";

type ArraySubSymbol = "number" | "string" | "boolean" | "null";

export function buildNumber(
  value: number,
  tags: readonly TagSymbol[] = [],
): NumberValue<readonly TagSymbol[]> {
  return normalize({ symbol: "number", value: encodeNumber(value), tags }) as NumberValue<
    readonly TagSymbol[]
  >;
}

export function buildString(
  value: string,
  tags: readonly TagSymbol[] = [],
): StringValue<readonly TagSymbol[]> {
  return normalize({ symbol: "string", value, tags }) as StringValue<readonly TagSymbol[]>;
}

export function buildBoolean(
  value: boolean,
  tags: readonly TagSymbol[] = [],
): BooleanValue<readonly TagSymbol[]> {
  return normalize({ symbol: "boolean", value, tags }) as BooleanValue<readonly TagSymbol[]>;
}

export function buildNull(
  reason: NullReasonSubSymbol,
  tags: readonly TagSymbol[] = [],
): NullValue<readonly TagSymbol[]> {
  try {
    return normalize({ symbol: "null", value: null, reason, tags }) as NullValue<
      readonly TagSymbol[]
    >;
  } catch {
    throw createInvalidValueError("null", reason, "Invalid NullReasonSubSymbol");
  }
}

export function buildArray(
  value: AnyValue[],
  tags: readonly TagSymbol[] = [],
): ArrayValue<readonly TagSymbol[]> {
  return buildArrayWithSymbol(value, tags) as ArrayValue<readonly TagSymbol[]>;
}

export function buildRecord(
  value: Record<string, AnyValue>,
  tags: readonly TagSymbol[] = [],
): RecordValue<readonly TagSymbol[]> {
  return normalize({
    symbol: "record",
    value: Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toCanonicalOperationValue(item)]),
    ),
    tags,
  }) as RecordValue<readonly TagSymbol[]>;
}

export function recordGet(
  record: RecordValue<readonly TagSymbol[]>,
  key: StringValue<readonly TagSymbol[]> | NumberValue<readonly TagSymbol[]>,
): AnyValue {
  return callZigPreset("combineFnRecord::get", [record, key]);
}

export function recordSet(
  record: RecordValue<readonly TagSymbol[]>,
  key: StringValue<readonly TagSymbol[]> | NumberValue<readonly TagSymbol[]>,
  value: AnyValue,
): RecordValue<readonly TagSymbol[]> {
  return callZigPreset("combineFnRecord::set", [record, key, value]) as RecordValue<
    readonly TagSymbol[]
  >;
}

export function buildArrayNumber(
  value: AnyValue[],
  tags: readonly TagSymbol[] = [],
): ArrayNumberValue<readonly TagSymbol[]> {
  return buildArrayWithSymbol(value, tags, "number") as ArrayNumberValue<readonly TagSymbol[]>;
}

export function buildArrayString(
  value: AnyValue[],
  tags: readonly TagSymbol[] = [],
): ArrayStringValue<readonly TagSymbol[]> {
  return buildArrayWithSymbol(value, tags, "string") as ArrayStringValue<readonly TagSymbol[]>;
}

export function buildArrayBoolean(
  value: AnyValue[],
  tags: readonly TagSymbol[] = [],
): ArrayBooleanValue<readonly TagSymbol[]> {
  return buildArrayWithSymbol(value, tags, "boolean") as ArrayBooleanValue<readonly TagSymbol[]>;
}

export function buildArrayNull(
  value: AnyValue[],
  tags: readonly TagSymbol[] = [],
): ArrayNullValue<readonly TagSymbol[]> {
  return buildArrayWithSymbol(value, tags, "null") as ArrayNullValue<readonly TagSymbol[]>;
}

export function combineNumberOp(
  op: (a: number, b: number) => number,
  a: NumberValue<readonly TagSymbol[]>,
  b: NumberValue<readonly TagSymbol[]>,
): NumberValue<readonly TagSymbol[]> {
  return derive(buildNumber(op(a.value, b.value)), [a, b]) as NumberValue<readonly TagSymbol[]>;
}

export function combineStringOp(
  op: (a: string, b: string) => string,
  a: StringValue<readonly TagSymbol[]>,
  b: StringValue<readonly TagSymbol[]>,
): StringValue<readonly TagSymbol[]> {
  return derive(buildString(op(a.value, b.value)), [a, b]) as StringValue<readonly TagSymbol[]>;
}

export function combineBooleanOp<A, B>(
  op: (a: A, b: B) => boolean,
  a: AnyValue & { value: A },
  b: AnyValue & { value: B },
): BooleanValue<readonly TagSymbol[]> {
  return derive(buildBoolean(op(a.value, b.value)), [a, b]) as BooleanValue<readonly TagSymbol[]>;
}

export function unaryNumberOp(
  transform: (value: number) => number,
  source: NumberValue<readonly TagSymbol[]>,
): NumberValue<readonly TagSymbol[]> {
  return derive(buildNumber(transform(source.value)), [source]) as NumberValue<
    readonly TagSymbol[]
  >;
}

export function unaryStringOp(
  transform: (value: string) => string,
  source: StringValue<readonly TagSymbol[]>,
): StringValue<readonly TagSymbol[]> {
  return derive(buildString(transform(source.value)), [source]) as StringValue<
    readonly TagSymbol[]
  >;
}

export function unaryBooleanOp(
  transform: (value: boolean) => boolean,
  source: BooleanValue<readonly TagSymbol[]>,
): BooleanValue<readonly TagSymbol[]> {
  return derive(buildBoolean(transform(source.value)), [source]) as BooleanValue<
    readonly TagSymbol[]
  >;
}

export function convertValue<TIn, TOut>(
  convert: (value: TIn) => TOut,
  source: AnyValue & { value: TIn },
  builder: (value: TOut, tags?: readonly TagSymbol[]) => AnyValue & { value: TOut },
): AnyValue & { value: TOut } {
  return derive(builder(convert(source.value)), [source]) as AnyValue & { value: TOut };
}

function buildArrayWithSymbol(
  items: AnyValue[],
  tags: readonly TagSymbol[],
  subSymbol?: ArraySubSymbol,
): AnyValue {
  return normalize({
    symbol: "array",
    value: items.map(toCanonicalOperationValue),
    ...(subSymbol !== undefined && { subSymbol }),
    tags,
  });
}

function derive(value: AnyValue, sources: readonly AnyValue[]): AnyValue {
  return operate({
    operation: "derive",
    value: toCanonicalOperationValue(value),
    sources: sources.map(toCanonicalOperationValue),
  });
}

function normalize(value: unknown): AnyValue {
  return operate({ operation: "normalize", value });
}

function operate(request: unknown): AnyValue {
  const response = defaultZigRuntimeClient.value(request);
  if (response.status !== "ok") throw new Error(readError(response.payload));
  return fromCanonicalValue(response.payload);
}

function readError(payload: unknown): string {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const code = String((payload as { error: unknown }).error);
    return code === "InputTooDeep" ? "Value exceeds the maximum nesting depth" : code;
  }
  return "Zig Value operation failed";
}

function encodeNumber(value: number): number | string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "Infinity";
  if (value === -Infinity) return "-Infinity";
  return value;
}

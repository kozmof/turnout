import strEnum from "../util/strEnum.js";
import { TOM } from "../util/tom.js";
import { defaultZigRuntimeClient } from "../zig-runtime/default-client.js";
import { toCanonicalOperationValue } from "../zig-runtime/value-codec.js";

const _baseTypes = strEnum(["number", "string", "boolean", "array", "record", "null"]);
const _nullReasonSubSymbols = strEnum([
  "missing",
  "not-found",
  "error",
  "filtered",
  "redacted",
  "unknown",
]);

export const baseTypeSymbols = TOM.keys(_baseTypes);
export const nullReasonSubSymbols = TOM.keys(_nullReasonSubSymbols);

export type BaseTypeSymbol = keyof typeof _baseTypes;
export type NullReasonSubSymbol = keyof typeof _nullReasonSubSymbols;
export type ArrayElemSubSymbol = Exclude<BaseTypeSymbol, "array" | "record"> | undefined;

/**
 * Valid values for the subSymbol field in Value types.
 * - For array values: element type (or undefined for untyped arrays)
 * - For null values: reason category
 * - For number/string/boolean values: undefined
 */
export type BaseTypeSubSymbol = ArrayElemSubSymbol | NullReasonSubSymbol;

/**
 * User-definable tag symbols for tracking computational properties.
 *
 * Tags represent markers or labels that propagate through value transformations.
 */
export type TagSymbol = string;

/**
 * Core value structure that combines typed data with computational tags.
 *
 * Values track both their data and the computational history (tags) that
 * influenced them. As values flow through operations, tags are propagated
 * and combined using set union semantics.
 *
 * ## Tag Propagation
 *
 * When operations combine values, their tags are merged:
 *
 * ```typescript
 * // a has tags ['random']
 * // b has tags ['cached']
 * // result = a + b has tags ['random', 'cached']
 * ```
 *
 *
 * @template T - The JavaScript type of the value (number, string, boolean, null, or AnyValue[])
 * @template BaseType - The type symbol ('number', 'string', 'boolean', 'array', or 'null')
 * @template SubType - For arrays, the element type; undefined otherwise
 * @template Tags - Readonly array of tag symbols tracking computation history
 */
export interface Value<
  T,
  BaseType extends BaseTypeSymbol,
  SubType extends BaseTypeSubSymbol,
  Tags extends readonly TagSymbol[] = readonly [],
> {
  /** Base type tag for runtime type checking */
  symbol: BaseType;
  /** The actual JavaScript value */
  value: T;
  /** For arrays: element type. For null: reason category. For number/string/boolean: undefined. */
  subSymbol: SubType;
  /** Computation history: tags that influenced this value */
  tags: Tags;
}

// Base value types without tags
export type NumberValue<Tags extends readonly TagSymbol[] = readonly []> = Value<
  number,
  "number",
  undefined,
  Tags
>;
export type StringValue<Tags extends readonly TagSymbol[] = readonly []> = Value<
  string,
  "string",
  undefined,
  Tags
>;
export type BooleanValue<Tags extends readonly TagSymbol[] = readonly []> = Value<
  boolean,
  "boolean",
  undefined,
  Tags
>;
export type NullValue<Tags extends readonly TagSymbol[] = readonly []> = Value<
  null,
  "null",
  NullReasonSubSymbol,
  Tags
>;
export type ArrayValue<Tags extends readonly TagSymbol[] = readonly []> = Value<
  AnyValue[],
  "array",
  undefined,
  Tags
>;
export type ArrayNumberValue<Tags extends readonly TagSymbol[] = readonly []> = Value<
  NumberValue[],
  "array",
  "number",
  Tags
>;
export type ArrayStringValue<Tags extends readonly TagSymbol[] = readonly []> = Value<
  StringValue[],
  "array",
  "string",
  Tags
>;
export type ArrayBooleanValue<Tags extends readonly TagSymbol[] = readonly []> = Value<
  BooleanValue[],
  "array",
  "boolean",
  Tags
>;
export type ArrayNullValue<Tags extends readonly TagSymbol[] = readonly []> = Value<
  NullValue[],
  "array",
  "null",
  Tags
>;
export type RecordValue<Tags extends readonly TagSymbol[] = readonly []> = Value<
  Record<string, AnyValue>,
  "record",
  undefined,
  Tags
>;

export type TypedArrayValue<Tags extends readonly TagSymbol[] = readonly []> =
  | ArrayNumberValue<Tags>
  | ArrayStringValue<Tags>
  | ArrayBooleanValue<Tags>
  | ArrayNullValue<Tags>;

export type AnyArrayValue<Tags extends readonly TagSymbol[] = readonly []> =
  | ArrayValue<Tags>
  | TypedArrayValue<Tags>;

// Convenience types for pure values (no tags)
export type PureNumberValue = NumberValue;
export type PureStringValue = StringValue;
export type PureBooleanValue = BooleanValue;
export type PureNullValue = NullValue;
export type PureArrayValue = ArrayValue;
export type PureRecordValue = RecordValue;

export type NonArrayValue =
  | NumberValue<readonly TagSymbol[]>
  | StringValue<readonly TagSymbol[]>
  | BooleanValue<readonly TagSymbol[]>
  | NullValue<readonly TagSymbol[]>;

export type AnyValue =
  | NumberValue<readonly TagSymbol[]>
  | StringValue<readonly TagSymbol[]>
  | BooleanValue<readonly TagSymbol[]>
  | NullValue<readonly TagSymbol[]>
  | AnyArrayValue<readonly TagSymbol[]>
  | RecordValue<readonly TagSymbol[]>;

/**
 * A Value with fully generic type parameters.
 * Useful for internal builder functions that work with any value type.
 * @internal
 */
export type UnknownValue = Value<unknown, BaseTypeSymbol, BaseTypeSubSymbol, readonly TagSymbol[]>;

// Type guards based on base type
export function isNumber(val: AnyValue): val is NumberValue<readonly TagSymbol[]> {
  return zigPredicate(val, "number");
}

export function isString(val: AnyValue): val is StringValue<readonly TagSymbol[]> {
  return zigPredicate(val, "string");
}

export function isBoolean(val: AnyValue): val is BooleanValue<readonly TagSymbol[]> {
  return zigPredicate(val, "boolean");
}

export function isNull(val: AnyValue): val is NullValue<readonly TagSymbol[]> {
  return zigPredicate(val, "null");
}

export function isArray(val: AnyValue): val is AnyArrayValue<readonly TagSymbol[]> {
  return zigPredicate(val, "array");
}

export function isRecord(val: AnyValue): val is RecordValue<readonly TagSymbol[]> {
  return zigPredicate(val, "record");
}

export function isTypedArray(val: AnyValue): val is TypedArrayValue<readonly TagSymbol[]> {
  return zigPredicate(val, "typedArray");
}

// Type guards based on tags
export function isPure(val: AnyValue): boolean {
  return zigPredicate(val, "pure");
}

export function hasTag(val: AnyValue, tag: TagSymbol): boolean {
  return zigPredicate(val, "hasTag", tag);
}

// Combined type guards for pure values
export function isPureNumber(val: AnyValue): val is PureNumberValue {
  return isNumber(val) && isPure(val);
}

export function isPureString(val: AnyValue): val is PureStringValue {
  return isString(val) && isPure(val);
}

export function isPureBoolean(val: AnyValue): val is PureBooleanValue {
  return isBoolean(val) && isPure(val);
}

export function isPureNull(val: AnyValue): val is PureNullValue {
  return isNull(val) && isPure(val);
}

/**
 * Creates an UnknownValue with the given parameters.
 * This is a type-safe constructor that ensures all required fields are present.
 *
 * @param symbol - The base type symbol
 * @param value - The actual value
 * @param subSymbol - The sub-type symbol (array element type or null reason)
 * @param tags - The tags array
 * @returns An UnknownValue with all fields properly typed
 *
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function isValidValue<T extends UnknownValue>(
  val: unknown,
  expectedSymbol?: BaseTypeSymbol,
  expectedSubSymbol?: BaseTypeSubSymbol,
): val is T {
  // Check if val is an object
  if (typeof val !== "object" || val === null) {
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const v = val as Record<string, unknown>;

  // Check all required fields exist
  if (!("symbol" in v) || !("value" in v) || !("subSymbol" in v) || !("tags" in v)) {
    return false;
  }

  return zigPredicate(val, "valid", {
    ...(expectedSymbol !== undefined && { symbol: expectedSymbol }),
    ...(expectedSubSymbol !== undefined && { subSymbol: expectedSubSymbol }),
  });
}

function zigPredicate(value: unknown, predicate: string, argument?: unknown): boolean {
  try {
    const response = defaultZigRuntimeClient.value<{ matches: boolean }>({
      operation: "predicate",
      value: toCanonicalOperationValue(value),
      predicate,
      ...(argument !== undefined && { argument }),
    });
    return response.status === "ok" && response.payload.matches;
  } catch {
    return false;
  }
}

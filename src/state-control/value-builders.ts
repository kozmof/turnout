import {
  NumberValue,
  StringValue,
  BooleanValue,
  ArrayValue,
  ArrayNumberValue,
  ArrayStringValue,
  ArrayBooleanValue,
  AnyValue,
  TagSymbol,
} from './value';

/**
 * Pure builders for creating values with proper tag propagation.
 * These eliminate repetitive object construction throughout the codebase.
 *
 * @example
 * // Creating a pure value
 * const pure = buildNumber(42);
 * // => { symbol: 'number', value: 42, subSymbol: undefined, tags: [] }
 *
 * @example
 * // Creating a value with tags from sources
 * const a = buildNumber(5, { tags: ['random'] });
 * const b = buildNumber(3, { tags: ['cached'] });
 * const sum = buildNumber(8, a, b);
 * // => { symbol: 'number', value: 8, subSymbol: undefined, tags: ['random', 'cached'] }
 */

/**
 * Merges tags from multiple source values using set union semantics.
 * Duplicates are removed automatically.
 */
function mergeTags(...sources: AnyValue[]): readonly TagSymbol[] {
  const tagsSet = new Set<TagSymbol>();

  for (const source of sources) {
    for (const tag of source.tags) {
      tagsSet.add(tag);
    }
  }

  return Array.from(tagsSet);
}

/**
 * Generic builder factory for creating value builders with specific symbol/subSymbol configurations.
 * This eliminates code duplication across all builder functions.
 *
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function createValueBuilder<TResult>(
  symbol: string,
  subSymbol: string | undefined
): (value: unknown, tags?: readonly TagSymbol[]) => TResult {
  return (value: unknown, tags: readonly TagSymbol[] = []): TResult => {
    // Deduplicate tags
    const uniqueTags = tags.length > 0 ? Array.from(new Set(tags)) : [];

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return {
      symbol,
      value,
      subSymbol,
      tags: uniqueTags,
    } as unknown as TResult;
  };
}

/**
 * Builds a NumberValue with tags propagated from source values.
 *
 * @param value - The numeric value
 * @param sources - Source values whose tags should be propagated
 * @returns NumberValue with merged tags from all sources
 *
 * @example
 * const pure = buildNumber(42);
 * const withTags = buildNumber(10, { tags: ['random'] } as AnyValue);
 */
export const buildNumber = createValueBuilder<NumberValue<readonly TagSymbol[]>>('number', undefined);

/**
 * Builds a StringValue with tags propagated from source values.
 *
 * @param value - The string value
 * @param sources - Source values whose tags should be propagated
 * @returns StringValue with merged tags from all sources
 *
 * @example
 * const greeting = buildString('Hello');
 * const fromNetwork = buildString('data', { tags: ['network'] } as AnyValue);
 */
export const buildString = createValueBuilder<StringValue<readonly TagSymbol[]>>('string', undefined);

/**
 * Builds a BooleanValue with tags propagated from source values.
 *
 * @param value - The boolean value
 * @param sources - Source values whose tags should be propagated
 * @returns BooleanValue with merged tags from all sources
 *
 * @example
 * const flag = buildBoolean(true);
 * const derived = buildBoolean(false, someValue, anotherValue);
 */
export const buildBoolean = createValueBuilder<BooleanValue<readonly TagSymbol[]>>('boolean', undefined);

/**
 * Builds an ArrayValue (untyped array) with tags propagated from source values.
 *
 * @param value - The array of values
 * @param sources - Source values whose tags should be propagated
 * @returns ArrayValue with merged tags from all sources
 *
 * @example
 * const arr = buildArray([item1, item2, item3]);
 */
export const buildArray = createValueBuilder<ArrayValue<readonly TagSymbol[]>>('array', undefined);

/**
 * Builds a typed ArrayNumberValue with tags propagated from source values.
 *
 * @param value - The array of number values
 * @param sources - Source values whose tags should be propagated
 * @returns ArrayNumberValue with merged tags from all sources
 *
 * @example
 * const numbers = buildArrayNumber([num1, num2]);
 */
export const buildArrayNumber = createValueBuilder<ArrayNumberValue<readonly TagSymbol[]>>('array', 'number');

/**
 * Builds a typed ArrayStringValue with tags propagated from source values.
 *
 * @param value - The array of string values
 * @param sources - Source values whose tags should be propagated
 * @returns ArrayStringValue with merged tags from all sources
 */
export const buildArrayString = createValueBuilder<ArrayStringValue<readonly TagSymbol[]>>('array', 'string');

/**
 * Builds a typed ArrayBooleanValue with tags propagated from source values.
 *
 * @param value - The array of boolean values
 * @param sources - Source values whose tags should be propagated
 * @returns ArrayBooleanValue with merged tags from all sources
 */
export const buildArrayBoolean = createValueBuilder<ArrayBooleanValue<readonly TagSymbol[]>>('array', 'boolean');

/**
 * Helper for binary operations on NumberValues.
 * Applies the operation and automatically propagates tags.
 *
 * @param op - Binary operation on raw number values
 * @param a - First NumberValue operand
 * @param b - Second NumberValue operand
 * @returns NumberValue with operation result and merged tags
 *
 * @example
 * const add = (a, b) => binaryNumberOp((x, y) => x + y, a, b);
 * const multiply = (a, b) => binaryNumberOp((x, y) => x * y, a, b);
 */
export function binaryNumberOp(
  op: (a: number, b: number) => number,
  a: NumberValue<readonly TagSymbol[]>,
  b: NumberValue<readonly TagSymbol[]>
): NumberValue<readonly TagSymbol[]> {
  return buildNumber(op(a.value, b.value), mergeTags(a, b));
}

/**
 * Helper for binary operations on StringValues.
 * Applies the operation and automatically propagates tags.
 *
 * @param op - Binary operation on raw string values
 * @param a - First StringValue operand
 * @param b - Second StringValue operand
 * @returns StringValue with operation result and merged tags
 *
 * @example
 * const concat = (a, b) => binaryStringOp((x, y) => x + y, a, b);
 */
export function binaryStringOp(
  op: (a: string, b: string) => string,
  a: StringValue<readonly TagSymbol[]>,
  b: StringValue<readonly TagSymbol[]>
): StringValue<readonly TagSymbol[]> {
  return buildString(op(a.value, b.value), mergeTags(a, b));
}

/**
 * Helper for binary operations that produce BooleanValues.
 * Applies the operation and automatically propagates tags.
 *
 * @param op - Binary operation that returns a boolean
 * @param a - First operand
 * @param b - Second operand
 * @returns BooleanValue with operation result and merged tags
 *
 * @example
 * const equals = (a, b) => binaryBooleanOp((x, y) => x === y, a, b);
 * const lessThan = (a, b) => binaryBooleanOp((x, y) => x < y, a, b);
 */
export function binaryBooleanOp<A, B>(
  op: (a: A, b: B) => boolean,
  a: AnyValue & { value: A },
  b: AnyValue & { value: B }
): BooleanValue<readonly TagSymbol[]> {
  return buildBoolean(op(a.value, b.value), mergeTags(a, b));
}

/**
 * Helper for unary transform operations on NumberValues.
 * Applies the transformation and propagates tags from source.
 *
 * @param transform - Unary operation on raw number value
 * @param source - Source NumberValue
 * @returns NumberValue with transformed value and source tags
 *
 * @example
 * const negate = (n) => unaryNumberOp(x => -x, n);
 * const abs = (n) => unaryNumberOp(x => Math.abs(x), n);
 */
export function unaryNumberOp(
  transform: (value: number) => number,
  source: NumberValue<readonly TagSymbol[]>
): NumberValue<readonly TagSymbol[]> {
  return buildNumber(transform(source.value), source.tags);
}

/**
 * Helper for unary transform operations on StringValues.
 * Applies the transformation and propagates tags from source.
 *
 * @param transform - Unary operation on raw string value
 * @param source - Source StringValue
 * @returns StringValue with transformed value and source tags
 *
 * @example
 * const toUpper = (s) => unaryStringOp(x => x.toUpperCase(), s);
 * const trim = (s) => unaryStringOp(x => x.trim(), s);
 */
export function unaryStringOp(
  transform: (value: string) => string,
  source: StringValue<readonly TagSymbol[]>
): StringValue<readonly TagSymbol[]> {
  return buildString(transform(source.value), source.tags);
}

/**
 * Helper for unary transform operations on BooleanValues.
 * Applies the transformation and propagates tags from source.
 *
 * @param transform - Unary operation on raw boolean value
 * @param source - Source BooleanValue
 * @returns BooleanValue with transformed value and source tags
 *
 * @example
 * const not = (b) => unaryBooleanOp(x => !x, b);
 */
export function unaryBooleanOp(
  transform: (value: boolean) => boolean,
  source: BooleanValue<readonly TagSymbol[]>
): BooleanValue<readonly TagSymbol[]> {
  return buildBoolean(transform(source.value), source.tags);
}

/**
 * Helper for conversion operations that change the value type.
 * Applies the conversion and propagates tags from source.
 *
 * @param convert - Conversion function
 * @param source - Source value
 * @returns Converted value with source tags
 *
 * @example
 * const numberToString = (n) => convertValue(x => String(x), n, buildString);
 * const stringToNumber = (s) => convertValue(x => parseFloat(x), s, buildNumber);
 */
export function convertValue<TIn, TOut>(
  convert: (value: TIn) => TOut,
  source: AnyValue & { value: TIn },
  builder: (value: TOut, tags?: readonly TagSymbol[]) => AnyValue & { value: TOut }
): AnyValue & { value: TOut } {
  return builder(convert(source.value), source.tags);
}

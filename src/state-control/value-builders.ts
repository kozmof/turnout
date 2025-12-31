import {
  NumberValue,
  StringValue,
  BooleanValue,
  ArrayValue,
  ArrayNumberValue,
  ArrayStringValue,
  ArrayBooleanValue,
  AnyValue,
  EffectSymbol,
} from './value';

/**
 * Pure builders for creating values with proper effect propagation.
 * These eliminate repetitive object construction throughout the codebase.
 *
 * @example
 * // Creating a pure value
 * const pure = buildNumber(42);
 * // => { symbol: 'number', value: 42, subSymbol: undefined, effects: [] }
 *
 * @example
 * // Creating a value with effects from sources
 * const a = buildNumber(5, { effects: ['random'] });
 * const b = buildNumber(3, { effects: ['cached'] });
 * const sum = buildNumber(8, a, b);
 * // => { symbol: 'number', value: 8, subSymbol: undefined, effects: ['random', 'cached'] }
 */

/**
 * Merges effects from multiple source values using set union semantics.
 * Duplicates are removed automatically.
 */
function mergeEffects(...sources: AnyValue[]): readonly EffectSymbol[] {
  const effectsSet = new Set<EffectSymbol>();

  for (const source of sources) {
    for (const effect of source.effects) {
      effectsSet.add(effect);
    }
  }

  return Array.from(effectsSet);
}

/**
 * Builds a NumberValue with effects propagated from source values.
 *
 * @param value - The numeric value
 * @param sources - Source values whose effects should be propagated
 * @returns NumberValue with merged effects from all sources
 *
 * @example
 * const pure = buildNumber(42);
 * const withEffect = buildNumber(10, { effects: ['random'] } as AnyValue);
 */
export function buildNumber(
  value: number,
  ...sources: AnyValue[]
): NumberValue<readonly EffectSymbol[]> {
  return {
    symbol: 'number',
    value,
    subSymbol: undefined,
    effects: sources.length > 0 ? mergeEffects(...sources) : [],
  };
}

/**
 * Builds a StringValue with effects propagated from source values.
 *
 * @param value - The string value
 * @param sources - Source values whose effects should be propagated
 * @returns StringValue with merged effects from all sources
 *
 * @example
 * const greeting = buildString('Hello');
 * const fromNetwork = buildString('data', { effects: ['network'] } as AnyValue);
 */
export function buildString(
  value: string,
  ...sources: AnyValue[]
): StringValue<readonly EffectSymbol[]> {
  return {
    symbol: 'string',
    value,
    subSymbol: undefined,
    effects: sources.length > 0 ? mergeEffects(...sources) : [],
  };
}

/**
 * Builds a BooleanValue with effects propagated from source values.
 *
 * @param value - The boolean value
 * @param sources - Source values whose effects should be propagated
 * @returns BooleanValue with merged effects from all sources
 *
 * @example
 * const flag = buildBoolean(true);
 * const derived = buildBoolean(false, someValue, anotherValue);
 */
export function buildBoolean(
  value: boolean,
  ...sources: AnyValue[]
): BooleanValue<readonly EffectSymbol[]> {
  return {
    symbol: 'boolean',
    value,
    subSymbol: undefined,
    effects: sources.length > 0 ? mergeEffects(...sources) : [],
  };
}

/**
 * Builds an ArrayValue (untyped array) with effects propagated from source values.
 *
 * @param value - The array of values
 * @param sources - Source values whose effects should be propagated
 * @returns ArrayValue with merged effects from all sources
 *
 * @example
 * const arr = buildArray([item1, item2, item3]);
 */
export function buildArray(
  value: AnyValue[],
  ...sources: AnyValue[]
): ArrayValue<readonly EffectSymbol[]> {
  return {
    symbol: 'array',
    value,
    subSymbol: undefined,
    effects: sources.length > 0 ? mergeEffects(...sources) : [],
  };
}

/**
 * Builds a typed ArrayNumberValue with effects propagated from source values.
 *
 * @param value - The array of number values
 * @param sources - Source values whose effects should be propagated
 * @returns ArrayNumberValue with merged effects from all sources
 *
 * @example
 * const numbers = buildArrayNumber([num1, num2]);
 */
export function buildArrayNumber(
  value: AnyValue[],
  ...sources: AnyValue[]
): ArrayNumberValue<readonly EffectSymbol[]> {
  return {
    symbol: 'array',
    value,
    subSymbol: 'number',
    effects: sources.length > 0 ? mergeEffects(...sources) : [],
  };
}

/**
 * Builds a typed ArrayStringValue with effects propagated from source values.
 *
 * @param value - The array of string values
 * @param sources - Source values whose effects should be propagated
 * @returns ArrayStringValue with merged effects from all sources
 */
export function buildArrayString(
  value: AnyValue[],
  ...sources: AnyValue[]
): ArrayStringValue<readonly EffectSymbol[]> {
  return {
    symbol: 'array',
    value,
    subSymbol: 'string',
    effects: sources.length > 0 ? mergeEffects(...sources) : [],
  };
}

/**
 * Builds a typed ArrayBooleanValue with effects propagated from source values.
 *
 * @param value - The array of boolean values
 * @param sources - Source values whose effects should be propagated
 * @returns ArrayBooleanValue with merged effects from all sources
 */
export function buildArrayBoolean(
  value: AnyValue[],
  ...sources: AnyValue[]
): ArrayBooleanValue<readonly EffectSymbol[]> {
  return {
    symbol: 'array',
    value,
    subSymbol: 'boolean',
    effects: sources.length > 0 ? mergeEffects(...sources) : [],
  };
}

/**
 * Helper for binary operations on NumberValues.
 * Applies the operation and automatically propagates effects.
 *
 * @param op - Binary operation on raw number values
 * @param a - First NumberValue operand
 * @param b - Second NumberValue operand
 * @returns NumberValue with operation result and merged effects
 *
 * @example
 * const add = (a, b) => binaryNumberOp((x, y) => x + y, a, b);
 * const multiply = (a, b) => binaryNumberOp((x, y) => x * y, a, b);
 */
export function binaryNumberOp(
  op: (a: number, b: number) => number,
  a: NumberValue<readonly EffectSymbol[]>,
  b: NumberValue<readonly EffectSymbol[]>
): NumberValue<readonly EffectSymbol[]> {
  return buildNumber(op(a.value, b.value), a, b);
}

/**
 * Helper for binary operations on StringValues.
 * Applies the operation and automatically propagates effects.
 *
 * @param op - Binary operation on raw string values
 * @param a - First StringValue operand
 * @param b - Second StringValue operand
 * @returns StringValue with operation result and merged effects
 *
 * @example
 * const concat = (a, b) => binaryStringOp((x, y) => x + y, a, b);
 */
export function binaryStringOp(
  op: (a: string, b: string) => string,
  a: StringValue<readonly EffectSymbol[]>,
  b: StringValue<readonly EffectSymbol[]>
): StringValue<readonly EffectSymbol[]> {
  return buildString(op(a.value, b.value), a, b);
}

/**
 * Helper for binary operations that produce BooleanValues.
 * Applies the operation and automatically propagates effects.
 *
 * @param op - Binary operation that returns a boolean
 * @param a - First operand
 * @param b - Second operand
 * @returns BooleanValue with operation result and merged effects
 *
 * @example
 * const equals = (a, b) => binaryBooleanOp((x, y) => x === y, a, b);
 * const lessThan = (a, b) => binaryBooleanOp((x, y) => x < y, a, b);
 */
export function binaryBooleanOp<A, B>(
  op: (a: A, b: B) => boolean,
  a: AnyValue & { value: A },
  b: AnyValue & { value: B }
): BooleanValue<readonly EffectSymbol[]> {
  return buildBoolean(op(a.value, b.value), a, b);
}

/**
 * Helper for unary transform operations on NumberValues.
 * Applies the transformation and propagates effects from source.
 *
 * @param transform - Unary operation on raw number value
 * @param source - Source NumberValue
 * @returns NumberValue with transformed value and source effects
 *
 * @example
 * const negate = (n) => unaryNumberOp(x => -x, n);
 * const abs = (n) => unaryNumberOp(x => Math.abs(x), n);
 */
export function unaryNumberOp(
  transform: (value: number) => number,
  source: NumberValue<readonly EffectSymbol[]>
): NumberValue<readonly EffectSymbol[]> {
  return buildNumber(transform(source.value), source);
}

/**
 * Helper for unary transform operations on StringValues.
 * Applies the transformation and propagates effects from source.
 *
 * @param transform - Unary operation on raw string value
 * @param source - Source StringValue
 * @returns StringValue with transformed value and source effects
 *
 * @example
 * const toUpper = (s) => unaryStringOp(x => x.toUpperCase(), s);
 * const trim = (s) => unaryStringOp(x => x.trim(), s);
 */
export function unaryStringOp(
  transform: (value: string) => string,
  source: StringValue<readonly EffectSymbol[]>
): StringValue<readonly EffectSymbol[]> {
  return buildString(transform(source.value), source);
}

/**
 * Helper for unary transform operations on BooleanValues.
 * Applies the transformation and propagates effects from source.
 *
 * @param transform - Unary operation on raw boolean value
 * @param source - Source BooleanValue
 * @returns BooleanValue with transformed value and source effects
 *
 * @example
 * const not = (b) => unaryBooleanOp(x => !x, b);
 */
export function unaryBooleanOp(
  transform: (value: boolean) => boolean,
  source: BooleanValue<readonly EffectSymbol[]>
): BooleanValue<readonly EffectSymbol[]> {
  return buildBoolean(transform(source.value), source);
}

/**
 * Helper for conversion operations that change the value type.
 * Applies the conversion and propagates effects from source.
 *
 * @param convert - Conversion function
 * @param source - Source value
 * @returns Converted value with source effects
 *
 * @example
 * const numberToString = (n) => convertValue(x => String(x), n, buildString);
 * const stringToNumber = (s) => convertValue(x => parseFloat(x), s, buildNumber);
 */
export function convertValue<TIn, TOut>(
  convert: (value: TIn) => TOut,
  source: AnyValue & { value: TIn },
  builder: (value: TOut, ...sources: AnyValue[]) => AnyValue & { value: TOut }
): AnyValue & { value: TOut } {
  return builder(convert(source.value), source);
}

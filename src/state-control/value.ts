import strEnum from '../util/strEnum';
import { TOM } from '../util/tom';

const _baseTypes = strEnum(['number', 'string', 'boolean', 'array']);

export const baseTypeSymbols = TOM.keys(_baseTypes);

export type BaseTypeSymbol = keyof typeof _baseTypes;

/**
 * Valid values for the subSymbol field in Value types.
 * For non-array types, this is undefined. For array types, this indicates the element type.
 */
export type BaseTypeSubSymbol = Exclude<BaseTypeSymbol, 'array'> | undefined;

/**
 * User-definable tag symbols for tracking computational properties.
 *
 * Tags represent markers or labels that propagate through value transformations.
 * This enables tracking properties like:
 * - Data provenance (where did this value come from?)
 * - Computational dependencies (what external factors influenced this?)
 * - Quality attributes (is this value cached, deprecated, etc.?)
 *
 * ## Common Tag Examples
 *
 * - `'random'`: Value depends on random number generation
 * - `'network'`: Value depends on network I/O
 * - `'cached'`: Value retrieved from cache
 * - `'io'`: Value depends on file/disk I/O
 * - `'deprecated'`: Value uses deprecated APIs
 * - `'user-input'`: Value originated from user input
 * - `'external-api'`: Value from external API call
 *
 * ## Usage
 *
 * ```typescript
 * // Pure value (no tags)
 * const pure: NumberValue = {
 *   symbol: 'number',
 *   value: 42,
 *   subSymbol: undefined,
 *   tags: []
 * };
 *
 * // Value with single tag
 * const random: NumberValue = {
 *   symbol: 'number',
 *   value: Math.random(),
 *   subSymbol: undefined,
 *   tags: ['random']
 * };
 *
 * // Value with multiple tags
 * const complex: NumberValue = {
 *   symbol: 'number',
 *   value: getCachedRandomValue(),
 *   subSymbol: undefined,
 *   tags: ['random', 'cached']
 * };
 * ```
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
 * See `propagateTags` in `preset-funcs/util/propagateTags.ts` for details.
 *
 * @template T - The JavaScript type of the value (number, string, boolean, or AnyValue[])
 * @template BaseType - The type symbol ('number', 'string', 'boolean', 'array')
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
  /** For arrays, the element type; undefined for other types */
  subSymbol: SubType;
  /** Computation history: tags that influenced this value */
  tags: Tags;
}

// Base value types without tags
export type NumberValue<Tags extends readonly TagSymbol[] = readonly []> =
  Value<number, 'number', undefined, Tags>;
export type StringValue<Tags extends readonly TagSymbol[] = readonly []> =
  Value<string, 'string', undefined, Tags>;
export type BooleanValue<Tags extends readonly TagSymbol[] = readonly []> =
  Value<boolean, 'boolean', undefined, Tags>;
export type ArrayValue<Tags extends readonly TagSymbol[] = readonly []> =
  Value<AnyValue[], 'array', undefined, Tags>;
export type ArrayNumberValue<Tags extends readonly TagSymbol[] = readonly []> =
  Value<AnyValue[], 'array', 'number', Tags>;
export type ArrayStringValue<Tags extends readonly TagSymbol[] = readonly []> =
  Value<AnyValue[], 'array', 'string', Tags>;
export type ArrayBooleanValue<Tags extends readonly TagSymbol[] = readonly []> =
  Value<AnyValue[], 'array', 'boolean', Tags>;

// Convenience types for pure values (no tags)
export type PureNumberValue = NumberValue;
export type PureStringValue = StringValue;
export type PureBooleanValue = BooleanValue;
export type PureArrayValue = ArrayValue;

export type NonArrayValue =
  | NumberValue<readonly TagSymbol[]>
  | StringValue<readonly TagSymbol[]>
  | BooleanValue<readonly TagSymbol[]>;

export type AnyValue =
  | NumberValue<readonly TagSymbol[]>
  | StringValue<readonly TagSymbol[]>
  | BooleanValue<readonly TagSymbol[]>
  | ArrayValue<readonly TagSymbol[]>
  | ArrayNumberValue<readonly TagSymbol[]>
  | ArrayStringValue<readonly TagSymbol[]>
  | ArrayBooleanValue<readonly TagSymbol[]>;

// Type guards based on base type
export function isNumber(val: AnyValue): val is NumberValue<readonly TagSymbol[]> {
  return val.symbol === 'number';
}

export function isString(val: AnyValue): val is StringValue<readonly TagSymbol[]> {
  return val.symbol === 'string';
}

export function isBoolean(val: AnyValue): val is BooleanValue<readonly TagSymbol[]> {
  return val.symbol === 'boolean';
}

export function isArray(val: AnyValue): val is ArrayValue<readonly TagSymbol[]> | ArrayNumberValue<readonly TagSymbol[]> | ArrayStringValue<readonly TagSymbol[]> | ArrayBooleanValue<readonly TagSymbol[]> {
  return val.symbol === 'array';
}

// Type guards based on tags
export function isPure(val: AnyValue): boolean {
  return val.tags.length === 0;
}

export function hasTag(val: AnyValue, tag: TagSymbol): boolean {
  return val.tags.includes(tag);
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

import strEnum from '../util/strEnum';
import { TOM } from '../util/tom';

const _baseTypes = strEnum(['number', 'string', 'boolean', 'array']);

export const baseTypeSymbols = TOM.keys(_baseTypes);

export type BaseTypeSymbol = keyof typeof _baseTypes;

/**
 * User-definable effect symbols for tracking computational properties.
 *
 * Effects represent "taints" or "computational origins" that propagate through
 * value transformations. This enables tracking properties like:
 * - Data provenance (where did this value come from?)
 * - Computational dependencies (what external factors influenced this?)
 * - Quality attributes (is this value cached, deprecated, etc.?)
 *
 * ## Common Effect Examples
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
 * // Pure value (no effects)
 * const pure: NumberValue = {
 *   symbol: 'number',
 *   value: 42,
 *   subSymbol: undefined,
 *   effects: []
 * };
 *
 * // Value with single effect
 * const random: NumberValue = {
 *   symbol: 'number',
 *   value: Math.random(),
 *   subSymbol: undefined,
 *   effects: ['random']
 * };
 *
 * // Value with multiple effects
 * const complex: NumberValue = {
 *   symbol: 'number',
 *   value: getCachedRandomValue(),
 *   subSymbol: undefined,
 *   effects: ['random', 'cached']
 * };
 * ```
 */
export type EffectSymbol = string;

/**
 * Core value structure that combines typed data with computational effects.
 *
 * Values track both their data and the computational history (effects) that
 * influenced them. As values flow through operations, effects are propagated
 * and combined using set union semantics.
 *
 * ## Effect Propagation
 *
 * When operations combine values, their effects are merged:
 *
 * ```typescript
 * // a has effects ['random']
 * // b has effects ['cached']
 * // result = a + b has effects ['random', 'cached']
 * ```
 *
 * See `propagateEffects` in `preset-funcs/util/propagateEffects.ts` for details.
 *
 * @template T - The JavaScript type of the value (number, string, boolean, or AnyValue[])
 * @template BaseType - The type symbol ('number', 'string', 'boolean', 'array')
 * @template SubType - For arrays, the element type; undefined otherwise
 * @template Effects - Readonly array of effect symbols tracking computation history
 */
interface Value<
  T,
  BaseType extends BaseTypeSymbol,
  SubType extends Exclude<BaseTypeSymbol, 'array'> | undefined,
  Effects extends ReadonlyArray<EffectSymbol> = readonly [],
> {
  /** Base type tag for runtime type checking */
  symbol: BaseType;
  /** The actual JavaScript value */
  value: T;
  /** For arrays, the element type; undefined for other types */
  subSymbol: SubType;
  /** Computation history: effects that influenced this value */
  effects: Effects;
}

// Base value types without effects
export type NumberValue<Effects extends ReadonlyArray<EffectSymbol> = readonly []> =
  Value<number, 'number', undefined, Effects>;
export type StringValue<Effects extends ReadonlyArray<EffectSymbol> = readonly []> =
  Value<string, 'string', undefined, Effects>;
export type BooleanValue<Effects extends ReadonlyArray<EffectSymbol> = readonly []> =
  Value<boolean, 'boolean', undefined, Effects>;
export type ArrayValue<Effects extends ReadonlyArray<EffectSymbol> = readonly []> =
  Value<AnyValue[], 'array', undefined, Effects>;
export type ArrayNumberValue<Effects extends ReadonlyArray<EffectSymbol> = readonly []> =
  Value<AnyValue[], 'array', 'number', Effects>;
export type ArrayStringValue<Effects extends ReadonlyArray<EffectSymbol> = readonly []> =
  Value<AnyValue[], 'array', 'string', Effects>;
export type ArrayBooleanValue<Effects extends ReadonlyArray<EffectSymbol> = readonly []> =
  Value<AnyValue[], 'array', 'boolean', Effects>;

// Convenience types for pure values (no effects)
export type PureNumberValue = NumberValue<readonly []>;
export type PureStringValue = StringValue<readonly []>;
export type PureBooleanValue = BooleanValue<readonly []>;
export type PureArrayValue = ArrayValue<readonly []>;

export type NonArrayValue =
  | NumberValue<readonly EffectSymbol[]>
  | StringValue<readonly EffectSymbol[]>
  | BooleanValue<readonly EffectSymbol[]>;

export type AnyValue =
  | NumberValue<readonly EffectSymbol[]>
  | StringValue<readonly EffectSymbol[]>
  | BooleanValue<readonly EffectSymbol[]>
  | ArrayValue<readonly EffectSymbol[]>
  | ArrayNumberValue<readonly EffectSymbol[]>
  | ArrayStringValue<readonly EffectSymbol[]>
  | ArrayBooleanValue<readonly EffectSymbol[]>;

// Type guards based on base type
export function isNumber(val: AnyValue): val is NumberValue<readonly EffectSymbol[]> {
  return val.symbol === 'number';
}

export function isString(val: AnyValue): val is StringValue<readonly EffectSymbol[]> {
  return val.symbol === 'string';
}

export function isBoolean(val: AnyValue): val is BooleanValue<readonly EffectSymbol[]> {
  return val.symbol === 'boolean';
}

export function isArray(val: AnyValue): val is ArrayValue<readonly EffectSymbol[]> | ArrayNumberValue<readonly EffectSymbol[]> | ArrayStringValue<readonly EffectSymbol[]> | ArrayBooleanValue<readonly EffectSymbol[]> {
  return val.symbol === 'array';
}

// Type guards based on effects
export function isPure(val: AnyValue): boolean {
  return val.effects.length === 0;
}

export function hasEffect(val: AnyValue, effect: EffectSymbol): boolean {
  return val.effects.includes(effect);
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

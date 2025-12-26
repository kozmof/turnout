import strEnum from '../util/strEnum';
import { TOM } from '../util/tom';

const _baseTypes = strEnum(['number', 'string', 'boolean', 'array']);

export const baseTypeSymbols = TOM.keys(_baseTypes);

export type BaseTypeSymbol = keyof typeof _baseTypes;
export type EffectSymbol = string; // User-definable effects

// Writer monad-like structure: value + computation history
interface Value<
  T,
  BaseType extends BaseTypeSymbol,
  SubType extends Exclude<BaseTypeSymbol, 'array'> | undefined,
  Effects extends ReadonlyArray<EffectSymbol> = readonly [],
> {
  symbol: BaseType;
  value: T;
  subSymbol: SubType;
  effects: Effects; // Computation history
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
  | NumberValue<any>
  | StringValue<any>
  | BooleanValue<any>;

export type AnyValue =
  | NumberValue<any>
  | StringValue<any>
  | BooleanValue<any>
  | ArrayValue<any>
  | ArrayNumberValue<any>
  | ArrayStringValue<any>
  | ArrayBooleanValue<any>;

// Type guards based on base type
export function isNumber(val: AnyValue): val is NumberValue<any> {
  return val.symbol === 'number';
}

export function isString(val: AnyValue): val is StringValue<any> {
  return val.symbol === 'string';
}

export function isBoolean(val: AnyValue): val is BooleanValue<any> {
  return val.symbol === 'boolean';
}

export function isArray(val: AnyValue): val is ArrayValue<any> | ArrayNumberValue<any> | ArrayStringValue<any> | ArrayBooleanValue<any> {
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

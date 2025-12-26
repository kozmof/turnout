import { type AnyValue, type NumberValue, type StringValue, type BooleanValue, type ArrayValue, type NonArrayValue, type EffectSymbol } from '../value';

export type ToStringConversion<T extends AnyValue> = (val: T) => StringValue<readonly EffectSymbol[]>;
export type ToNumberConversion<T extends AnyValue> = (val: T) => NumberValue<readonly EffectSymbol[]>;
export type ToBooleanConversion<T extends AnyValue> = (val: T) => BooleanValue<readonly EffectSymbol[]>;
export type ToArrayConversion<T extends AnyValue> = (val: T) => ArrayValue<readonly EffectSymbol[]>;

export type StringToString = (a: StringValue<readonly EffectSymbol[]>, b: StringValue<readonly EffectSymbol[]>) => StringValue<readonly EffectSymbol[]>;
export type NumberToNumber = (a: NumberValue<readonly EffectSymbol[]>, b: NumberValue<readonly EffectSymbol[]>) => NumberValue<readonly EffectSymbol[]>;

export type ToBooleanProcess<T extends AnyValue, U extends AnyValue> = (a: T, b: U) => BooleanValue<readonly EffectSymbol[]>;
export type ToItemtProcess<T extends ArrayValue<readonly EffectSymbol[]>, U extends NonArrayValue, Idx extends NumberValue<readonly EffectSymbol[]>> = (a: T, idx: Idx) =>  U;

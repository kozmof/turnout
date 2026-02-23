import { type AnyValue, type NumberValue, type StringValue, type BooleanValue, type ArrayValue, type NonArrayValue, type TagSymbol } from '../value';

export type ToStringConversion<T extends AnyValue> = (val: T) => StringValue<readonly TagSymbol[]>;
export type ToNumberConversion<T extends AnyValue> = (val: T) => NumberValue<readonly TagSymbol[]>;
export type ToBooleanConversion<T extends AnyValue> = (val: T) => BooleanValue<readonly TagSymbol[]>;
export type ToArrayConversion<T extends AnyValue> = (val: T) => ArrayValue<readonly TagSymbol[]>;

export type StringToString = (a: StringValue<readonly TagSymbol[]>, b: StringValue<readonly TagSymbol[]>) => StringValue<readonly TagSymbol[]>;
export type NumberToNumber = (a: NumberValue<readonly TagSymbol[]>, b: NumberValue<readonly TagSymbol[]>) => NumberValue<readonly TagSymbol[]>;
export type BooleanToBoolean = (a: BooleanValue<readonly TagSymbol[]>, b: BooleanValue<readonly TagSymbol[]>) => BooleanValue<readonly TagSymbol[]>;
export type NumberToBoolean = (a: NumberValue<readonly TagSymbol[]>, b: NumberValue<readonly TagSymbol[]>) => BooleanValue<readonly TagSymbol[]>;
export type StringToBoolean = (a: StringValue<readonly TagSymbol[]>, b: StringValue<readonly TagSymbol[]>) => BooleanValue<readonly TagSymbol[]>;
export type ArrayToArray = (a: ArrayValue<readonly TagSymbol[]>, b: ArrayValue<readonly TagSymbol[]>) => ArrayValue<readonly TagSymbol[]>;

export type ToBooleanProcess<T extends AnyValue, U extends AnyValue> = (a: T, b: U) => BooleanValue<readonly TagSymbol[]>;
export type ToItemtProcess<T extends ArrayValue<readonly TagSymbol[]>, U extends NonArrayValue, Idx extends NumberValue<readonly TagSymbol[]>> = (a: T, idx: Idx) =>  U;

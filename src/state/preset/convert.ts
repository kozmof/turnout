import { type AnyValue, type NumberValue, type StringValue, type BooleanValue, type ArrayValue, type NonArrayValue } from '../value';

export type ToStringConversion<T extends AnyValue> = (val: T) => StringValue;
export type ToNumberConversion<T extends AnyValue> = (val: T) => NumberValue;
export type ToBooleanConversion<T extends AnyValue> = (val: T) => BooleanValue;
export type ToArrayConversion<T extends AnyValue> = (val: T) => ArrayValue;

export type ToStringProcess<T extends AnyValue, U extends AnyValue> = (a: T, b: U) => StringValue;
export type ToNumberProcess<T extends AnyValue, U extends AnyValue> = (a: T, b: U) => NumberValue;
export type ToBooleanProcess<T extends AnyValue, U extends AnyValue> = (a: T, b: U) => BooleanValue;
export type ToItemtProcess<T extends ArrayValue, U extends NonArrayValue, Idx extends NumberValue> = (a: T, idx: Idx) =>  U;

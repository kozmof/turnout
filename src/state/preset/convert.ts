import { type AllValue, type NumberValue, type StringValue, type BooleanValue, type ArrayValue } from "../value";

export type ToStringConversion<T extends AllValue> = (val: T) => StringValue;
export type ToNumberConversion<T extends AllValue> = (val: T) => NumberValue;
export type ToBooleanConversion<T extends AllValue> = (val: T) => BooleanValue;
export type ToArrayConversion<T extends AllValue> = (val: T) => ArrayValue;

export type ToStringProcess<T extends AllValue, U extends AllValue> = (a: T, b: U) => StringValue;
export type ToNumberProcess<T extends AllValue, U extends AllValue> = (a: T, b: U) => NumberValue;
export type ToBooleanProcess<T extends AllValue, U extends AllValue> = (a: T, b: U) => BooleanValue;

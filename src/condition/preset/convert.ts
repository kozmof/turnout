import { type AllValues, type NumberValue, type StringValue, type BooleanValue, type ArrayValue } from "../value";

export type ToStringConversion<T extends AllValues> = (val: T) => StringValue;
export type ToNumberConversion<T extends AllValues> = (val: T) => NumberValue;
export type ToBooleanConversion<T extends AllValues> = (val: T) => BooleanValue;
export type ToArrayConversion<T extends AllValues> = (val: T) => ArrayValue;

export type ToStringProcess<T extends AllValues, U extends AllValues> = (a: T, b: U) => StringValue;
export type ToNumberProcess<T extends AllValues, U extends AllValues> = (a: T, b: U) => NumberValue;
export type ToBooleanProcess<T extends AllValues, U extends AllValues> = (a: T, b: U) => BooleanValue;

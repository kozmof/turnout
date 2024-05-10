import { type AllValues, type NumberValue, type StringValue, type BooleanValue, type ArrayValue } from "../value";

export type ToStringConversion = (val: AllValues) => StringValue;
export type ToNumberConversion = (val: AllValues) => NumberValue;
export type ToBooleanConversion = (val: AllValues) => BooleanValue;
export type ToArrayConversion = (val: AllValues) => ArrayValue;

export type ToStringProcess = (a: AllValues, b: AllValues) => StringValue;
export type ToNumberProcess = (a: AllValues, b: AllValues) => NumberValue;
export type ToBooleanProcess = (a: AllValues, b: AllValues) => BooleanValue;
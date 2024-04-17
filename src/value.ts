import strEnum from "./util/strEnum";
import { TOM } from "./util/tom";

const _dS = strEnum(["number", "string", "boolean", "array"]);
const _nonDS = strEnum(["random-number", "random-string", "random-boolean", "random-array"]);

export const deterministicSymbols = TOM.keys(_dS);
export const nonDeterministicSymbols = TOM.keys(_nonDS);

export type DeterministicSymbol = keyof typeof _dS;
export type NonDeterministicSymbol = keyof typeof _nonDS;

interface Value<T, name extends DeterministicSymbol | NonDeterministicSymbol> {
  symbol: name
  value: T
}

export type FixedNumberValue = Value<number, "number">
export type FixedStringValue = Value<string, "string">
export type FixedBooleanValue = Value<boolean, "boolean">
export type FixedArrayValue = Value<AllValues[], "array">

export type RandomNumberValue = Value<number, "random-number">
export type RandomStringValue = Value<string, "random-string">
export type RandomBooleanValue = Value<boolean, "random-boolean">
export type RandomArrayValue = Value<AllValues[], "random-array">

export type NumberValue = FixedNumberValue | RandomNumberValue
export type StringValue = FixedStringValue | RandomStringValue
export type BooleanValue = FixedBooleanValue | RandomBooleanValue
export type ArrayValue = FixedArrayValue | RandomArrayValue

export type DeterministicValues = FixedNumberValue | FixedStringValue | FixedBooleanValue | FixedArrayValue
export type NonDeterministicValues = RandomNumberValue | RandomStringValue | RandomBooleanValue | RandomArrayValue
export type AllValues = DeterministicValues | NonDeterministicValues


export function isFixedNumber(val: AllValues): val is FixedNumberValue {
  return val.symbol === "number";
}

export function isRandomNumber(val: AllValues): val is RandomNumberValue {
  return val.symbol === "random-number";
}

export function isFixedString(val: AllValues): val is FixedStringValue {
  return val.symbol === "string";
}

export function isRandomString(val: AllValues): val is RandomStringValue {
  return val.symbol === "random-string";
}

export function isFixedBoolean(val: AllValues): val is FixedBooleanValue {
  return val.symbol === "boolean";
}

export function isRandomBoolean(val: AllValues): val is RandomBooleanValue {
  return val.symbol === "random-boolean";
}

export function isFixedArray(val: AllValues): val is FixedArrayValue {
  return val.symbol === "array";
}

export function isRandomArray(val: AllValues): val is RandomArrayValue {
  return val.symbol === "random-array";
}


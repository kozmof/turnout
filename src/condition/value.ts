import strEnum from "../util/strEnum";
import { TOM } from "../util/tom";

const _dS = strEnum(["number", "string", "boolean", "array"]);
const _nonDS = strEnum(["random-number", "random-string", "random-boolean", "random-array"]);

export const deterministicSymbols = TOM.keys(_dS);
export const nonDeterministicSymbols = TOM.keys(_nonDS);

export type DeterministicSymbol = keyof typeof _dS;
export type NonDeterministicSymbol = keyof typeof _nonDS;

interface Value<
  T,
  name1 extends DeterministicSymbol | NonDeterministicSymbol,
  name2 extends Exclude<DeterministicSymbol | NonDeterministicSymbol, 'array' | 'random-array'> | undefined
> {
  symbol: name1;
  value: T;
  subSymbol: name2;
}

export type FixedNumberValue = Value<number, "number", undefined>
export type FixedStringValue = Value<string, "string", undefined>
export type FixedBooleanValue = Value<boolean, "boolean", undefined>
export type FixedArrayValue = Value<AllValue[], "array", undefined>
export type FixedNumberArrayValue = Value<AllValue[], "array", 'number'>
export type FixedStringArrayValue = Value<AllValue[], "array", 'string'>
export type FixedBooleanArrayValue = Value<AllValue[], "array", 'boolean'>

export type RandomNumberValue = Value<number, "random-number", undefined>
export type RandomStringValue = Value<string, "random-string", undefined>
export type RandomBooleanValue = Value<boolean, "random-boolean", undefined>
export type RandomArrayValue = Value<AllValue[], "random-array", undefined>
export type RandomNumberArrayValue = Value<AllValue[], "array", 'random-number'>
export type RandomStringArrayValue = Value<AllValue[], "array", 'random-string'>
export type RandomBooleanArrayValue = Value<AllValue[], "array", 'random-boolean'>

export type NumberValue = FixedNumberValue | RandomNumberValue
export type StringValue = FixedStringValue | RandomStringValue
export type BooleanValue = FixedBooleanValue | RandomBooleanValue
export type ArrayValue = FixedArrayValue | RandomArrayValue
export type ArrayNumberValue = FixedNumberArrayValue | RandomNumberArrayValue
export type ArrayStringValue = FixedStringArrayValue | RandomStringArrayValue
export type ArrayBooleanValue = FixedBooleanArrayValue | RandomBooleanArrayValue
export type NonArrayValue = Exclude<AllValue, ArrayValue | ArrayNumberValue | ArrayStringValue | ArrayBooleanValue>

export type DeterministicValues =
  FixedNumberValue |
  FixedStringValue |
  FixedBooleanValue |
  FixedArrayValue |
  FixedNumberArrayValue |
  FixedStringArrayValue |
  FixedBooleanArrayValue

export type NonDeterministicValues =
  RandomNumberValue |
  RandomStringValue |
  RandomBooleanValue |
  RandomArrayValue |
  RandomNumberArrayValue |
  RandomStringArrayValue |
  RandomBooleanArrayValue

export type AllValue = DeterministicValues | NonDeterministicValues


export function isFixedNumber(val: AllValue): val is FixedNumberValue {
  return val.symbol === "number";
}

export function isRandomNumber(val: AllValue): val is RandomNumberValue {
  return val.symbol === "random-number";
}

export function isFixedString(val: AllValue): val is FixedStringValue {
  return val.symbol === "string";
}

export function isRandomString(val: AllValue): val is RandomStringValue {
  return val.symbol === "random-string";
}

export function isFixedBoolean(val: AllValue): val is FixedBooleanValue {
  return val.symbol === "boolean";
}

export function isRandomBoolean(val: AllValue): val is RandomBooleanValue {
  return val.symbol === "random-boolean";
}

export function isFixedArray(val: AllValue): val is FixedArrayValue {
  return val.symbol === "array";
}

export function isRandomArray(val: AllValue): val is RandomArrayValue {
  return val.symbol === "random-array";
}


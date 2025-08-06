import strEnum from '../util/strEnum';
import { TOM } from '../util/tom';

const _dS = strEnum(['number', 'string', 'boolean', 'array']);
const _nonDS = strEnum([
  'random-number',
  'random-string',
  'random-boolean',
  'random-array',
]);

export const deterministicSymbols = TOM.keys(_dS);
export const nonDeterministicSymbols = TOM.keys(_nonDS);

export type DeterministicSymbol = keyof typeof _dS;
export type NonDeterministicSymbol = keyof typeof _nonDS;

interface Value<
  T,
  name1 extends DeterministicSymbol | NonDeterministicSymbol,
  name2 extends
    | Exclude<
        DeterministicSymbol | NonDeterministicSymbol,
        'array' | 'random-array'
      >
    | undefined,
> {
  symbol: name1;
  value: T;
  subSymbol: name2;
}

export type ControlledNumberValue = Value<number, 'number', undefined>;
export type ControlledStringValue = Value<string, 'string', undefined>;
export type ControlledBooleanValue = Value<boolean, 'boolean', undefined>;
export type ControlledArrayValue = Value<AnyValue[], 'array', undefined>;
export type ControlledNumberArrayValue = Value<AnyValue[], 'array', 'number'>;
export type ControlledStringArrayValue = Value<AnyValue[], 'array', 'string'>;
export type ControlledBooleanArrayValue = Value<AnyValue[], 'array', 'boolean'>;

export type RandomNumberValue = Value<number, 'random-number', undefined>;
export type RandomStringValue = Value<string, 'random-string', undefined>;
export type RandomBooleanValue = Value<boolean, 'random-boolean', undefined>;
export type RandomArrayValue = Value<AnyValue[], 'random-array', undefined>;
export type RandomNumberArrayValue = Value<
  AnyValue[],
  'array',
  'random-number'
>;
export type RandomStringArrayValue = Value<
  AnyValue[],
  'array',
  'random-string'
>;
export type RandomBooleanArrayValue = Value<
  AnyValue[],
  'array',
  'random-boolean'
>;

export type NumberValue = ControlledNumberValue | RandomNumberValue;
export type StringValue = ControlledStringValue | RandomStringValue;
export type BooleanValue = ControlledBooleanValue | RandomBooleanValue;
export type ArrayValue = ControlledArrayValue | RandomArrayValue;
export type ArrayNumberValue =
  | ControlledNumberArrayValue
  | RandomNumberArrayValue;
export type ArrayStringValue =
  | ControlledStringArrayValue
  | RandomStringArrayValue;
export type ArrayBooleanValue =
  | ControlledBooleanArrayValue
  | RandomBooleanArrayValue;
export type NonArrayValue = Exclude<
  AnyValue,
  ArrayValue | ArrayNumberValue | ArrayStringValue | ArrayBooleanValue
>;

export type DeterministicValues =
  | ControlledNumberValue
  | ControlledStringValue
  | ControlledBooleanValue
  | ControlledArrayValue
  | ControlledNumberArrayValue
  | ControlledStringArrayValue
  | ControlledBooleanArrayValue;

export type NonDeterministicValues =
  | RandomNumberValue
  | RandomStringValue
  | RandomBooleanValue
  | RandomArrayValue
  | RandomNumberArrayValue
  | RandomStringArrayValue
  | RandomBooleanArrayValue;

export type AnyValue = DeterministicValues | NonDeterministicValues;

export function isControlledNumber(
  val: AnyValue
): val is ControlledNumberValue {
  return val.symbol === 'number';
}

export function isRandomNumber(val: AnyValue): val is RandomNumberValue {
  return val.symbol === 'random-number';
}

export function isNumber(val: AnyValue): val is NumberValue {
  return isControlledNumber(val) || isRandomNumber(val);
}

export function isControlledString(
  val: AnyValue
): val is ControlledStringValue {
  return val.symbol === 'string';
}

export function isRandomString(val: AnyValue): val is RandomStringValue {
  return val.symbol === 'random-string';
}

export function isString(val: AnyValue): val is StringValue {
  return isControlledString(val) || isRandomString(val);
}

export function isControlledBoolean(
  val: AnyValue
): val is ControlledBooleanValue {
  return val.symbol === 'boolean';
}

export function isRandomBoolean(val: AnyValue): val is RandomBooleanValue {
  return val.symbol === 'random-boolean';
}

export function isBoolean(val: AnyValue): val is BooleanValue {
  return isControlledBoolean(val) || isRandomBoolean(val);
}

export function isControlledArray(val: AnyValue): val is ControlledArrayValue {
  return val.symbol === 'array';
}

export function isRandomArray(val: AnyValue): val is RandomArrayValue {
  return val.symbol === 'random-array';
}

export function isArray(val: AnyValue): val is ArrayValue {
  return isControlledArray(val) || isRandomArray(val);
}

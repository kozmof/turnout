// Maybe deprecated
import {
  type ControlledBooleanValue,
  type ControlledNumberValue,
  type ControlledStringValue,
  type ArrayValue,
  type BooleanValue,
  type NumberValue,
  type StringValue,
} from '../value';

export const numberType = (isRandom: boolean): NumberValue['symbol'] => {
  return isRandom ? 'random-number' : 'number';
};

export const stringType = (isRandom: boolean): StringValue['symbol'] => {
  return isRandom ? 'random-string' : 'string';
};

export const booleanType = (isRandom: boolean): BooleanValue['symbol'] => {
  return isRandom ? 'random-boolean' : 'boolean';
};

export const arrayType = (isRandom: boolean): ArrayValue['symbol'] => {
  return isRandom ? 'random-array' : 'array';
};

export type ElemType =
  | ControlledNumberValue['symbol']
  | ControlledStringValue['symbol']
  | ControlledBooleanValue['symbol'];

export const someType = (
  isRandom: boolean,
  elemType: ElemType
): NumberValue['symbol'] | StringValue['symbol'] | BooleanValue['symbol'] => {
  switch (elemType) {
    case 'number':
      return numberType(isRandom);
    case 'string':
      return stringType(isRandom);
    case 'boolean':
      return booleanType(isRandom);
  }
};

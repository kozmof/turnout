import { type ReturnMetaBinaryFnArray } from '../../preset/array/binaryFn';
import { type ReturnMetaBinaryFnGeneric } from '../../preset/generic/binaryFn';
import { type ReturnMetaBinaryFnNumber } from '../../preset/number/binaryFn';
import { type ReturnMetaBinaryFnString } from '../../preset/string/binaryFn';
import {
  booleanType,
  type ElemType,
  numberType,
  someType,
  stringType,
} from '../types';

export const metaBfNumber = (isRandom: boolean): ReturnMetaBinaryFnNumber => {
  return {
    add: numberType(isRandom),
    minus: numberType(isRandom),
    multiply: numberType(isRandom),
    divide: numberType(isRandom),
  };
};

export const metaBfString = (isRandom: boolean): ReturnMetaBinaryFnString => {
  return {
    concat: stringType(isRandom),
  };
};

export const metaBfArray = (
  isRandom: boolean,
  elemType: ElemType
): ReturnMetaBinaryFnArray => {
  return {
    includes: booleanType(isRandom),
    get: someType(isRandom, elemType),
  };
};

export const metaBfGeneric = (isRandom: boolean): ReturnMetaBinaryFnGeneric => {
  return {
    isEqual: booleanType(isRandom),
  };
};

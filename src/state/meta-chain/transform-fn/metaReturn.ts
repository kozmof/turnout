import { type ReturnMetaTransformFnArray } from '../../preset/array/transformFn';
import { type ReturnMetaTransformFnNumber } from '../../preset/number/transformFn';
import { type ReturnMetaTransformFnString } from '../../preset/string/transformFn';
import { arrayType, numberType, stringType } from '../types';

export const metaTfNumber = (
  isRandom: boolean
): ReturnMetaTransformFnNumber => {
  return {
    pass: numberType(isRandom),
    toStr: stringType(isRandom),
  };
};

export const metaTfString = (
  isRandom: boolean
): ReturnMetaTransformFnString => {
  return {
    pass: stringType(isRandom),
    toNumber: numberType(isRandom),
  };
};

export const metaTfArray = (isRandom: boolean): ReturnMetaTransformFnArray => {
  return {
    pass: arrayType(isRandom),
    length: numberType(isRandom),
  };
};

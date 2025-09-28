import {
  type ReturnMetaTransformFnArray,
  type TransformFnArray,
} from '../../preset/array/transformFn';
import {
  type ReturnMetaTransformFnNumber,
  type TransformFnNumber,
} from '../../preset/number/transformFn';
import {
  type ReturnMetaTransformFnString,
  type TransformFnString,
} from '../../preset/string/transformFn';
import { metaTfArray, metaTfNumber, metaTfString } from './metaReturn';

export const getResultTransformFnType = {
  tfNumber: (
    fnName: keyof TransformFnNumber,
    isRandom: boolean
  ): ReturnMetaTransformFnNumber[keyof TransformFnNumber] => {
    return metaTfNumber(isRandom)[fnName];
  },
  tfString: (
    fnName: keyof TransformFnString,
    isRandom: boolean
  ): ReturnMetaTransformFnString[keyof TransformFnString] => {
    return metaTfString(isRandom)[fnName];
  },
  tfArray: (
    fnName: keyof TransformFnArray,
    isRandom: boolean
  ): ReturnMetaTransformFnArray[keyof TransformFnArray] => {
    return metaTfArray(isRandom)[fnName];
  },
};

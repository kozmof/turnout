import {
  type ReturnMetaTransformFnArray,
  type TransformFnArray,
} from '../../preset-funcs/array/transformFn';
import {
  type ReturnMetaTransformFnNumber,
  type TransformFnNumber,
} from '../../preset-funcs/number/transformFn';
import {
  type ReturnMetaTransformFnString,
  type TransformFnString,
} from '../../preset-funcs/string/transformFn';
import { metaTfArray, metaTfNumber, metaTfString } from './metaReturn';

export const getResultTransformFnType = {
  tfNumber: (
    fnName: keyof TransformFnNumber
  ): ReturnMetaTransformFnNumber[keyof TransformFnNumber] => {
    return metaTfNumber()[fnName];
  },
  tfString: (
    fnName: keyof TransformFnString
  ): ReturnMetaTransformFnString[keyof TransformFnString] => {
    return metaTfString()[fnName];
  },
  tfArray: (
    fnName: keyof TransformFnArray
  ): ReturnMetaTransformFnArray[keyof TransformFnArray] => {
    return metaTfArray()[fnName];
  },
};

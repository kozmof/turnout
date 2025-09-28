import { type AnyValue } from '../../value';
import { type BinaryFnArray } from '../../preset-funcs/array/binaryFn';
import { type BinaryFnGeneric } from '../../preset-funcs/generic/binaryFn';
import { type BinaryFnNumber } from '../../preset-funcs/number/binaryFn';
import { type BinaryFnString } from '../../preset-funcs/string/binaryFn';
import { type ElemType } from '../types';
import {
  metaBfArray,
  metaBfGeneric,
  metaBfNumber,
  metaBfString,
  ReturnTypeBinaryFnArray,
  ReturnTypeBinaryFnGeneric,
  ReturnTypeBinaryFnNumber,
  ReturnTypeBinaryFnString,
} from './metaReturn';

export const getResultBinaryFnType = {
  bfNumber: (
    fnName: keyof BinaryFnNumber
  ): ReturnTypeBinaryFnNumber[keyof BinaryFnNumber] => {
    return metaBfNumber()[fnName];
  },
  bfString: (
    fnName: keyof BinaryFnString
  ): ReturnTypeBinaryFnString[keyof BinaryFnString] => {
    return metaBfString()[fnName];
  },
  bfGeneric: (
    fnName: keyof BinaryFnGeneric<AnyValue>
  ): ReturnTypeBinaryFnGeneric[keyof BinaryFnGeneric<AnyValue>] => {
    return metaBfGeneric()[fnName];
  },
  bfArray: (
    fnName: keyof BinaryFnArray,
    elemType: ElemType
  ): ReturnTypeBinaryFnArray[keyof BinaryFnArray] => {
    return metaBfArray(elemType)[fnName];
  },
};

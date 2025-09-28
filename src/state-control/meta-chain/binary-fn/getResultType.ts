import { type AnyValue } from '../../value';
import {
  type ReturnMetaBinaryFnArray,
  type BinaryFnArray,
} from '../../preset/array/binaryFn';
import {
  type ReturnMetaBinaryFnGeneric,
  type BinaryFnGeneric,
} from '../../preset/generic/binaryFn';
import {
  type ReturnMetaBinaryFnNumber,
  type BinaryFnNumber,
} from '../../preset/number/binaryFn';
import {
  type ReturnMetaBinaryFnString,
  type BinaryFnString,
} from '../../preset/string/binaryFn';
import { type ElemType } from '../types';
import {
  metaBfArray,
  metaBfGeneric,
  metaBfNumber,
  metaBfString,
} from './metaReturn';

export const getResultBinaryFnType = {
  bfNumber: (
    fnName: keyof BinaryFnNumber,
    isRandom: boolean
  ): ReturnMetaBinaryFnNumber[keyof BinaryFnNumber] => {
    return metaBfNumber(isRandom)[fnName];
  },
  bfString: (
    fnName: keyof BinaryFnString,
    isRandom: boolean
  ): ReturnMetaBinaryFnString[keyof BinaryFnString] => {
    return metaBfString(isRandom)[fnName];
  },
  bfGeneric: (
    fnName: keyof BinaryFnGeneric<AnyValue>,
    isRandom: boolean
  ): ReturnMetaBinaryFnGeneric[keyof BinaryFnGeneric<AnyValue>] => {
    return metaBfGeneric(isRandom)[fnName];
  },
  bfArray: (
    fnName: keyof BinaryFnArray,
    elemType: ElemType,
    isRandom: boolean
  ): ReturnMetaBinaryFnArray[keyof BinaryFnArray] => {
    return metaBfArray(isRandom, elemType)[fnName];
  },
};

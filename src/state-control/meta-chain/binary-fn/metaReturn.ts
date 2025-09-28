import { type ReturnMetaBinaryFnArray } from '../../preset/array/binaryFn';
import { type ReturnMetaBinaryFnGeneric } from '../../preset/generic/binaryFn';
import { type ReturnMetaBinaryFnNumber } from '../../preset/number/binaryFn';
import { type ReturnMetaBinaryFnString } from '../../preset/string/binaryFn';
import { NonDeterministicSymbol } from '../../value';
import { type ElemType } from '../types';

type RemoveRandomFromReturn<T> = {
  [K in keyof T]: T[K] extends infer U
    ? Exclude<U, NonDeterministicSymbol>
    : never;
};

export type ReturnTypeBinaryFnNumber =
  RemoveRandomFromReturn<ReturnMetaBinaryFnNumber>;
export type ReturnTypeBinaryFnString =
  RemoveRandomFromReturn<ReturnMetaBinaryFnString>;
export type ReturnTypeBinaryFnArray = RemoveRandomFromReturn<ReturnMetaBinaryFnArray>;
export type ReturnTypeBinaryFnGeneric =
  RemoveRandomFromReturn<ReturnMetaBinaryFnGeneric>;

export const metaBfNumber = (): ReturnTypeBinaryFnNumber => {
  return {
    add: 'number',
    minus: 'number',
    multiply: 'number',
    divide: 'number',
  };
};

export const metaBfString = (): ReturnTypeBinaryFnString => {
  return {
    concat: 'string',
  };
};

export const metaBfArray = (elemType: ElemType): ReturnTypeBinaryFnArray => {
  return {
    includes: 'boolean',
    get: elemType,
  };
};

export const metaBfGeneric = (): ReturnTypeBinaryFnGeneric => {
  return {
    isEqual: 'boolean',
  };
};

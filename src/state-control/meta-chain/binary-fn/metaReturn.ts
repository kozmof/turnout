import { type ReturnMetaBinaryFnArray } from '../../preset-funcs/array/binaryFn';
import { type ReturnMetaBinaryFnGeneric } from '../../preset-funcs/generic/binaryFn';
import { type ReturnMetaBinaryFnNumber } from '../../preset-funcs/number/binaryFn';
import { type ReturnMetaBinaryFnString } from '../../preset-funcs/string/binaryFn';
import { type ElemType } from '../types';

// No longer need to remove random symbols since tags are tracked separately
export type ReturnTypeBinaryFnNumber = ReturnMetaBinaryFnNumber;
export type ReturnTypeBinaryFnString = ReturnMetaBinaryFnString;
export type ReturnTypeBinaryFnArray = ReturnMetaBinaryFnArray;
export type ReturnTypeBinaryFnGeneric = ReturnMetaBinaryFnGeneric;

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

import { type ReturnMetaTransformFnArray } from '../../preset-funcs/array/transformFn';
import { type ReturnMetaTransformFnBoolean } from '../../preset-funcs/boolean/transformFn';
import { type ReturnMetaTransformFnNumber } from '../../preset-funcs/number/transformFn';
import { type ReturnMetaTransformFnNull } from '../../preset-funcs/null/transformFn';
import { type ReturnMetaTransformFnString } from '../../preset-funcs/string/transformFn';

type ReturnTypeTransformFnBoolean = ReturnMetaTransformFnBoolean;
type ReturnTypeTransformFnNumber = ReturnMetaTransformFnNumber;
type ReturnTypeTransformFnNull = ReturnMetaTransformFnNull;
type ReturnTypeTransformFnString = ReturnMetaTransformFnString;
type ReturnTypeTransformFnArray = ReturnMetaTransformFnArray;

export const metaTfBoolean = (): ReturnTypeTransformFnBoolean => {
  return {
    pass: 'boolean',
    not: 'boolean',
    toStr: 'string',
  };
};

export const metaTfNumber = (): ReturnTypeTransformFnNumber => {
  return {
    pass: 'number',
    toStr: 'string',
    abs: 'number',
    floor: 'number',
    ceil: 'number',
    round: 'number',
    negate: 'number',
  };
};

export const metaTfNull = (): ReturnTypeTransformFnNull => {
  return {
    pass: 'null',
  };
};

export const metaTfString = (): ReturnTypeTransformFnString => {
  return {
    pass: 'string',
    toNumber: 'number',
    trim: 'string',
    toLowerCase: 'string',
    toUpperCase: 'string',
    length: 'number',
  };
};

export const metaTfArray = (): ReturnTypeTransformFnArray => {
  return {
    pass: 'array',
    length: 'number',
    isEmpty: 'boolean',
  };
};

import { type ReturnMetaTransformFnArray } from '../../preset-funcs/array/transformFn';
import { type ReturnMetaTransformFnNumber } from '../../preset-funcs/number/transformFn';
import { type ReturnMetaTransformFnNull } from '../../preset-funcs/null/transformFn';
import { type ReturnMetaTransformFnString } from '../../preset-funcs/string/transformFn';

type ReturnTypeTransformFnNumber = ReturnMetaTransformFnNumber;
type ReturnTypeTransformFnNull = ReturnMetaTransformFnNull;
type ReturnTypeTransformFnString = ReturnMetaTransformFnString;
type ReturnTypeTransformFnArray = ReturnMetaTransformFnArray;

export const metaTfNumber = (): ReturnTypeTransformFnNumber => {
  return {
    pass: 'number',
    toStr: 'string',
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
  };
};

export const metaTfArray = (): ReturnTypeTransformFnArray => {
  return {
    pass: 'array',
    length: 'number',
  };
};

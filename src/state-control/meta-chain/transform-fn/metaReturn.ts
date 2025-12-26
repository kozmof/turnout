import { type ReturnMetaTransformFnArray } from '../../preset-funcs/array/transformFn';
import { type ReturnMetaTransformFnNumber } from '../../preset-funcs/number/transformFn';
import { type ReturnMetaTransformFnString } from '../../preset-funcs/string/transformFn';

// No longer need to remove random symbols since effects are tracked separately
type ReturnTypeTransformFnNumber = ReturnMetaTransformFnNumber;
type ReturnTypeTransformFnString = ReturnMetaTransformFnString;
type ReturnTypeTransformFnArray = ReturnMetaTransformFnArray;

export const metaTfNumber = (): ReturnTypeTransformFnNumber => {
  return {
    pass: 'number',
    toStr: 'string',
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

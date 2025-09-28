import { type ReturnMetaTransformFnArray } from '../../preset/array/transformFn';
import { type ReturnMetaTransformFnNumber } from '../../preset/number/transformFn';
import { type ReturnMetaTransformFnString } from '../../preset/string/transformFn';
import { NonDeterministicSymbol } from '../../value';

type RemoveRandomFromReturn<T> = {
  [K in keyof T]: T[K] extends infer U
    ? Exclude<U, NonDeterministicSymbol>
    : never;
};

type ReturnTypeTransformFnNumber =
  RemoveRandomFromReturn<ReturnMetaTransformFnNumber>;
type ReturnTypeTransformFnString =
  RemoveRandomFromReturn<ReturnMetaTransformFnString>;
type ReturnTypeTransformFnArray =
  RemoveRandomFromReturn<ReturnMetaTransformFnArray>;

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

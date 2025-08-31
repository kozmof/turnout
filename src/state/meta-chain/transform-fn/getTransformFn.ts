import { type ReturnMetaTransformFnArray } from '../../preset/array/transformFn';
import { type ReturnMetaTransformFnNumber } from '../../preset/number/transformFn';
import { type ReturnMetaTransformFnString } from '../../preset/string/transformFn';
import {
  type DeterministicSymbol,
  type NonDeterministicSymbol,
} from '../../value';
import { metaTfArray, metaTfNumber, metaTfString } from './metaReturn';

export const getTransformFn = ({
  symbol,
}: {
  symbol: DeterministicSymbol | NonDeterministicSymbol;
}):
  | ReturnMetaTransformFnNumber
  | ReturnMetaTransformFnString
  | ReturnMetaTransformFnArray => {
  switch (symbol) {
    case 'string':
      return metaTfString(false);
    case 'number':
      return metaTfNumber(false);
    case 'boolean': // TODO
      throw new Error();
    case 'array':
      return metaTfArray(false);
    case 'random-number':
      return metaTfNumber(true);
    case 'random-string':
      return metaTfString(true);
    case 'random-boolean': // TODO
      throw new Error();
    case 'random-array':
      return metaTfArray(true);
  }
};

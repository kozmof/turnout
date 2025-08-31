import { type ReturnMetaBinaryFnArray } from '../../preset/array/binaryFn';
import { type ReturnMetaBinaryFnNumber } from '../../preset/number/binaryFn';
import { type ReturnMetaBinaryFnString } from '../../preset/string/binaryFn';
import {
  type DeterministicSymbol,
  type NonDeterministicSymbol,
} from '../../value';
import { type ElemType } from '../types';
import { metaBfArray, metaBfNumber, metaBfString } from './metaReturn';

export const getBinaryFn = ({
  symbol,
  elemType,
}: {
  symbol: DeterministicSymbol | NonDeterministicSymbol;
  elemType: ElemType | null;
}):
  | ReturnMetaBinaryFnNumber
  | ReturnMetaBinaryFnString
  | ReturnMetaBinaryFnArray => {
  switch (symbol) {
    case 'string':
      return metaBfString(false);
    case 'number':
      return metaBfNumber(false);
    case 'boolean': // TODO
      throw new Error();
    case 'array': {
      if (elemType === null) {
        throw new Error();
      }
      return metaBfArray(false, elemType);
    }
    case 'random-number':
      return metaBfNumber(true);
    case 'random-string':
      return metaBfString(true);
    case 'random-boolean': // TODO
      throw new Error();
    case 'random-array': {
      if (elemType === null) {
        throw new Error();
      }
      return metaBfArray(true, elemType);
    }
  }
};

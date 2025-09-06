import { type ParamsMetaBinaryFnGeneric } from '../../preset/generic/binaryFn';
import { type ParamsMetaBinaryFnNumber } from '../../preset/number/binaryFn';
import { type ParamsMetaBinaryFnString } from '../../preset/string/binaryFn';
import {
  type DeterministicSymbol,
  type NonDeterministicSymbol,
} from '../../value';

type RemoveRandomFromParams<T> = {
  [K in keyof T]: T[K] extends [infer U, infer V]
    ? [Exclude<U, NonDeterministicSymbol>, Exclude<V, NonDeterministicSymbol>]
    : never;
};

export const metaBfNumberParams =
  (): RemoveRandomFromParams<ParamsMetaBinaryFnNumber> => {
    return {
      add: ['number', 'number'],
      minus: ['number', 'number'],
      multiply: ['number', 'number'],
      divide: ['number', 'number'],
    };
  };

export const metaBfStringParams =
  (): RemoveRandomFromParams<ParamsMetaBinaryFnString> => {
    return {
      concat: ['string', 'string'],
    };
  };

export const metaBfGenericParams = (
  symbol: DeterministicSymbol
): RemoveRandomFromParams<ParamsMetaBinaryFnGeneric> => {
  return {
    isEqual: [symbol, symbol],
  };
};

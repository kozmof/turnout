import { type ParamsMetaBinaryFnGeneric } from '../../preset-funcs/generic/binaryFn';
import { type ParamsMetaBinaryFnNumber } from '../../preset-funcs/number/binaryFn';
import { type ParamsMetaBinaryFnString } from '../../preset-funcs/string/binaryFn';
import { type BaseTypeSymbol } from '../../value';

// No longer need to remove random symbols since effects are tracked separately
type ParamTypesBinaryFnNumber = ParamsMetaBinaryFnNumber;
type ParamTypesBinaryFnString = ParamsMetaBinaryFnString;
type ParamTypesBinaryFnGeneric = ParamsMetaBinaryFnGeneric;

export const metaBfNumberParams = (): ParamTypesBinaryFnNumber => {
  return {
    add: ['number', 'number'],
    minus: ['number', 'number'],
    multiply: ['number', 'number'],
    divide: ['number', 'number'],
  };
};

export const metaBfStringParams = (): ParamTypesBinaryFnString => {
  return {
    concat: ['string', 'string'],
  };
};

export const metaBfGenericParams = (
  symbol: BaseTypeSymbol
): ParamTypesBinaryFnGeneric => {
  return {
    isEqual: [symbol, symbol],
  };
};

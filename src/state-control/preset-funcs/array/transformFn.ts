import { type NumberValue, type ArrayValue } from '../../value';
import { type ToArrayConversion, type ToNumberConversion } from '../convert';
import { propageteRandom } from '../util/propagateRandom';

export interface TransformFnArray {
  pass: ToArrayConversion<ArrayValue>;
  length: ToNumberConversion<ArrayValue>;
}

export const tfArray: TransformFnArray = {
  pass: (val: ArrayValue): ArrayValue => {
    return val;
  },
  length: (val: ArrayValue): NumberValue => {
    return {
      symbol: propageteRandom('number', val, null),
      value: val.value.length,
      subSymbol: undefined,
    };
  },
};

type TransformFnArrayNameSpace = 'transformFnArray';
export type TransformFnArrayNames =
  `${TransformFnArrayNameSpace}::${keyof typeof tfArray}`;

export type ReturnMetaTransformFnArray = {
  [K in keyof TransformFnArray]: ReturnType<TransformFnArray[K]>['symbol'];
};

export type ParamsMetaTransformFnArray = {
  [K in keyof TransformFnArray]: [Parameters<TransformFnArray[K]>[0]['symbol']];
};

import { type NumberValue, type ArrayValue } from '../../value';
import { type ToArrayConversion, type ToNumberConversion } from '../convert';
import { propageteRandom } from '../util/propagateRandom';

export interface TransformArray {
  pass: ToArrayConversion<ArrayValue>;
  length: ToNumberConversion<ArrayValue>;
}

export const tArray: TransformArray = {
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

export type MetaTransformArray = {
  [K in keyof TransformArray]: ReturnType<TransformArray[K]>['symbol'];
};

export type ParamsMetaTransformArray = {
  [K in keyof TransformArray]: [Parameters<TransformArray[K]>[0]['symbol']];
};

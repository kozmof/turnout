import { type NumberValue, type ArrayValue } from '../../value';
import { type ToArrayConversion, type ToNumberConversion } from '../convert';

export interface TransformArray {
  pass: ToArrayConversion<ArrayValue>
  length: ToNumberConversion<ArrayValue>
}

export const tArray: TransformArray = {
  pass: (val: ArrayValue): ArrayValue => {
    return val;
  },
  length: (val: ArrayValue): NumberValue => {
    switch(val.symbol) {
      case 'array':
        return {
          symbol: 'number',
          value: val.value.length,
          subSymbol: undefined
        };
      case 'random-array':
        return {
          symbol: 'random-number',
          value: val.value.length,
          subSymbol: undefined
        };
      default:
        throw new Error();
    }
  },
};

export type MetaTransformArray = {
  [K in keyof TransformArray]: ReturnType<TransformArray[K]>['symbol']
}

export type ParamsMetaTransformArray = {
  [K in keyof TransformArray]: [
    Parameters<TransformArray[K]>[0]['symbol'],
  ]
}

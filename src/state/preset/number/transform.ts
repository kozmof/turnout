import { type NumberValue, type StringValue } from '../../value';
import { type ToNumberConversion, type ToStringConversion } from '../convert';

export interface TransformNumber {
  pass: ToNumberConversion<NumberValue>
  toStr: ToStringConversion<NumberValue>
}

export const tNumber: TransformNumber = {
  pass: (val: NumberValue): NumberValue => {
    return val;
  },
  toStr: (val: NumberValue): StringValue => {
    switch (val.symbol) {
      case 'number':
        return {
          symbol: 'string',
          value: val.value.toString(),
          subSymbol: undefined
        };
      case 'random-number':
        return {
          symbol: 'random-string',
          value: val.value.toString(),
          subSymbol: undefined
        };
      default:
        throw new Error();
    }
  }
};

export type MetaTransformNumber = {
  [K in keyof TransformNumber]: ReturnType<TransformNumber[K]>['symbol']
}

export type ParamsMetaTransformNumber = {
  [K in keyof TransformNumber]: [
    Parameters<TransformNumber[K]>[0]['symbol'],
  ]
}

import { type NumberValue, type StringValue } from '../../value';
import { type ToStringConversion, type ToNumberConversion } from '../convert';

export interface TransformString {
  pass: ToStringConversion<StringValue>
  toNumber: ToNumberConversion<StringValue>
}

export const tString: TransformString = {
  pass: (val: StringValue) : StringValue => {
    return val;
  },
  toNumber: (val: StringValue): NumberValue => {
    switch (val.symbol) {
      case 'string':
        return {
          symbol: 'number',
          value: parseInt(val.value),
          subSymbol: undefined
        };
      case 'random-string':
        return {
          symbol: 'random-number',
          value: parseInt(val.value),
          subSymbol: undefined
        };
      default:
        throw new Error();
    }
  }
};

export type MetaTransformString = {
  [K in keyof TransformString]: ReturnType<TransformString[K]>['symbol']
}

export type ParamsMetaTransformString = {
  [K in keyof TransformString]: [
    Parameters<TransformString[K]>[0]['symbol'],
  ]
}

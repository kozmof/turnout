import { type NumberValue, type StringValue } from '../../value';
import { type ToNumberConversion, type ToStringConversion } from '../convert';
import { propageteRandom } from '../util/propagateRandom';

export interface TransformFnNumber {
  pass: ToNumberConversion<NumberValue>;
  toStr: ToStringConversion<NumberValue>;
}

export const tNumber: TransformFnNumber = {
  pass: (val: NumberValue): NumberValue => {
    return val;
  },
  toStr: (val: NumberValue): StringValue => {
    return {
      symbol: propageteRandom('string', val, null),
      value: val.value.toString(),
      subSymbol: undefined,
    };
  },
};

export type ReturnMetaTransformFnNumber = {
  [K in keyof TransformFnNumber]: ReturnType<TransformFnNumber[K]>['symbol'];
};

export type ParamsMetaTransformFnNumber = {
  [K in keyof TransformFnNumber]: [Parameters<TransformFnNumber[K]>[0]['symbol']];
};

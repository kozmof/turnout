import { type NumberValue, type StringValue } from '../../value';
import { type ToNumberConversion, type ToStringConversion } from '../convert';
import { propageteRandom } from '../util/propagateRandom';

export interface TransformNumber {
  pass: ToNumberConversion<NumberValue>;
  toStr: ToStringConversion<NumberValue>;
}

export const tNumber: TransformNumber = {
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

export type MetaTransformNumber = {
  [K in keyof TransformNumber]: ReturnType<TransformNumber[K]>['symbol'];
};

export type ParamsMetaTransformNumber = {
  [K in keyof TransformNumber]: [Parameters<TransformNumber[K]>[0]['symbol']];
};

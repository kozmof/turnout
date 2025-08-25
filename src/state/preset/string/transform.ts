import { type NumberValue, type StringValue } from '../../value';
import { type ToStringConversion, type ToNumberConversion } from '../convert';
import { propageteRandom } from '../util/propagateRandom';

export interface TransformString {
  pass: ToStringConversion<StringValue>;
  toNumber: ToNumberConversion<StringValue>;
}

export const tString: TransformString = {
  pass: (val: StringValue): StringValue => {
    return val;
  },
  toNumber: (val: StringValue): NumberValue => {
    return {
      symbol: propageteRandom('number', val, null),
      value: parseInt(val.value),
      subSymbol: undefined,
    };
  },
};

export type MetaTransformString = {
  [K in keyof TransformString]: ReturnType<TransformString[K]>['symbol'];
};

export type ParamsMetaTransformString = {
  [K in keyof TransformString]: [Parameters<TransformString[K]>[0]['symbol']];
};

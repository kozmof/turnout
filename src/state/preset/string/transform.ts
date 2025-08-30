import { type NumberValue, type StringValue } from '../../value';
import { type ToStringConversion, type ToNumberConversion } from '../convert';
import { propageteRandom } from '../util/propagateRandom';

export interface TransformFnString {
  pass: ToStringConversion<StringValue>;
  toNumber: ToNumberConversion<StringValue>;
}

export const tString: TransformFnString = {
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

export type ReturnMetaTransformFnString = {
  [K in keyof TransformFnString]: ReturnType<TransformFnString[K]>['symbol'];
};

export type ParamsMetaTransformFnString = {
  [K in keyof TransformFnString]: [Parameters<TransformFnString[K]>[0]['symbol']];
};

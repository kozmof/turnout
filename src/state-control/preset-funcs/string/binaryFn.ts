import { type StringValue } from '../../value';
import { type StringToString } from '../convert';
import { propageteRandom } from '../util/propagateRandom';

export interface BinaryFnString {
  concat: StringToString;
}

export const bfString: BinaryFnString = {
  concat: (a: StringValue, b: StringValue): StringValue => {
    return {
      symbol: propageteRandom('string', a, b),
      value: a.value + b.value,
      subSymbol: undefined,
    };
  },
};

type BinaryFnStringNameSpace = 'binaryFnString';
export type BinaryFnStringNames =
  `${BinaryFnStringNameSpace}::${keyof typeof bfString}`;

export type ReturnMetaBinaryFnString = {
  [K in keyof BinaryFnString]: ReturnType<BinaryFnString[K]>['symbol'];
};

export type ParamsMetaBinaryFnString = {
  [K in keyof BinaryFnString]: [
    Parameters<BinaryFnString[K]>[0]['symbol'],
    Parameters<BinaryFnString[K]>[1]['symbol'],
  ];
};

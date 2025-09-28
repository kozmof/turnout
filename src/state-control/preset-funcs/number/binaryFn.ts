import { type NumberValue } from '../../value';
import { type NumberToNumber } from '../convert';
import { propageteRandom } from '../util/propagateRandom';

export interface BinaryFnNumber {
  add: NumberToNumber;
  minus: NumberToNumber;
  multiply: NumberToNumber;
  divide: NumberToNumber;
}

export const bfNumber: BinaryFnNumber = {
  add: (a: NumberValue, b: NumberValue): NumberValue => {
    return {
      symbol: propageteRandom('number', a, b),
      value: a.value + b.value,
      subSymbol: undefined,
    };
  },
  minus: (a: NumberValue, b: NumberValue): NumberValue => {
    return {
      symbol: propageteRandom('number', a, b),
      value: a.value - b.value,
      subSymbol: undefined,
    };
  },
  multiply: (a: NumberValue, b: NumberValue): NumberValue => {
    return {
      symbol: propageteRandom('number', a, b),
      value: a.value * b.value,
      subSymbol: undefined,
    };
  },
  divide: (a: NumberValue, b: NumberValue): NumberValue => {
    return {
      symbol: propageteRandom('number', a, b),
      value: a.value / b.value,
      subSymbol: undefined,
    };
  },
};

type BinaryFnNumberNameSpace = 'binaryFnNumber';
export type BinaryFnNumberNames =
  `${BinaryFnNumberNameSpace}::${keyof typeof bfNumber}`;

export type ReturnMetaBinaryFnNumber = {
  [K in keyof BinaryFnNumber]: ReturnType<BinaryFnNumber[K]>['symbol'];
};

export type ParamsMetaBinaryFnNumber = {
  [K in keyof BinaryFnNumber]: [
    Parameters<BinaryFnNumber[K]>[0]['symbol'],
    Parameters<BinaryFnNumber[K]>[1]['symbol'],
  ];
};

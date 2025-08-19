import { isRandomValue } from '../../ops';
import { type NumberValue } from '../../value';
import { type NumberToNumber } from '../convert';

export interface BinaryFnNumber {
  add: NumberToNumber
  minus: NumberToNumber
  multiply: NumberToNumber
  divide: NumberToNumber
}

export const bfNumber: BinaryFnNumber = {
  add: (a: NumberValue, b: NumberValue): NumberValue => {
    const isRandom = isRandomValue(a, b);
    return {
      symbol: isRandom ? 'random-number' : 'number',
      value: a.value + b.value,
      subSymbol: undefined
    };
  },
  minus: (a: NumberValue, b: NumberValue): NumberValue => {
    const isRandom = isRandomValue(a, b);
    return {
      symbol: isRandom ? 'random-number' : 'number',
      value: a.value - b.value,
      subSymbol: undefined
    };
  },
  multiply: (a: NumberValue, b: NumberValue): NumberValue => {
    const isRandom = isRandomValue(a, b);
    return {
      symbol: isRandom ? 'random-number' : 'number',
      value: a.value * b.value,
      subSymbol: undefined
    };
  },
  divide: (a: NumberValue, b: NumberValue): NumberValue => {
    const isRandom = isRandomValue(a, b);
    return {
      symbol: isRandom ? 'random-number' : 'number',
      value: a.value / b.value,
      subSymbol: undefined
    };
  }
};

export type ReturnMetaBinaryFnNumber = {
  [K in keyof BinaryFnNumber]: ReturnType<BinaryFnNumber[K]>['symbol']
}

export type ParamsMetaBinaryFnNumber= {
  [K in keyof BinaryFnNumber]: [
    Parameters<BinaryFnNumber[K]>[0]['symbol'],
    Parameters<BinaryFnNumber[K]>[1]['symbol']
  ]
}

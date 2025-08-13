import { isRandomValue } from '../../ops';
import { type NumberValue } from '../../value';
import { type NumberToNumber } from '../convert';

export interface ProcessNumber {
  add: NumberToNumber
  minus: NumberToNumber
  multiply: NumberToNumber
  divide: NumberToNumber
}

export const pNumber: ProcessNumber = {
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

export type ReturnMetaProcessNumber = {
  [K in keyof ProcessNumber]: ReturnType<ProcessNumber[K]>['symbol']
}

export type ParamsMetaProcessNumber= {
  [K in keyof ProcessNumber]: [
    Parameters<ProcessNumber[K]>[0]['symbol'],
    Parameters<ProcessNumber[K]>[1]['symbol']
  ]
}

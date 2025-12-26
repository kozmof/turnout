import { type NumberValue, type EffectSymbol } from '../../value';
import { type NumberToNumber } from '../convert';
import { propagateEffects } from '../util/propagateRandom';

export interface BinaryFnNumber {
  add: NumberToNumber;
  minus: NumberToNumber;
  multiply: NumberToNumber;
  divide: NumberToNumber;
}

export const bfNumber: BinaryFnNumber = {
  add: (a: NumberValue<readonly EffectSymbol[]>, b: NumberValue<readonly EffectSymbol[]>): NumberValue<readonly EffectSymbol[]> => {
    return {
      symbol: 'number',
      value: a.value + b.value,
      subSymbol: undefined,
      effects: propagateEffects(a, b),
    };
  },
  minus: (a: NumberValue<readonly EffectSymbol[]>, b: NumberValue<readonly EffectSymbol[]>): NumberValue<readonly EffectSymbol[]> => {
    return {
      symbol: 'number',
      value: a.value - b.value,
      subSymbol: undefined,
      effects: propagateEffects(a, b),
    };
  },
  multiply: (a: NumberValue<readonly EffectSymbol[]>, b: NumberValue<readonly EffectSymbol[]>): NumberValue<readonly EffectSymbol[]> => {
    return {
      symbol: 'number',
      value: a.value * b.value,
      subSymbol: undefined,
      effects: propagateEffects(a, b),
    };
  },
  divide: (a: NumberValue<readonly EffectSymbol[]>, b: NumberValue<readonly EffectSymbol[]>): NumberValue<readonly EffectSymbol[]> => {
    return {
      symbol: 'number',
      value: a.value / b.value,
      subSymbol: undefined,
      effects: propagateEffects(a, b),
    };
  },
} as const;

export type BinaryFnNumberNameSpace = 'binaryFnNumber';
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

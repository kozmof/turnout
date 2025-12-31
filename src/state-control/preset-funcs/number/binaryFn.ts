import { type NumberValue, type EffectSymbol } from '../../value';
import { type NumberToNumber } from '../convert';
import { binaryNumberOp } from '../../value-builders';

export interface BinaryFnNumber {
  add: NumberToNumber;
  minus: NumberToNumber;
  multiply: NumberToNumber;
  divide: NumberToNumber;
}

export const bfNumber: BinaryFnNumber = {
  add: (a: NumberValue<readonly EffectSymbol[]>, b: NumberValue<readonly EffectSymbol[]>): NumberValue<readonly EffectSymbol[]> => {
    return binaryNumberOp((x, y) => x + y, a, b);
  },
  minus: (a: NumberValue<readonly EffectSymbol[]>, b: NumberValue<readonly EffectSymbol[]>): NumberValue<readonly EffectSymbol[]> => {
    return binaryNumberOp((x, y) => x - y, a, b);
  },
  multiply: (a: NumberValue<readonly EffectSymbol[]>, b: NumberValue<readonly EffectSymbol[]>): NumberValue<readonly EffectSymbol[]> => {
    return binaryNumberOp((x, y) => x * y, a, b);
  },
  divide: (a: NumberValue<readonly EffectSymbol[]>, b: NumberValue<readonly EffectSymbol[]>): NumberValue<readonly EffectSymbol[]> => {
    return binaryNumberOp((x, y) => x / y, a, b);
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

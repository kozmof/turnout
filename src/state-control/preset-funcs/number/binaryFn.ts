import { type BooleanValue, type NumberValue, type TagSymbol } from '../../value';
import { type NumberToBoolean, type NumberToNumber } from '../convert';
import { binaryBooleanOp, binaryNumberOp } from '../../value-builders';
import { type NamespaceDelimiter } from '../../../util/constants';

export interface BinaryFnNumber {
  add: NumberToNumber;
  minus: NumberToNumber;
  multiply: NumberToNumber;
  divide: NumberToNumber;
  mod: NumberToNumber;
  max: NumberToNumber;
  min: NumberToNumber;
  greaterThan: NumberToBoolean;
  greaterThanOrEqual: NumberToBoolean;
  lessThan: NumberToBoolean;
  lessThanOrEqual: NumberToBoolean;
}

export const bfNumber: BinaryFnNumber = {
  add: (a: NumberValue<readonly TagSymbol[]>, b: NumberValue<readonly TagSymbol[]>): NumberValue<readonly TagSymbol[]> => {
    return binaryNumberOp((x, y) => x + y, a, b);
  },
  minus: (a: NumberValue<readonly TagSymbol[]>, b: NumberValue<readonly TagSymbol[]>): NumberValue<readonly TagSymbol[]> => {
    return binaryNumberOp((x, y) => x - y, a, b);
  },
  multiply: (a: NumberValue<readonly TagSymbol[]>, b: NumberValue<readonly TagSymbol[]>): NumberValue<readonly TagSymbol[]> => {
    return binaryNumberOp((x, y) => x * y, a, b);
  },
  divide: (a: NumberValue<readonly TagSymbol[]>, b: NumberValue<readonly TagSymbol[]>): NumberValue<readonly TagSymbol[]> => {
    return binaryNumberOp((x, y) => x / y, a, b);
  },
  mod: (a: NumberValue<readonly TagSymbol[]>, b: NumberValue<readonly TagSymbol[]>): NumberValue<readonly TagSymbol[]> => {
    return binaryNumberOp((x, y) => x % y, a, b);
  },
  max: (a: NumberValue<readonly TagSymbol[]>, b: NumberValue<readonly TagSymbol[]>): NumberValue<readonly TagSymbol[]> => {
    return binaryNumberOp((x, y) => Math.max(x, y), a, b);
  },
  min: (a: NumberValue<readonly TagSymbol[]>, b: NumberValue<readonly TagSymbol[]>): NumberValue<readonly TagSymbol[]> => {
    return binaryNumberOp((x, y) => Math.min(x, y), a, b);
  },
  greaterThan: (a: NumberValue<readonly TagSymbol[]>, b: NumberValue<readonly TagSymbol[]>): BooleanValue<readonly TagSymbol[]> => {
    return binaryBooleanOp((x, y) => x > y, a, b);
  },
  greaterThanOrEqual: (a: NumberValue<readonly TagSymbol[]>, b: NumberValue<readonly TagSymbol[]>): BooleanValue<readonly TagSymbol[]> => {
    return binaryBooleanOp((x, y) => x >= y, a, b);
  },
  lessThan: (a: NumberValue<readonly TagSymbol[]>, b: NumberValue<readonly TagSymbol[]>): BooleanValue<readonly TagSymbol[]> => {
    return binaryBooleanOp((x, y) => x < y, a, b);
  },
  lessThanOrEqual: (a: NumberValue<readonly TagSymbol[]>, b: NumberValue<readonly TagSymbol[]>): BooleanValue<readonly TagSymbol[]> => {
    return binaryBooleanOp((x, y) => x <= y, a, b);
  },
} as const;

export type BinaryFnNumberNameSpace = 'binaryFnNumber';
export type BinaryFnNumberNames =
  `${BinaryFnNumberNameSpace}${NamespaceDelimiter}${keyof typeof bfNumber}`;

export type ReturnMetaBinaryFnNumber = {
  [K in keyof BinaryFnNumber]: ReturnType<BinaryFnNumber[K]>['symbol'];
};

export type ParamsMetaBinaryFnNumber = {
  [K in keyof BinaryFnNumber]: [
    Parameters<BinaryFnNumber[K]>[0]['symbol'],
    Parameters<BinaryFnNumber[K]>[1]['symbol'],
  ];
};

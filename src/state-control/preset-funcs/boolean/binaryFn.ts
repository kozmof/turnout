import { type BooleanValue, type TagSymbol } from '../../value';
import { type BooleanToBoolean } from '../convert';
import { binaryBooleanOp } from '../../value-builders';
import { type NamespaceDelimiter } from '../../../util/constants';

export interface BinaryFnBoolean {
  and: BooleanToBoolean;
  or: BooleanToBoolean;
  xor: BooleanToBoolean;
}

export const bfBoolean: BinaryFnBoolean = {
  and: (a: BooleanValue<readonly TagSymbol[]>, b: BooleanValue<readonly TagSymbol[]>): BooleanValue<readonly TagSymbol[]> => {
    return binaryBooleanOp((x, y) => x && y, a, b);
  },
  or: (a: BooleanValue<readonly TagSymbol[]>, b: BooleanValue<readonly TagSymbol[]>): BooleanValue<readonly TagSymbol[]> => {
    return binaryBooleanOp((x, y) => x || y, a, b);
  },
  xor: (a: BooleanValue<readonly TagSymbol[]>, b: BooleanValue<readonly TagSymbol[]>): BooleanValue<readonly TagSymbol[]> => {
    return binaryBooleanOp((x, y) => x !== y, a, b);
  },
} as const;

export type BinaryFnBooleanNameSpace = 'binaryFnBoolean';
export type BinaryFnBooleanNames =
  `${BinaryFnBooleanNameSpace}${NamespaceDelimiter}${keyof typeof bfBoolean}`;

export type ReturnMetaBinaryFnBoolean = {
  [K in keyof BinaryFnBoolean]: ReturnType<BinaryFnBoolean[K]>['symbol'];
};

export type ParamsMetaBinaryFnBoolean = {
  [K in keyof BinaryFnBoolean]: [
    Parameters<BinaryFnBoolean[K]>[0]['symbol'],
    Parameters<BinaryFnBoolean[K]>[1]['symbol'],
  ];
};

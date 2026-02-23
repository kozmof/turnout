import { type BooleanValue, type StringValue, type TagSymbol } from '../../value';
import { type StringToBoolean, type StringToString } from '../convert';
import { binaryBooleanOp, binaryStringOp } from '../../value-builders';
import { type NamespaceDelimiter } from '../../../util/constants';

export interface BinaryFnString {
  concat: StringToString;
  includes: StringToBoolean;
  startsWith: StringToBoolean;
  endsWith: StringToBoolean;
}

export const bfString: BinaryFnString = {
  concat: (a: StringValue<readonly TagSymbol[]>, b: StringValue<readonly TagSymbol[]>): StringValue<readonly TagSymbol[]> => {
    return binaryStringOp((x, y) => x + y, a, b);
  },
  includes: (a: StringValue<readonly TagSymbol[]>, b: StringValue<readonly TagSymbol[]>): BooleanValue<readonly TagSymbol[]> => {
    return binaryBooleanOp((x, y) => x.includes(y), a, b);
  },
  startsWith: (a: StringValue<readonly TagSymbol[]>, b: StringValue<readonly TagSymbol[]>): BooleanValue<readonly TagSymbol[]> => {
    return binaryBooleanOp((x, y) => x.startsWith(y), a, b);
  },
  endsWith: (a: StringValue<readonly TagSymbol[]>, b: StringValue<readonly TagSymbol[]>): BooleanValue<readonly TagSymbol[]> => {
    return binaryBooleanOp((x, y) => x.endsWith(y), a, b);
  },
} as const;

export type BinaryFnStringNameSpace = 'binaryFnString';
export type BinaryFnStringNames =
  `${BinaryFnStringNameSpace}${NamespaceDelimiter}${keyof typeof bfString}`;

export type ReturnMetaBinaryFnString = {
  [K in keyof BinaryFnString]: ReturnType<BinaryFnString[K]>['symbol'];
};

export type ParamsMetaBinaryFnString = {
  [K in keyof BinaryFnString]: [
    Parameters<BinaryFnString[K]>[0]['symbol'],
    Parameters<BinaryFnString[K]>[1]['symbol'],
  ];
};

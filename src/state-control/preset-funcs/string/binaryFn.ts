import { type StringValue, type EffectSymbol } from '../../value';
import { type StringToString } from '../convert';
import { binaryStringOp } from '../../value-builders';

export interface BinaryFnString {
  concat: StringToString;
}

export const bfString: BinaryFnString = {
  concat: (a: StringValue<readonly EffectSymbol[]>, b: StringValue<readonly EffectSymbol[]>): StringValue<readonly EffectSymbol[]> => {
    return binaryStringOp((x, y) => x + y, a, b);
  },
} as const;

export type BinaryFnStringNameSpace = 'binaryFnString';
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

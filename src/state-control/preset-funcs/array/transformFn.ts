import { type NumberValue, type ArrayValue, type EffectSymbol } from '../../value';
import { type ToArrayConversion, type ToNumberConversion } from '../convert';
import { buildNumber } from '../../value-builders';

export interface TransformFnArray {
  pass: ToArrayConversion<ArrayValue<readonly EffectSymbol[]>>;
  length: ToNumberConversion<ArrayValue<readonly EffectSymbol[]>>;
}

export const tfArray: TransformFnArray = {
  pass: (val: ArrayValue<readonly EffectSymbol[]>): ArrayValue<readonly EffectSymbol[]> => {
    return val;
  },
  length: (val: ArrayValue<readonly EffectSymbol[]>): NumberValue<readonly EffectSymbol[]> => {
    return buildNumber(val.value.length, val);
  },
} as const;

export type TransformFnArrayNameSpace = 'transformFnArray';
export type TransformFnArrayNames =
  `${TransformFnArrayNameSpace}::${keyof typeof tfArray}`;

export type ReturnMetaTransformFnArray = {
  [K in keyof TransformFnArray]: ReturnType<TransformFnArray[K]>['symbol'];
};

export type ParamsMetaTransformFnArray = {
  [K in keyof TransformFnArray]: [Parameters<TransformFnArray[K]>[0]['symbol']];
};

import { type NumberValue, type StringValue, type EffectSymbol } from '../../value';
import { type ToStringConversion, type ToNumberConversion } from '../convert';
import { buildNumber } from '../../value-builders';

export interface TransformFnString {
  pass: ToStringConversion<StringValue<readonly EffectSymbol[]>>;
  toNumber: ToNumberConversion<StringValue<readonly EffectSymbol[]>>;
}

export const tfString: TransformFnString = {
  pass: (val: StringValue<readonly EffectSymbol[]>): StringValue<readonly EffectSymbol[]> => {
    return val;
  },
  toNumber: (val: StringValue<readonly EffectSymbol[]>): NumberValue<readonly EffectSymbol[]> => {
    return buildNumber(parseInt(val.value), val);
  },
} as const;

export type TransformFnStringNameSpace = 'transformFnString';
export type TransformFnStringNames =
  `${TransformFnStringNameSpace}::${keyof typeof tfString}`;

export type ReturnMetaTransformFnString = {
  [K in keyof TransformFnString]: ReturnType<TransformFnString[K]>['symbol'];
};

export type ParamsMetaTransformFnString = {
  [K in keyof TransformFnString]: [
    Parameters<TransformFnString[K]>[0]['symbol'],
  ];
};

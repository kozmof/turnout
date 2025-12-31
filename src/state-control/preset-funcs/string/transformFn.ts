import { type NumberValue, type StringValue, type TagSymbol } from '../../value';
import { type ToStringConversion, type ToNumberConversion } from '../convert';
import { buildNumber } from '../../value-builders';

export interface TransformFnString {
  pass: ToStringConversion<StringValue<readonly TagSymbol[]>>;
  toNumber: ToNumberConversion<StringValue<readonly TagSymbol[]>>;
}

export const tfString: TransformFnString = {
  pass: (val: StringValue<readonly TagSymbol[]>): StringValue<readonly TagSymbol[]> => {
    return val;
  },
  toNumber: (val: StringValue<readonly TagSymbol[]>): NumberValue<readonly TagSymbol[]> => {
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

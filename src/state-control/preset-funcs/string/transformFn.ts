import { type NumberValue, type StringValue, type TagSymbol } from '../../value';
import { type ToStringConversion, type ToNumberConversion } from '../convert';
import { buildNumber, unaryStringOp } from '../../value-builders';
import { type NamespaceDelimiter } from '../../../util/constants';

export interface TransformFnString {
  pass: ToStringConversion<StringValue<readonly TagSymbol[]>>;
  toNumber: ToNumberConversion<StringValue<readonly TagSymbol[]>>;
  trim: ToStringConversion<StringValue<readonly TagSymbol[]>>;
  toLowerCase: ToStringConversion<StringValue<readonly TagSymbol[]>>;
  toUpperCase: ToStringConversion<StringValue<readonly TagSymbol[]>>;
  length: ToNumberConversion<StringValue<readonly TagSymbol[]>>;
}

export const tfString: TransformFnString = {
  pass: (val: StringValue<readonly TagSymbol[]>): StringValue<readonly TagSymbol[]> => {
    return val;
  },
  toNumber: (val: StringValue<readonly TagSymbol[]>): NumberValue<readonly TagSymbol[]> => {
    return buildNumber(parseInt(val.value), val.tags);
  },
  trim: (val: StringValue<readonly TagSymbol[]>): StringValue<readonly TagSymbol[]> => {
    return unaryStringOp((s) => s.trim(), val);
  },
  toLowerCase: (val: StringValue<readonly TagSymbol[]>): StringValue<readonly TagSymbol[]> => {
    return unaryStringOp((s) => s.toLowerCase(), val);
  },
  toUpperCase: (val: StringValue<readonly TagSymbol[]>): StringValue<readonly TagSymbol[]> => {
    return unaryStringOp((s) => s.toUpperCase(), val);
  },
  length: (val: StringValue<readonly TagSymbol[]>): NumberValue<readonly TagSymbol[]> => {
    return buildNumber(val.value.length, val.tags);
  },
} as const;

export type TransformFnStringNameSpace = 'transformFnString';
export type TransformFnStringNames =
  `${TransformFnStringNameSpace}${NamespaceDelimiter}${keyof typeof tfString}`;

export type ReturnMetaTransformFnString = {
  [K in keyof TransformFnString]: ReturnType<TransformFnString[K]>['symbol'];
};

export type ParamsMetaTransformFnString = {
  [K in keyof TransformFnString]: [
    Parameters<TransformFnString[K]>[0]['symbol'],
  ];
};

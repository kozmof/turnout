import { type NumberValue, type AnyArrayValue, type TagSymbol, type BooleanValue } from '../../value';
import { type ToArrayConversion, type ToNumberConversion, type ToBooleanConversion } from '../convert';
import { buildBoolean, buildNumber } from '../../value-builders';
import { type NamespaceDelimiter } from '../../../util/constants';

export interface TransformFnArray {
  pass: ToArrayConversion<AnyArrayValue<readonly TagSymbol[]>>;
  length: ToNumberConversion<AnyArrayValue<readonly TagSymbol[]>>;
  isEmpty: ToBooleanConversion<AnyArrayValue<readonly TagSymbol[]>>;
}

export const tfArray: TransformFnArray = {
  pass: (val: AnyArrayValue<readonly TagSymbol[]>): AnyArrayValue<readonly TagSymbol[]> => {
    return val;
  },
  length: (val: AnyArrayValue<readonly TagSymbol[]>): NumberValue<readonly TagSymbol[]> => {
    return buildNumber(val.value.length, val.tags);
  },
  isEmpty: (val: AnyArrayValue<readonly TagSymbol[]>): BooleanValue<readonly TagSymbol[]> => {
    return buildBoolean(val.value.length === 0, val.tags);
  },
} as const;

export type TransformFnArrayNameSpace = 'transformFnArray';
export type TransformFnArrayNames =
  `${TransformFnArrayNameSpace}${NamespaceDelimiter}${keyof typeof tfArray}`;

export type ReturnMetaTransformFnArray = {
  [K in keyof TransformFnArray]: ReturnType<TransformFnArray[K]>['symbol'];
};

export type ParamsMetaTransformFnArray = {
  [K in keyof TransformFnArray]: [Parameters<TransformFnArray[K]>[0]['symbol']];
};

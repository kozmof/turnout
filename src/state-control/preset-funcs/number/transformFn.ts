import { type NumberValue, type StringValue, type TagSymbol } from '../../value';
import { type ToNumberConversion, type ToStringConversion } from '../convert';
import { buildString } from '../../value-builders';
import { type NamespaceDelimiter } from '../../../util/constants';

export interface TransformFnNumber {
  pass: ToNumberConversion<NumberValue<readonly TagSymbol[]>>;
  toStr: ToStringConversion<NumberValue<readonly TagSymbol[]>>;
}

export const tfNumber: TransformFnNumber = {
  pass: (val: NumberValue<readonly TagSymbol[]>): NumberValue<readonly TagSymbol[]> => {
    return val;
  },
  toStr: (val: NumberValue<readonly TagSymbol[]>): StringValue<readonly TagSymbol[]> => {
    return buildString(val.value.toString(), val.tags);
  },
} as const;

export type TransformFnNumberNameSpace = 'transformFnNumber';
export type TransformFnNumberNames =
  `${TransformFnNumberNameSpace}${NamespaceDelimiter}${keyof typeof tfNumber}`;

export type ReturnMetaTransformFnNumber = {
  [K in keyof TransformFnNumber]: ReturnType<TransformFnNumber[K]>['symbol'];
};

export type ParamsMetaTransformFnNumber = {
  [K in keyof TransformFnNumber]: [
    Parameters<TransformFnNumber[K]>[0]['symbol'],
  ];
};

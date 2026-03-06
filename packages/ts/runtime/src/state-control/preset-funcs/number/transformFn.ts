import { type NumberValue, type StringValue, type TagSymbol } from '../../value';
import { type ToNumberConversion, type ToStringConversion } from '../convert';
import { buildString, unaryNumberOp } from '../../value-builders';
import { type NamespaceDelimiter } from '../../../util/constants';

export interface TransformFnNumber {
  pass: ToNumberConversion<NumberValue<readonly TagSymbol[]>>;
  toStr: ToStringConversion<NumberValue<readonly TagSymbol[]>>;
  abs: ToNumberConversion<NumberValue<readonly TagSymbol[]>>;
  floor: ToNumberConversion<NumberValue<readonly TagSymbol[]>>;
  ceil: ToNumberConversion<NumberValue<readonly TagSymbol[]>>;
  round: ToNumberConversion<NumberValue<readonly TagSymbol[]>>;
  negate: ToNumberConversion<NumberValue<readonly TagSymbol[]>>;
}

export const tfNumber: TransformFnNumber = {
  pass: (val: NumberValue<readonly TagSymbol[]>): NumberValue<readonly TagSymbol[]> => {
    return val;
  },
  toStr: (val: NumberValue<readonly TagSymbol[]>): StringValue<readonly TagSymbol[]> => {
    return buildString(val.value.toString(), val.tags);
  },
  abs: (val: NumberValue<readonly TagSymbol[]>): NumberValue<readonly TagSymbol[]> => {
    return unaryNumberOp((n) => Math.abs(n), val);
  },
  floor: (val: NumberValue<readonly TagSymbol[]>): NumberValue<readonly TagSymbol[]> => {
    return unaryNumberOp((n) => Math.floor(n), val);
  },
  ceil: (val: NumberValue<readonly TagSymbol[]>): NumberValue<readonly TagSymbol[]> => {
    return unaryNumberOp((n) => Math.ceil(n), val);
  },
  round: (val: NumberValue<readonly TagSymbol[]>): NumberValue<readonly TagSymbol[]> => {
    return unaryNumberOp((n) => Math.round(n), val);
  },
  negate: (val: NumberValue<readonly TagSymbol[]>): NumberValue<readonly TagSymbol[]> => {
    return unaryNumberOp((n) => -n, val);
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

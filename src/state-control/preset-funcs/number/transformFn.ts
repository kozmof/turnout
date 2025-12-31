import { type NumberValue, type StringValue, type EffectSymbol } from '../../value';
import { type ToNumberConversion, type ToStringConversion } from '../convert';
import { buildString } from '../../value-builders';

export interface TransformFnNumber {
  pass: ToNumberConversion<NumberValue<readonly EffectSymbol[]>>;
  toStr: ToStringConversion<NumberValue<readonly EffectSymbol[]>>;
}

export const tfNumber: TransformFnNumber = {
  pass: (val: NumberValue<readonly EffectSymbol[]>): NumberValue<readonly EffectSymbol[]> => {
    return val;
  },
  toStr: (val: NumberValue<readonly EffectSymbol[]>): StringValue<readonly EffectSymbol[]> => {
    return buildString(val.value.toString(), val);
  },
} as const;

export type TransformFnNumberNameSpace = 'transformFnNumber';
export type TransformFnNumberNames =
  `${TransformFnNumberNameSpace}::${keyof typeof tfNumber}`;

export type ReturnMetaTransformFnNumber = {
  [K in keyof TransformFnNumber]: ReturnType<TransformFnNumber[K]>['symbol'];
};

export type ParamsMetaTransformFnNumber = {
  [K in keyof TransformFnNumber]: [
    Parameters<TransformFnNumber[K]>[0]['symbol'],
  ];
};

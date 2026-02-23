import { type BooleanValue, type StringValue, type TagSymbol } from '../../value';
import { type ToBooleanConversion, type ToStringConversion } from '../convert';
import { buildString, unaryBooleanOp } from '../../value-builders';
import { type NamespaceDelimiter } from '../../../util/constants';

export interface TransformFnBoolean {
  pass: ToBooleanConversion<BooleanValue<readonly TagSymbol[]>>;
  not: ToBooleanConversion<BooleanValue<readonly TagSymbol[]>>;
  toStr: ToStringConversion<BooleanValue<readonly TagSymbol[]>>;
}

export const tfBoolean: TransformFnBoolean = {
  pass: (val: BooleanValue<readonly TagSymbol[]>): BooleanValue<readonly TagSymbol[]> => {
    return val;
  },
  not: (val: BooleanValue<readonly TagSymbol[]>): BooleanValue<readonly TagSymbol[]> => {
    return unaryBooleanOp((b) => !b, val);
  },
  toStr: (val: BooleanValue<readonly TagSymbol[]>): StringValue<readonly TagSymbol[]> => {
    return buildString(val.value.toString(), val.tags);
  },
} as const;

export type TransformFnBooleanNameSpace = 'transformFnBoolean';
export type TransformFnBooleanNames =
  `${TransformFnBooleanNameSpace}${NamespaceDelimiter}${keyof typeof tfBoolean}`;

export type ReturnMetaTransformFnBoolean = {
  [K in keyof TransformFnBoolean]: ReturnType<TransformFnBoolean[K]>['symbol'];
};

export type ParamsMetaTransformFnBoolean = {
  [K in keyof TransformFnBoolean]: [Parameters<TransformFnBoolean[K]>[0]['symbol']];
};

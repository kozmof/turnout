import { type NullValue, type TagSymbol } from '../../value';
import { type NamespaceDelimiter } from '../../../util/constants';

export interface TransformFnNull {
  pass: (val: NullValue<readonly TagSymbol[]>) => NullValue<readonly TagSymbol[]>;
}

export const tfNull: TransformFnNull = {
  pass: (val: NullValue<readonly TagSymbol[]>): NullValue<readonly TagSymbol[]> => {
    return val;
  },
} as const;

export type TransformFnNullNameSpace = 'transformFnNull';
export type TransformFnNullNames =
  `${TransformFnNullNameSpace}${NamespaceDelimiter}${keyof typeof tfNull}`;

export type ReturnMetaTransformFnNull = {
  [K in keyof TransformFnNull]: ReturnType<TransformFnNull[K]>['symbol'];
};

export type ParamsMetaTransformFnNull = {
  [K in keyof TransformFnNull]: [Parameters<TransformFnNull[K]>[0]['symbol']];
};

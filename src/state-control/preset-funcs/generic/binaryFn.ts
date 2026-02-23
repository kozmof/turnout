import { isArray, type AnyValue, type BooleanValue, type TagSymbol } from '../../value';
import { type ToBooleanProcess } from '../convert';
import { isComparable } from '../util/isComparable';
import { buildBoolean } from '../../value-builders';
import { type NamespaceDelimiter } from '../../../util/constants';

export interface BinaryFnGeneric<T extends AnyValue> {
  isEqual: ToBooleanProcess<T, T>;
  isNotEqual: ToBooleanProcess<T, T>;
}

function mergeOperandTags(a: AnyValue, b: AnyValue): readonly TagSymbol[] {
  const tagsSet = new Set<TagSymbol>();
  for (const tag of a.tags) tagsSet.add(tag);
  for (const tag of b.tags) tagsSet.add(tag);
  return Array.from(tagsSet);
}

function areValuesEqual(a: AnyValue, b: AnyValue): boolean {
  return isArray(a) && isArray(b)
    ? JSON.stringify(a.value) === JSON.stringify(b.value)
    : a.value === b.value;
}

export const bfGeneric: BinaryFnGeneric<AnyValue> = {
  isEqual: (a: AnyValue, b: AnyValue): BooleanValue<readonly TagSymbol[]> => {
    if (isComparable(a, b)) {
      return buildBoolean(areValuesEqual(a, b), mergeOperandTags(a, b));
    } else {
      throw new Error();
    }
  },
  isNotEqual: (a: AnyValue, b: AnyValue): BooleanValue<readonly TagSymbol[]> => {
    if (isComparable(a, b)) {
      return buildBoolean(!areValuesEqual(a, b), mergeOperandTags(a, b));
    } else {
      throw new Error();
    }
  },
} as const;

export type BinaryFnGenericNameSpace = 'binaryFnGeneric';
export type BinaryFnGenericNames =
  `${BinaryFnGenericNameSpace}${NamespaceDelimiter}${keyof typeof bfGeneric}`;

export type ReturnMetaBinaryFnGeneric = {
  [K in keyof BinaryFnGeneric<AnyValue>]: ReturnType<
    BinaryFnGeneric<AnyValue>[K]
  >['symbol'];
};

export type ParamsMetaBinaryFnGeneric = {
  [K in keyof BinaryFnGeneric<AnyValue>]: [
    Parameters<BinaryFnGeneric<AnyValue>[K]>[0]['symbol'],
    Parameters<BinaryFnGeneric<AnyValue>[K]>[1]['symbol'],
  ];
};

import { isArray, type AnyValue, type BooleanValue, type TagSymbol } from '../../value';
import { type ToBooleanProcess } from '../convert';
import { isComparable } from '../util/isComparable';
import { buildBoolean } from '../../value-builders';

export interface BinaryFnGeneric<T extends AnyValue> {
  isEqual: ToBooleanProcess<T, T>;
}

export const bfGeneric: BinaryFnGeneric<AnyValue> = {
  isEqual: (a: AnyValue, b: AnyValue): BooleanValue<readonly TagSymbol[]> => {
    if (isComparable(a, b)) {
      const areEqual =
        isArray(a) && isArray(b)
          ? JSON.stringify(a.value) === JSON.stringify(b.value)
          : a.value === b.value;

      // Merge tags from both operands
      const tagsSet = new Set<TagSymbol>();
      for (const tag of a.tags) tagsSet.add(tag);
      for (const tag of b.tags) tagsSet.add(tag);
      const mergedTags = Array.from(tagsSet);

      return buildBoolean(areEqual, mergedTags);
    } else {
      throw new Error();
    }
  },
} as const;

export type BinaryFnGenericNameSpace = 'binaryFnGeneric';
export type BinaryFnGenericNames =
  `${BinaryFnGenericNameSpace}::${keyof typeof bfGeneric}`;

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

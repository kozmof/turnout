import {
  type BooleanValue,
  type ArrayValue,
  type NonArrayValue,
  type NumberValue,
  type TagSymbol,
  AnyValue,
} from '../../value';
import { type ArrayToArray, type ToItemtProcess, type ToBooleanProcess } from '../convert';
import { buildArray, buildBoolean } from '../../value-builders';
import { type NamespaceDelimiter } from '../../../util/constants';

export interface BinaryFnArray {
  includes: ToBooleanProcess<ArrayValue<readonly TagSymbol[]>, NonArrayValue>;
  get: ToItemtProcess<ArrayValue<readonly TagSymbol[]>, NonArrayValue, NumberValue<readonly TagSymbol[]>>;
  concat: ArrayToArray;
}

const isNonArrayValue = (val: AnyValue): val is NonArrayValue => {
  return !Array.isArray(val.value);
};

/**
 * Merges tags from item with array and index tags.
 * This is specific to array get operations where we need to combine
 * the item's own tags with tags from accessing it.
 */
function mergeItemTags(
  item: NonArrayValue,
  array: ArrayValue<readonly TagSymbol[]>,
  index: NumberValue<readonly TagSymbol[]>
): readonly TagSymbol[] {
  const tagsSet = new Set<TagSymbol>();

  // Add item's own tags
  for (const tag of item.tags) {
    tagsSet.add(tag);
  }

  // Add array's tags
  for (const tag of array.tags) {
    tagsSet.add(tag);
  }

  // Add index's tags
  for (const tag of index.tags) {
    tagsSet.add(tag);
  }

  return Array.from(tagsSet);
}

function mergeArrayTags(
  a: ArrayValue<readonly TagSymbol[]>,
  b: ArrayValue<readonly TagSymbol[]>
): readonly TagSymbol[] {
  const tagsSet = new Set<TagSymbol>();
  for (const tag of a.tags) tagsSet.add(tag);
  for (const tag of b.tags) tagsSet.add(tag);
  return Array.from(tagsSet);
}

export const bfArray: BinaryFnArray = {
  includes: (a: ArrayValue<readonly TagSymbol[]>, b: NonArrayValue): BooleanValue<readonly TagSymbol[]> => {
    const contains = a.value.map((val) => val.value).includes(b.value);

    // Merge tags from both operands
    const tagsSet = new Set<TagSymbol>();
    for (const tag of a.tags) tagsSet.add(tag);
    for (const tag of b.tags) tagsSet.add(tag);
    const mergedTags = Array.from(tagsSet);

    return buildBoolean(contains, mergedTags);
  },
  get: (a: ArrayValue<readonly TagSymbol[]>, idx: NumberValue<readonly TagSymbol[]>): NonArrayValue => {
    const item = a.value.at(idx.value);
    if (item !== undefined && isNonArrayValue(item)) {
      // Propagate tags from both the array and the index to the retrieved item
      return {
        ...item,
        tags: mergeItemTags(item, a, idx),
      };
    } else {
      throw new Error(
        `Array index ${String(idx.value)} is out of bounds (length: ${String(a.value.length)}) or the item at that index is an array`
      );
    }
  },
  concat: (a: ArrayValue<readonly TagSymbol[]>, b: ArrayValue<readonly TagSymbol[]>): ArrayValue<readonly TagSymbol[]> => {
    return buildArray([...a.value, ...b.value], mergeArrayTags(a, b));
  },
} as const;

export type BinaryFnArrayNameSpace = 'binaryFnArray';
export type BinaryFnArrayNames =
  `${BinaryFnArrayNameSpace}${NamespaceDelimiter}${keyof typeof bfArray}`;

export type ReturnMetaBinaryFnArray = {
  [K in keyof BinaryFnArray]: ReturnType<BinaryFnArray[K]>['symbol'];
};

export type ParamsMetaBinaryFnArray = {
  [K in keyof BinaryFnArray]: [
    Parameters<BinaryFnArray[K]>[0]['symbol'],
    Parameters<BinaryFnArray[K]>[1]['symbol'],
  ];
};

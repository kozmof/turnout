import {
  type BooleanValue,
  type ArrayValue,
  type NonArrayValue,
  type NumberValue,
  type TagSymbol,
  AnyValue,
} from '../../value';
import { type ToItemtProcess, type ToBooleanProcess } from '../convert';
import { buildBoolean } from '../../value-builders';

export interface BinaryFnArray {
  includes: ToBooleanProcess<ArrayValue<readonly TagSymbol[]>, NonArrayValue>;
  get: ToItemtProcess<ArrayValue<readonly TagSymbol[]>, NonArrayValue, NumberValue<readonly TagSymbol[]>>;
}

const isNonArrayValue = (val: AnyValue): val is NonArrayValue => {
  return !Array.isArray(val.value);
};

/**
 * Merges tags from item with array and index tags.
 * This is specific to array get operations where we need to combine
 * the item's own tags with tags from accessing it.
 */
function mergeItemEffects(
  item: NonArrayValue,
  array: ArrayValue<readonly TagSymbol[]>,
  index: NumberValue<readonly TagSymbol[]>
): readonly TagSymbol[] {
  const effectsSet = new Set<TagSymbol>();

  // Add item's own tags
  for (const effect of item.tags) {
    effectsSet.add(effect);
  }

  // Add array's tags
  for (const effect of array.tags) {
    effectsSet.add(effect);
  }

  // Add index's tags
  for (const effect of index.tags) {
    effectsSet.add(effect);
  }

  return Array.from(effectsSet);
}

export const bfArray: BinaryFnArray = {
  includes: (a: ArrayValue<readonly TagSymbol[]>, b: NonArrayValue): BooleanValue<readonly TagSymbol[]> => {
    const contains = a.value.map((val) => val.value).includes(b.value);
    return buildBoolean(contains, a, b);
  },
  get: (a: ArrayValue<readonly TagSymbol[]>, idx: NumberValue<readonly TagSymbol[]>): NonArrayValue => {
    const item = a.value.at(idx.value);
    if (item !== undefined && isNonArrayValue(item)) {
      // Propagate tags from both the array and the index to the retrieved item
      return {
        ...item,
        tags: mergeItemEffects(item, a, idx),
      };
    } else {
      throw new Error(
        `Array index ${idx.value} is out of bounds (length: ${a.value.length}) or the item at that index is an array`
      );
    }
  },
} as const;

export type BinaryFnArrayNameSpace = 'binaryFnArray';
export type BinaryFnArrayNames =
  `${BinaryFnArrayNameSpace}::${keyof typeof bfArray}`;

export type ReturnMetaBinaryFnArray = {
  [K in keyof BinaryFnArray]: ReturnType<BinaryFnArray[K]>['symbol'];
};

export type ParamsMetaBinaryFnArray = {
  [K in keyof BinaryFnArray]: [
    Parameters<BinaryFnArray[K]>[0]['symbol'],
    Parameters<BinaryFnArray[K]>[1]['symbol'],
  ];
};

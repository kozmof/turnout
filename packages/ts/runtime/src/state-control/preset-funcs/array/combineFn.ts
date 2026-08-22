import {
  type BooleanValue,
  type AnyArrayValue,
  type NonArrayValue,
  type NumberValue,
  type StringValue,
  type RecordValue,
  type TagSymbol,
  AnyValue,
} from "../../value.js";
import { type ArrayToArray, type ToItemtProcess, type ToBooleanProcess } from "../convert.js";
import { buildArray, buildBoolean, recordGet, recordSet } from "../../value-builders.js";
import { type NamespaceDelimiter } from "../../../util/constants.js";

export interface CombineFnArray {
  includes: ToBooleanProcess<AnyArrayValue<readonly TagSymbol[]>, NonArrayValue>;
  get: ToItemtProcess<
    AnyArrayValue<readonly TagSymbol[]>,
    NonArrayValue,
    NumberValue<readonly TagSymbol[]>
  >;
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
  array: AnyArrayValue<readonly TagSymbol[]>,
  index: NumberValue<readonly TagSymbol[]>,
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
  a: AnyArrayValue<readonly TagSymbol[]>,
  b: AnyArrayValue<readonly TagSymbol[]>,
): readonly TagSymbol[] {
  const tagsSet = new Set<TagSymbol>();
  for (const tag of a.tags) tagsSet.add(tag);
  for (const tag of b.tags) tagsSet.add(tag);
  return Array.from(tagsSet);
}

export const cfArray: CombineFnArray = {
  includes: (
    a: AnyArrayValue<readonly TagSymbol[]>,
    b: NonArrayValue,
  ): BooleanValue<readonly TagSymbol[]> => {
    const contains = a.value.map((val) => val.value).includes(b.value);

    // Merge tags from both operands
    const tagsSet = new Set<TagSymbol>();
    for (const tag of a.tags) tagsSet.add(tag);
    for (const tag of b.tags) tagsSet.add(tag);
    const mergedTags = Array.from(tagsSet);

    return buildBoolean(contains, mergedTags);
  },
  get: (
    a: AnyArrayValue<readonly TagSymbol[]>,
    idx: NumberValue<readonly TagSymbol[]>,
  ): NonArrayValue => {
    // Only non-negative integers within range are valid. `.at()` would accept
    // negative indices and silently return from the end, masking out-of-bounds.
    if (!Number.isInteger(idx.value) || idx.value < 0 || idx.value >= a.value.length) {
      throw new Error(
        `Array index ${String(idx.value)} is out of bounds (length: ${String(a.value.length)})`,
      );
    }
    const item = a.value[idx.value];
    if (item !== undefined && isNonArrayValue(item)) {
      // Propagate tags from both the array and the index to the retrieved item
      return {
        ...item,
        tags: mergeItemTags(item, a, idx),
      };
    } else {
      throw new Error(
        `Array index ${String(idx.value)} is out of bounds (length: ${String(a.value.length)}) or the item at that index is an array`,
      );
    }
  },
  concat: (
    a: AnyArrayValue<readonly TagSymbol[]>,
    b: AnyArrayValue<readonly TagSymbol[]>,
  ): AnyArrayValue<readonly TagSymbol[]> => {
    return buildArray([...a.value, ...b.value], mergeArrayTags(a, b));
  },
} as const;

export type CombineFnArrayNameSpace = "combineFnArray";
export type CombineFnArrayNames =
  `${CombineFnArrayNameSpace}${NamespaceDelimiter}${keyof typeof cfArray}`;

export type ReturnMetaCombineFnArray = {
  [K in keyof CombineFnArray]: ReturnType<CombineFnArray[K]>["symbol"];
};

export const cfRecord = {
  getNumber: (
    record: RecordValue<readonly TagSymbol[]>,
    key: StringValue<readonly TagSymbol[]> | NumberValue<readonly TagSymbol[]>,
  ) => recordGet(record, key),
  getString: (
    record: RecordValue<readonly TagSymbol[]>,
    key: StringValue<readonly TagSymbol[]> | NumberValue<readonly TagSymbol[]>,
  ) => recordGet(record, key),
  getBoolean: (
    record: RecordValue<readonly TagSymbol[]>,
    key: StringValue<readonly TagSymbol[]> | NumberValue<readonly TagSymbol[]>,
  ) => recordGet(record, key),
  set: (
    record: RecordValue<readonly TagSymbol[]>,
    key: StringValue<readonly TagSymbol[]> | NumberValue<readonly TagSymbol[]>,
    value: AnyValue,
  ) => recordSet(record, key, value),
} as const;
export type CombineFnRecordNames =
  | "combineFnRecord::getNumber"
  | "combineFnRecord::getString"
  | "combineFnRecord::getBoolean"
  | "combineFnRecord::set";

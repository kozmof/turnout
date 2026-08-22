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
import { type ArrayToArray, type ToBooleanProcess } from "../convert.js";
import { buildArray, buildBoolean, recordGet, recordSet } from "../../value-builders.js";
import { type NamespaceDelimiter } from "../../../util/constants.js";

export interface CombineFnArray {
  includes: ToBooleanProcess<AnyArrayValue<readonly TagSymbol[]>, NonArrayValue>;
  get: (
    array: AnyArrayValue<readonly TagSymbol[]>,
    index: NumberValue<readonly TagSymbol[]>,
  ) => AnyValue;
  getNumber: (
    array: AnyArrayValue<readonly TagSymbol[]>,
    index: NumberValue<readonly TagSymbol[]>,
  ) => AnyValue;
  getString: (
    array: AnyArrayValue<readonly TagSymbol[]>,
    index: NumberValue<readonly TagSymbol[]>,
  ) => AnyValue;
  getBoolean: (
    array: AnyArrayValue<readonly TagSymbol[]>,
    index: NumberValue<readonly TagSymbol[]>,
  ) => AnyValue;
  getArray: (
    array: AnyArrayValue<readonly TagSymbol[]>,
    index: NumberValue<readonly TagSymbol[]>,
  ) => AnyValue;
  getRecord: (
    array: AnyArrayValue<readonly TagSymbol[]>,
    index: NumberValue<readonly TagSymbol[]>,
  ) => AnyValue;
  concat: ArrayToArray;
}

/**
 * Merges tags from item with array and index tags.
 * This is specific to array get operations where we need to combine
 * the item's own tags with tags from accessing it.
 */
function getArrayItem(
  array: AnyArrayValue<readonly TagSymbol[]>,
  index: NumberValue<readonly TagSymbol[]>,
): AnyValue {
  if (!Number.isInteger(index.value) || index.value < 0 || index.value >= array.value.length) {
    throw new Error(
      "Array index " +
        String(index.value) +
        " is out of bounds (length: " +
        String(array.value.length) +
        ")",
    );
  }
  const item = array.value[index.value];
  if (item === undefined) {
    throw new Error(
      "Array index " +
        String(index.value) +
        " is out of bounds (length: " +
        String(array.value.length) +
        ")",
    );
  }
  return { ...item, tags: mergeItemTags(item, array, index) };
}

function mergeItemTags(
  item: AnyValue,
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
  get: getArrayItem,
  getNumber: getArrayItem,
  getString: getArrayItem,
  getBoolean: getArrayItem,
  getArray: getArrayItem,
  getRecord: getArrayItem,
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
  getArray: (
    record: RecordValue<readonly TagSymbol[]>,
    key: StringValue<readonly TagSymbol[]> | NumberValue<readonly TagSymbol[]>,
  ) => recordGet(record, key),
  getRecord: (
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
  | "combineFnRecord::getArray"
  | "combineFnRecord::getRecord"
  | "combineFnRecord::set";

import { isArray, type AnyValue, type BooleanValue, type TagSymbol } from "../../value.js";
import { type ToBooleanProcess } from "../convert.js";
import { isComparable } from "../util/isComparable.js";
import { buildBoolean } from "../../value-builders.js";
import { type NamespaceDelimiter } from "../../../util/constants.js";

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

/**
 * Structural, tag-insensitive value equality.
 *
 * Scalars compare by their underlying `.value` (matching strict `===` semantics,
 * so differing base types are unequal). Arrays compare length and then element
 * for element with the same rule. Tags never participate in equality — this keeps
 * array equality consistent with scalar equality, which ignores tags entirely.
 */
function areValuesEqual(a: AnyValue, b: AnyValue): boolean {
  if (isArray(a) && isArray(b)) {
    return (
      a.value.length === b.value.length &&
      a.value.every((el, i) => areValuesEqual(el, b.value[i] as AnyValue))
    );
  }
  return a.value === b.value;
}

export const bfGeneric: BinaryFnGeneric<AnyValue> = {
  isEqual: (a: AnyValue, b: AnyValue): BooleanValue<readonly TagSymbol[]> => {
    if (isComparable(a, b)) {
      return buildBoolean(areValuesEqual(a, b), mergeOperandTags(a, b));
    } else {
      throw new Error("Cannot compare " + a.symbol + " and " + b.symbol + " values for equality");
    }
  },
  isNotEqual: (a: AnyValue, b: AnyValue): BooleanValue<readonly TagSymbol[]> => {
    if (isComparable(a, b)) {
      return buildBoolean(!areValuesEqual(a, b), mergeOperandTags(a, b));
    } else {
      throw new Error("Cannot compare " + a.symbol + " and " + b.symbol + " values for inequality");
    }
  },
} as const;

export type BinaryFnGenericNameSpace = "binaryFnGeneric";
export type BinaryFnGenericNames =
  `${BinaryFnGenericNameSpace}${NamespaceDelimiter}${keyof typeof bfGeneric}`;

export type ReturnMetaBinaryFnGeneric = {
  [K in keyof BinaryFnGeneric<AnyValue>]: ReturnType<BinaryFnGeneric<AnyValue>[K]>["symbol"];
};

export type ParamsMetaBinaryFnGeneric = {
  [K in keyof BinaryFnGeneric<AnyValue>]: [
    Parameters<BinaryFnGeneric<AnyValue>[K]>[0]["symbol"],
    Parameters<BinaryFnGeneric<AnyValue>[K]>[1]["symbol"],
  ];
};

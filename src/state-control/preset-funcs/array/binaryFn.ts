import {
  type BooleanValue,
  type ArrayValue,
  type NonArrayValue,
  type NumberValue,
  type EffectSymbol,
  AnyValue,
} from '../../value';
import { type ToItemtProcess, type ToBooleanProcess } from '../convert';
import { buildBoolean } from '../../value-builders';

export interface BinaryFnArray {
  includes: ToBooleanProcess<ArrayValue<readonly EffectSymbol[]>, NonArrayValue>;
  get: ToItemtProcess<ArrayValue<readonly EffectSymbol[]>, NonArrayValue, NumberValue<readonly EffectSymbol[]>>;
}

const isNonArrayValue = (val: AnyValue): val is NonArrayValue => {
  return !Array.isArray(val.value);
};

/**
 * Merges effects from item with array and index effects.
 * This is specific to array get operations where we need to combine
 * the item's own effects with effects from accessing it.
 */
function mergeItemEffects(
  item: NonArrayValue,
  array: ArrayValue<readonly EffectSymbol[]>,
  index: NumberValue<readonly EffectSymbol[]>
): readonly EffectSymbol[] {
  const effectsSet = new Set<EffectSymbol>();

  // Add item's own effects
  for (const effect of item.effects) {
    effectsSet.add(effect);
  }

  // Add array's effects
  for (const effect of array.effects) {
    effectsSet.add(effect);
  }

  // Add index's effects
  for (const effect of index.effects) {
    effectsSet.add(effect);
  }

  return Array.from(effectsSet);
}

export const bfArray: BinaryFnArray = {
  includes: (a: ArrayValue<readonly EffectSymbol[]>, b: NonArrayValue): BooleanValue<readonly EffectSymbol[]> => {
    const contains = a.value.map((val) => val.value).includes(b.value);
    return buildBoolean(contains, a, b);
  },
  get: (a: ArrayValue<readonly EffectSymbol[]>, idx: NumberValue<readonly EffectSymbol[]>): NonArrayValue => {
    const item = a.value.at(idx.value);
    if (item !== undefined && isNonArrayValue(item)) {
      // Propagate effects from both the array and the index to the retrieved item
      return {
        ...item,
        effects: mergeItemEffects(item, a, idx),
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

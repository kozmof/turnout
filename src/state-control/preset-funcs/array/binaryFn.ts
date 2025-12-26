import {
  type BooleanValue,
  type ArrayValue,
  type NonArrayValue,
  type NumberValue,
  type EffectSymbol,
  AnyValue,
} from '../../value';
import { type ToItemtProcess, type ToBooleanProcess } from '../convert';
import { propagateEffects } from '../util/propagateEffects';

export interface BinaryFnArray {
  includes: ToBooleanProcess<ArrayValue<readonly EffectSymbol[]>, NonArrayValue>;
  get: ToItemtProcess<ArrayValue<readonly EffectSymbol[]>, NonArrayValue, NumberValue<readonly EffectSymbol[]>>;
}

const isNonArrayValue = (val: AnyValue): val is NonArrayValue => {
  return !Array.isArray(val.value);
};

export const bfArray: BinaryFnArray = {
  includes: (a: ArrayValue<readonly EffectSymbol[]>, b: NonArrayValue): BooleanValue<readonly EffectSymbol[]> => {
    return {
      symbol: 'boolean',
      value: a.value.map((val) => val.value).includes(b.value),
      subSymbol: undefined,
      effects: propagateEffects(a, b),
    };
  },
  get: (a: ArrayValue<readonly EffectSymbol[]>, idx: NumberValue<readonly EffectSymbol[]>): NonArrayValue => {
    const item = a.value.at(idx.value);
    if (item !== undefined && isNonArrayValue(item)) {
      // Propagate effects from both the array and the index to the retrieved item
      const combinedEffects = propagateEffects(a, idx);
      return {
        ...item,
        effects: [...new Set([...item.effects, ...combinedEffects])] as readonly EffectSymbol[],
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

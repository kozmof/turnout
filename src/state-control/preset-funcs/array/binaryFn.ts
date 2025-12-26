import {
  type BooleanValue,
  type ArrayValue,
  type NonArrayValue,
  type NumberValue,
  type EffectSymbol,
  AnyValue,
} from '../../value';
import { type ToItemtProcess, type ToBooleanProcess } from '../convert';
import { propagateEffects } from '../util/propagateRandom';

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
    // TODO
    const item = a.value.at(idx.value);
    if (item !== undefined && isNonArrayValue(item)) {
      return item;
    } else {
      throw new Error();
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

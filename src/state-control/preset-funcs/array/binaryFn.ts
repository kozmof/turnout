import {
  type BooleanValue,
  type ArrayValue,
  type NonArrayValue,
  type NumberValue,
  AnyValue,
} from '../../value';
import { type ToItemtProcess, type ToBooleanProcess } from '../convert';
import { propageteRandom } from '../util/propagateRandom';

export interface BinaryFnArray {
  includes: ToBooleanProcess<ArrayValue, NonArrayValue>;
  get: ToItemtProcess<ArrayValue, NonArrayValue, NumberValue>;
}

const isNonArrayValue = (val: AnyValue): val is NonArrayValue => {
  return !Array.isArray(val.value);
};

export const bfArray: BinaryFnArray = {
  includes: (a: ArrayValue, b: NonArrayValue): BooleanValue => {
    return {
      symbol: propageteRandom('boolean', a, b),
      value: a.value.map((val) => val.value).includes(b.value),
      subSymbol: undefined,
    };
  },
  get: (a: ArrayValue, idx: NumberValue): NonArrayValue => {
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

import { isRandomValue } from '../../ops';
import {
  type BooleanValue,
  type ArrayValue,
  type NonArrayValue,
  type NumberValue,
} from '../../value';
import { type ToItemtProcess, type ToBooleanProcess } from '../convert';

export interface BinaryFnArray {
  includes: ToBooleanProcess<ArrayValue, NonArrayValue>;
  get: ToItemtProcess<ArrayValue, NonArrayValue, NumberValue>;
}

export const bfArray: BinaryFnArray = {
  includes: (a: ArrayValue, b: NonArrayValue): BooleanValue => {
    const isRandom = isRandomValue(a, b);
    return {
      symbol: isRandom ? 'random-boolean' : 'boolean',
      value: a.value.map((val) => val.value).includes(b.value),
      subSymbol: undefined,
    };
  },
  get: (a: ArrayValue, idx: NumberValue): NonArrayValue => {
    // TODO
    const item = a.value.at(idx.value);
    if (item !== undefined) {
      return item as NonArrayValue;
    } else {
      throw new Error();
    }
  },
};

export type ReturnMetaBinaryFnArray = {
  [K in keyof BinaryFnArray]: ReturnType<
    BinaryFnArray[K]
  >['symbol'];
};

export type ParamsMetaBinaryFnArray = {
  [K in keyof BinaryFnArray]: [
    Parameters<BinaryFnArray[K]>[0]['symbol'],
    Parameters<BinaryFnArray[K]>[1]['symbol'],
  ];
};

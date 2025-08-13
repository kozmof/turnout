import { isRandomValue } from '../../ops';
import {
  type BooleanValue,
  type ArrayValue,
  type NonArrayValue,
  type NumberValue,
} from '../../value';
import { type ToItemtProcess, type ToBooleanProcess } from '../convert';

export interface ProcessArray {
  includes: ToBooleanProcess<ArrayValue, NonArrayValue>;
  get: ToItemtProcess<ArrayValue, NonArrayValue, NumberValue>;
}

export const pArray: ProcessArray = {
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

export type ReturnMetaProcessArray = {
  [K in keyof ProcessArray]: ReturnType<
    ProcessArray[K]
  >['symbol'];
};

export type ParamsMetaProcessArray = {
  [K in keyof ProcessArray]: [
    Parameters<ProcessArray[K]>[0]['symbol'],
    Parameters<ProcessArray[K]>[1]['symbol'],
  ];
};

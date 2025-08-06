import { isRandomValue } from '../../ops';
import {
  type BooleanValue,
  type ArrayValue,
  type NonArrayValue,
  isArray,
  type NumberValue,
} from '../../value';
import { type ToItemtProcess, type ToBooleanProcess } from '../convert';

export interface ProcessArray<
  T extends ArrayValue,
  U extends NonArrayValue,
  Idx extends NumberValue,
> {
  includes: ToBooleanProcess<T, U>;
  get: ToItemtProcess<T, U, Idx>;
}

export const pArray: ProcessArray<ArrayValue, NonArrayValue, NumberValue> = {
  /**
   *
   * @param a raw value must be `array`
   * @param b raw value must be `any` except `array`
   * @returns raw value must be `boolean`
   */
  includes: (a: ArrayValue, b: NonArrayValue): BooleanValue => {
    if (isArray(a) && !isArray(b)) {
      const isRandom = isRandomValue(a, b);
      return {
        symbol: isRandom ? 'random-boolean' : 'boolean',
        value: a.value.map((val) => val.value).includes(b.value),
        subSymbol: undefined,
      };
    } else {
      throw new Error();
    }
  },
  get: (a: ArrayValue, idx: NumberValue): NonArrayValue => {
    if (isArray(a) && !isArray(idx)) {
      // TODO
      const item = a.value.at(idx.value);
      if (item !== undefined) {
        return item as NonArrayValue;
      } else {
        throw new Error();
      }
    } else {
      throw new Error();
    }
  },
};

export type ReturnMetaProcessArray = {
  [K in keyof ProcessArray<ArrayValue, NonArrayValue, NumberValue>]: ReturnType<
    ProcessArray<ArrayValue, NonArrayValue, NumberValue>[K]
  >['symbol'];
};

export type ParamsMetaProcessArray = {
  [K in keyof ProcessArray<ArrayValue, NonArrayValue, NumberValue>]: [
    Parameters<
      ProcessArray<ArrayValue, NonArrayValue, NumberValue>[K]
    >[0]['symbol'],
    Parameters<
      ProcessArray<ArrayValue, NonArrayValue, NumberValue>[K]
    >[1]['symbol'],
  ];
};

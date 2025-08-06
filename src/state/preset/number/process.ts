import { isRandomValue } from '../../ops';
import { type AnyValue, type NumberValue, isNumber } from '../../value';
import { type ToNumberProcess } from '../convert';

export interface ProcessNumber<T extends AnyValue, U extends AnyValue> {
  add: ToNumberProcess<T, U>
  minus: ToNumberProcess<T, U>
  multiply: ToNumberProcess<T, U>
  divide: ToNumberProcess<T, U>
}

export const pNumber: ProcessNumber<AnyValue, AnyValue> = {
  /**
   * 
   * @param a raw value must be `number`
   * @param b raw value must be `number`
   * @returns raw value must be `number`
   */
  add: (a: AnyValue, b: AnyValue): NumberValue => {
    if (isNumber(a) && isNumber(b)) {
      const isRandom = isRandomValue(a, b);
      return {
        symbol: isRandom ? 'random-number' : 'number',
        value: a.value + b.value,
        subSymbol: undefined
      };
    } else {
      throw new Error();
    }
  },
  /**
   * 
   * @param a raw value must be `number`
   * @param b raw value must be `number`
   * @returns raw value must be `number`
   */
  minus: (a: AnyValue, b: AnyValue): NumberValue => {
    if (isNumber(a) && isNumber(b)) {
      const isRandom = isRandomValue(a, b);
      return {
        symbol: isRandom ? 'random-number' : 'number',
        value: a.value - b.value,
        subSymbol: undefined
      };
    } else {
      throw new Error();
    }
  },
  /**
   * 
   * @param a raw value must be `number`
   * @param b raw value must be `number`
   * @returns raw value must be `number`
   */
  multiply: (a: AnyValue, b: AnyValue): NumberValue => {
    if (isNumber(a) && isNumber(b)) {
      const isRandom = isRandomValue(a, b);
      return {
        symbol: isRandom ? 'random-number' : 'number',
        value: a.value * b.value,
        subSymbol: undefined
      };
    } else {
      throw new Error();
    }
  },
  /**
   * 
   * @param a raw value must be `number`
   * @param b raw value must be `number`
   * @returns raw value must be `number`
   */
  divide: (a: AnyValue, b: AnyValue): NumberValue => {
    if (isNumber(a) && isNumber(b)) {
      const isRandom = isRandomValue(a, b);
      return {
        symbol: isRandom ? 'random-number' : 'number',
        value: a.value / b.value,
        subSymbol: undefined
      };
    } else {
      throw new Error();
    }
  }
};

export type ReturnMetaProcessNumber = {
  [K in keyof ProcessNumber<NumberValue, NumberValue>]: ReturnType<ProcessNumber<NumberValue, NumberValue>[K]>['symbol']
}

export type ParamsMetaProcessNumber= {
  [K in keyof ProcessNumber<NumberValue, NumberValue>]: [
    Parameters<ProcessNumber<NumberValue, NumberValue>[K]>[0]['symbol'],
    Parameters<ProcessNumber<NumberValue, NumberValue>[K]>[1]['symbol']
  ]
}

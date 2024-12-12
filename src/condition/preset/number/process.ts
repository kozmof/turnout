import { isRandomValue } from "../../ops";
import { type AllValue, type NumberValue, isFixedNumber, isRandomNumber } from "../../value";
import { type ToNumberProcess } from "../convert";

export interface ProcessNumber<T extends AllValue, U extends AllValue> {
  add: ToNumberProcess<T, U>
  minus: ToNumberProcess<T, U>
  multiply: ToNumberProcess<T, U>
  divide: ToNumberProcess<T, U>
}

export const pNumber: ProcessNumber<AllValue, AllValue> = {
  /**
   * 
   * @param a raw value must be `number`
   * @param b raw value must be `number`
   * @returns raw value must be `number`
   */
  add: (a: AllValue, b: AllValue): NumberValue => {
    if ((isFixedNumber(a) || isRandomNumber(a)) && (isFixedNumber(b) || isRandomNumber(b))) {
      const isRandom = isRandomValue(a, b);
      return {
        symbol: isRandom ? "random-number" : "number",
        value: a.value + b.value
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
  minus: (a: AllValue, b: AllValue): NumberValue => {
    if ((isFixedNumber(a) || isRandomNumber(a)) && (isFixedNumber(b) || isRandomNumber(b))) {
      const isRandom = isRandomValue(a, b);
      return {
        symbol: isRandom ? "random-number" : "number",
        value: a.value - b.value
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
  multiply: (a: AllValue, b: AllValue): NumberValue => {
    if ((isFixedNumber(a) || isRandomNumber(a)) && (isFixedNumber(b) || isRandomNumber(b))) {
      const isRandom = isRandomValue(a, b);
      return {
        symbol: isRandom ? "random-number" : "number",
        value: a.value * b.value
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
  divide: (a: AllValue, b: AllValue): NumberValue => {
    if ((isFixedNumber(a) || isRandomNumber(a)) && (isFixedNumber(b) || isRandomNumber(b))) {
      const isRandom = isRandomValue(a, b);
      return {
        symbol: isRandom ? "random-number" : "number",
        value: a.value / b.value
      };
    } else {
      throw new Error();
    }
  }
};

export type MetaProcessNumber = {
  [K in keyof ProcessNumber<NumberValue, NumberValue>]: ReturnType<ProcessNumber<NumberValue, NumberValue>[K]>["symbol"]
}

export type ParamsMetaProcessNumber= {
  [K in keyof ProcessNumber<NumberValue, NumberValue>]: [
    Parameters<ProcessNumber<NumberValue, NumberValue>[K]>[0]["symbol"],
    Parameters<ProcessNumber<NumberValue, NumberValue>[K]>[1]["symbol"]
  ]
}

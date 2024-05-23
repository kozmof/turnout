import { isRandomValue } from "../../ops";
import { type AllValues, type NumberValue, isFixedNumber, isRandomNumber } from "../../value";
import { type ToNumberProcess } from "../convert";

export interface ProcessNumber<T extends AllValues, U extends AllValues> {
  add: ToNumberProcess<T, U>
  minus: ToNumberProcess<T, U>
  multiply: ToNumberProcess<T, U>
  divide: ToNumberProcess<T, U>
}

export const pNumber: ProcessNumber<AllValues, AllValues> = {
  /**
   * 
   * @param a raw value is `number`
   * @param b raw value is `number`
   * @returns raw value is `number`
   */
  add: (a: AllValues, b: AllValues): NumberValue => {
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
   * @param a raw value is `number`
   * @param b raw value is `number`
   * @returns raw value is `number`
   */
  minus: (a: AllValues, b: AllValues): NumberValue => {
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
   * @param a raw value is `number`
   * @param b raw value is `number`
   * @returns raw value is `number`
   */
  multiply: (a: AllValues, b: AllValues): NumberValue => {
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
   * @param a raw value is `number`
   * @param b raw value is `number`
   * @returns raw value is `number`
   */
  divide: (a: AllValues, b: AllValues): NumberValue => {
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

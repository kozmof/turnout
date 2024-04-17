import { isRandomValue } from "../../ops";
import { type AllValues, type NumberValue, isFixedNumber, isRandomNumber } from "../../value";
import { type ToNumberProcess } from "../convert";

export interface ProcessNumber {
  add: ToNumberProcess
  minus: ToNumberProcess
  multiply: ToNumberProcess
  divide: ToNumberProcess
}

export const pNumber: ProcessNumber = {
  add: (a: AllValues, b: AllValues) : NumberValue => {
    if((isFixedNumber(a) || isRandomNumber(a)) && (isFixedNumber(b) || isRandomNumber(b))) {
      const isRandom = isRandomValue(a, b);
      return {
        symbol: isRandom ? "random-number" : "number",
        value: a.value + b.value
      };
    } else {
      throw new Error();
    }
  },
  minus: (a: AllValues, b: AllValues) : NumberValue => {
    if((isFixedNumber(a) || isRandomNumber(a)) && (isFixedNumber(b) || isRandomNumber(b))) {
      const isRandom = isRandomValue(a, b);
      return {
        symbol: isRandom ? "random-number" : "number",
        value: a.value - b.value
      };
    } else {
      throw new Error();
    }
  },
  multiply: (a: AllValues, b: AllValues) : NumberValue => {
    if((isFixedNumber(a) || isRandomNumber(a)) && (isFixedNumber(b) || isRandomNumber(b))) {
      const isRandom = isRandomValue(a, b);
      return {
        symbol: isRandom ? "random-number" : "number",
        value: a.value * b.value
      };
    } else {
      throw new Error();
    }
  },
  divide: (a: AllValues, b: AllValues) : NumberValue => {
    if((isFixedNumber(a) || isRandomNumber(a)) && (isFixedNumber(b) || isRandomNumber(b))) {
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
  [K in keyof ProcessNumber]: ReturnType<ProcessNumber[K]>["symbol"]
}


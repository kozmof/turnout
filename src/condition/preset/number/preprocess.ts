import { isFixedNumber, isRandomNumber, type AllValues, type NumberValue, type StringValue } from "../../value";
import { type ToNumberConversion, type ToStringConversion } from "../convert";

export interface PreprocessNumber {
  pass: ToNumberConversion
  toStr: ToStringConversion
}

export const ppNumber: PreprocessNumber = {
  /**
   * 
   * @param val number
   * @returns number
   */
  pass: (val: AllValues): NumberValue => {
    if (isFixedNumber(val) || isRandomNumber(val)) {
      return val;
    } else {
      throw new Error();
    }
  },
  /**
   * 
   * @param val number
   * @returns string
   */
  toStr: (val: AllValues): StringValue => {
    switch (val.symbol) {
      case "number":
        return {
          symbol: "string",
          value: val.value.toString(),
        };
      case "random-number":
        return {
          symbol: "random-string",
          value: val.value.toString(),
        };
      default:
        throw new Error();
    }
  }
};

export type MetaPreprocessNumber = {
  [K in keyof PreprocessNumber]: ReturnType<PreprocessNumber[K]>["symbol"]
}

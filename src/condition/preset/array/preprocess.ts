import { type NumberValue, type AllValues, type ArrayValue, isFixedArray, isRandomArray } from "../../value";
import { type ToArrayConversion, type ToNumberConversion } from "../convert";

export interface PreprocessArray {
  pass: ToArrayConversion
  length: ToNumberConversion
}

export const ppArray: PreprocessArray = {
  /**
   * 
   * @param val raw value is `array`
   * @returns raw value is `array`
   */
  pass: (val: AllValues): ArrayValue => {
    if(isFixedArray(val) || isRandomArray(val)) {
      return val;
    } else {
      throw new Error();
    }
  },
  /**
   * 
   * @param val raw value is `array`
   * @returns raw value is `number`
   */
  length: (val: AllValues): NumberValue => {
    switch(val.symbol) {
      case "array":
        return {
          symbol: "number",
          value: val.value.length
        };
      case "random-array":
        return {
          symbol: "random-number",
          value: val.value.length
        };
      default:
        throw new Error();
    }
  },
};

export type MetaPreprocessArray = {
  [K in keyof PreprocessArray]: ReturnType<PreprocessArray[K]>["symbol"]
}

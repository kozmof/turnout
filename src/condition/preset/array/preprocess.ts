import { type NumberValue, type AllValues, type ArrayValue, isFixedArray, isRandomArray } from "../../value";
import { type ToArrayConversion, type ToNumberConversion } from "../convert";

export interface PreprocessArray<T extends AllValues> {
  pass: ToArrayConversion<T>
  length: ToNumberConversion<T>
}

export const ppArray: PreprocessArray<AllValues> = {
  /**
   * 
   * @param val raw value must be `array`
   * @returns raw value must be `array`
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
   * @param val raw value must be `array`
   * @returns raw value must be `number`
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
  [K in keyof PreprocessArray<ArrayValue>]: ReturnType<PreprocessArray<ArrayValue>[K]>["symbol"]
}

export type ParamsMetaPreprocessArray = {
  [K in keyof PreprocessArray<ArrayValue>]: [
    Parameters<PreprocessArray<ArrayValue>[K]>[0]["symbol"],
  ]
}

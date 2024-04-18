import type { AllValues, NumberValue } from "../../value";
import { type ToNumberConversion } from "../convert";

export interface PreprocessString {
  toNumber: ToNumberConversion
}

export const ppString: PreprocessString = {
  /**
   * 
   * @param val string
   * @returns number
   */
  toNumber: (val: AllValues): NumberValue => {
    switch (val.symbol) {
      case "string":
        return {
          symbol: "number",
          value: parseInt(val.value),
        };
      case "random-string":
        return {
          symbol: "random-number",
          value: parseInt(val.value),
        };
      default:
        throw new Error();
    }
  }
};

export type MetaPreProcessString = {
  [K in keyof PreprocessString]: ReturnType<PreprocessString[K]>["symbol"]
}

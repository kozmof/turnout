import { type NumberValue, type AllValues } from "../../value";
import { type ToNumberConversion } from "../convert";

export interface PreprocessArray {
  length: ToNumberConversion
}

export const ppArray: PreprocessArray = {
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

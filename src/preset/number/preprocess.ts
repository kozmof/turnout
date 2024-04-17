import type { AllValues, StringValue } from "../../value";
import { type ToStringConversion } from "../convert";

export interface PreprocessNumber {
  toStr: ToStringConversion
}

export const ppNumber: PreprocessNumber = {
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

export type MetaPreProcessNumber = {
  [K in keyof PreprocessNumber]: ReturnType<PreprocessNumber[K]>["symbol"]
}

import type { AllValues, StringValue } from "../../value";
import { type ToStringConversion } from "../convert";

interface PreprocessNumber {
  toString: ToStringConversion
}

export const ppNumber: PreprocessNumber = {
  toString: (val: AllValues): StringValue => {
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

export interface MetaPreProcessNumber {
  toNumber: ReturnType<typeof ppNumber.toString>["symbol"]
}

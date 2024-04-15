import { isRandomValue } from "../../ops";
import type { AllValues, BooleanValue } from "../../value";
import { type ToBooleanProcess } from "../convert";

export interface ProcessGeneric {
  isEqual: ToBooleanProcess
}

export const pGeneric: ProcessGeneric = {
  isEqual: (a: AllValues, b: AllValues): BooleanValue => {
    if (
      ((a.symbol === "string" || a.symbol === "random-string") && (b.symbol === "string" || b.symbol === "random-string")) ||
      ((a.symbol === "number" || a.symbol === "random-number") && (b.symbol === "number" || b.symbol === "random-number")) ||
      ((a.symbol === "boolean" || a.symbol === "random-boolean") && (b.symbol === "boolean" || b.symbol === "random-boolean"))
    ) {
      const isRandom = isRandomValue(a, b);
      return {
        symbol: isRandom ? "random-boolean" : "boolean",
        value: a.value === b.value,
      };
    } else {
      throw new Error();
    }
  },
};

export interface MetaProcessGeneric {
  isEqual: ReturnType<typeof pGeneric.isEqual>["symbol"]
}

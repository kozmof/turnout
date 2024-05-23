import { isRandomValue } from "../../ops";
import type { AllValues, BooleanValue } from "../../value";
import { type ToBooleanProcess } from "../convert";

export interface ProcessGeneric<T extends AllValues, U extends AllValues> {
  isEqual: ToBooleanProcess<T, U>
}

export const pGeneric: ProcessGeneric<AllValues, AllValues> = {
  isEqual: (a: AllValues, b: AllValues): BooleanValue => {
    if (
      ((a.symbol === "string" || a.symbol === "random-string") && (b.symbol === "string" || b.symbol === "random-string")) ||
      ((a.symbol === "number" || a.symbol === "random-number") && (b.symbol === "number" || b.symbol === "random-number")) ||
      ((a.symbol === "boolean" || a.symbol === "random-boolean") && (b.symbol === "boolean" || b.symbol === "random-boolean")) ||
      ((a.symbol === "array" || a.symbol === "random-array") && (b.symbol === "array" || b.symbol === "random-array"))
    ) {
      const isRandom = isRandomValue(a, b);
      return {
        symbol: isRandom ? "random-boolean" : "boolean",
        value: a.value === b.value, // TODO: Array case
      };
    } else {
      throw new Error();
    }
  },
};

export type MetaProcessGeneric = {
  [K in keyof ProcessGeneric<AllValues, AllValues>]: ReturnType<ProcessGeneric<AllValues, AllValues>[K]>["symbol"]
}

export type ParamsMetaProcessGeneric = {
  [K in keyof ProcessGeneric<AllValues, AllValues>]: [
    Parameters<ProcessGeneric<AllValues, AllValues>[K]>[0]["symbol"],
    Parameters<ProcessGeneric<AllValues, AllValues>[K]>[1]["symbol"]
  ]
}

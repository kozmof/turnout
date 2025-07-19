import { isRandomValue } from "../../ops";
import { type AllValue, type BooleanValue } from "../../value";
import { type ToBooleanProcess } from "../convert";
import { isComparable } from "../util/isComparable";

export interface ProcessGeneric<T extends AllValue, U extends AllValue> {
  isEqual: ToBooleanProcess<T, U>
}

export const pGeneric: ProcessGeneric<AllValue, AllValue> = {
  isEqual: (a: AllValue, b: AllValue): BooleanValue => {
    if (isComparable(a, b)) {
      const isRandom = isRandomValue(a, b);
      return {
        symbol: isRandom ? "random-boolean" : "boolean",
        value: a.value === b.value, // TODO: Array case,
        subSymbol: undefined
      };
    } else {
      throw new Error();
    }
  },
};

export type ReturnMetaProcessGeneric = {
  [K in keyof ProcessGeneric<AllValue, AllValue>]: ReturnType<ProcessGeneric<AllValue, AllValue>[K]>["symbol"]
}

export type ParamsMetaProcessGeneric = {
  [K in keyof ProcessGeneric<AllValue, AllValue>]: [
    Parameters<ProcessGeneric<AllValue, AllValue>[K]>[0]["symbol"],
    Parameters<ProcessGeneric<AllValue, AllValue>[K]>[1]["symbol"]
  ]
}

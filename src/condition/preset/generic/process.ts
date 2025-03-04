import { isRandomValue } from "../../ops";
import { isArray, isBoolean, isNumber, isString, type AllValue, type BooleanValue } from "../../value";
import { type ToBooleanProcess } from "../convert";

export interface ProcessGeneric<T extends AllValue, U extends AllValue> {
  isEqual: ToBooleanProcess<T, U>
}

const isSameType = (a: AllValue, b: AllValue) : boolean => {
  return (
    (isString(a) && isString(b)) ||
    (isNumber(a) && isNumber(b)) ||
    (isBoolean(a) && isBoolean(b)) ||
    (isArray(a) && isArray(b))
  )
}

export const pGeneric: ProcessGeneric<AllValue, AllValue> = {
  isEqual: (a: AllValue, b: AllValue): BooleanValue => {
    if (isSameType(a, b)) {
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

export type MetaProcessGeneric = {
  [K in keyof ProcessGeneric<AllValue, AllValue>]: ReturnType<ProcessGeneric<AllValue, AllValue>[K]>["symbol"]
}

export type ParamsMetaProcessGeneric = {
  [K in keyof ProcessGeneric<AllValue, AllValue>]: [
    Parameters<ProcessGeneric<AllValue, AllValue>[K]>[0]["symbol"],
    Parameters<ProcessGeneric<AllValue, AllValue>[K]>[1]["symbol"]
  ]
}

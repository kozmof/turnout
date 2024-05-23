import { isRandomValue } from "../../ops";
import { type AllValues, type BooleanValue, isFixedArray, isRandomArray, ArrayValue, NonArrayValue } from "../../value";
import { type ToBooleanProcess } from "../convert";

export interface ProcessArray<T extends AllValues, U extends AllValues> {
  includes: ToBooleanProcess<T, U>
}

export const pArray: ProcessArray<AllValues, AllValues> = {
  /**
   * 
   * @param a raw value is `array`
   * @param b raw value is `any` but not `array`
   * @returns raw value is `boolean`
   */
  includes: (a: AllValues, b: AllValues) : BooleanValue => {
    if((isFixedArray(a) || isRandomArray(a)) && (!isFixedArray(b) && !isRandomArray(b))) {
      const isRandom = isRandomValue(a, b);
      return {
        symbol: isRandom ? "random-boolean" : "boolean",
        value: a.value.map((val) => val.value).includes(b.value)
      };
    } else {
      throw new Error();
    }
  }
};

export type MetaProcessArray = {
  [K in keyof ProcessArray<ArrayValue, NonArrayValue>]: ReturnType<ProcessArray<ArrayValue, NonArrayValue>[K]>["symbol"]
}

export type ParamsMetaProcessArray = {
  [K in keyof ProcessArray<ArrayValue, NonArrayValue>]: [
    Parameters<ProcessArray<ArrayValue, NonArrayValue>[K]>[0]["symbol"],
    Parameters<ProcessArray<ArrayValue, NonArrayValue>[K]>[1]["symbol"]
  ]
}

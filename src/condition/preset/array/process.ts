import { isRandomValue } from "../../ops";
import { type AllValues, type BooleanValue, isFixedArray, isRandomArray } from "../../value";
import { type ToBooleanProcess } from "../convert";

export interface ProcessArray {
  includes: ToBooleanProcess
}

export const pArray: ProcessArray = {
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
  [K in keyof ProcessArray]: ReturnType<ProcessArray[K]>["symbol"]
}

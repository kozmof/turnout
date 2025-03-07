import { isRandomValue } from "../../ops";
import { type AllValue, type BooleanValue, type ArrayValue, type NonArrayValue, isArray } from "../../value";
import { type ToBooleanProcess } from "../convert";

export interface ProcessArray<T extends AllValue, U extends AllValue> {
  includes: ToBooleanProcess<T, U>
}

export const pArray: ProcessArray<AllValue, AllValue> = {
  /**
   * 
   * @param a raw value must be `array`
   * @param b raw value must be `any` except `array`
   * @returns raw value must be `boolean`
   */
  includes: (a: AllValue, b: AllValue) : BooleanValue => {
    if(isArray(a) && !isArray(b)) {
      const isRandom = isRandomValue(a, b);
      return {
        symbol: isRandom ? "random-boolean" : "boolean",
        value: a.value.map((val) => val.value).includes(b.value),
        subSymbol: undefined
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

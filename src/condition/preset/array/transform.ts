import { type NumberValue, type AllValues, type ArrayValue, isFixedArray, isRandomArray } from "../../value";
import { type ToArrayConversion, type ToNumberConversion } from "../convert";

export interface TransformArray<T extends AllValues> {
  pass: ToArrayConversion<T>
  length: ToNumberConversion<T>
}

export const tArray: TransformArray<AllValues> = {
  /**
   * 
   * @param val raw value must be `array`
   * @returns raw value must be `array`
   */
  pass: (val: AllValues): ArrayValue => {
    if(isFixedArray(val) || isRandomArray(val)) {
      return val;
    } else {
      throw new Error();
    }
  },
  /**
   * 
   * @param val raw value must be `array`
   * @returns raw value must be `number`
   */
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

export type MetaTransformArray = {
  [K in keyof TransformArray<ArrayValue>]: ReturnType<TransformArray<ArrayValue>[K]>["symbol"]
}

export type ParamsMetaTransformArray = {
  [K in keyof TransformArray<ArrayValue>]: [
    Parameters<TransformArray<ArrayValue>[K]>[0]["symbol"],
  ]
}

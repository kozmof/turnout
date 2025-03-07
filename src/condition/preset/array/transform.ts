import { type NumberValue, type AllValue, type ArrayValue, isArray } from "../../value";
import { type ToArrayConversion, type ToNumberConversion } from "../convert";

export interface TransformArray<T extends AllValue> {
  pass: ToArrayConversion<T>
  length: ToNumberConversion<T>
}

export const tArray: TransformArray<AllValue> = {
  /**
   * 
   * @param val raw value must be `array`
   * @returns raw value must be `array`
   */
  pass: (val: AllValue): ArrayValue => {
    if(isArray(val)) {
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
  length: (val: AllValue): NumberValue => {
    switch(val.symbol) {
      case "array":
        return {
          symbol: "number",
          value: val.value.length,
          subSymbol: undefined
        };
      case "random-array":
        return {
          symbol: "random-number",
          value: val.value.length,
          subSymbol: undefined
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

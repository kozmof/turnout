import { isFixedNumber, isRandomNumber, type AllValues, type NumberValue, type StringValue } from "../../value";
import { type ToNumberConversion, type ToStringConversion } from "../convert";

export interface TransformNumber<T extends AllValues> {
  pass: ToNumberConversion<T>
  toStr: ToStringConversion<T>
}

export const tNumber: TransformNumber<AllValues> = {
  /**
   * 
   * @param val raw value must be `number`
   * @returns raw value must be `number`
   */
  pass: (val: AllValues): NumberValue => {
    if (isFixedNumber(val) || isRandomNumber(val)) {
      return val;
    } else {
      throw new Error();
    }
  },
  /**
   * 
   * @param val raw value must be `number`
   * @returns raw value must be `string`
   */
  toStr: (val: AllValues): StringValue => {
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

export type MetaTransformNumber = {
  [K in keyof TransformNumber<NumberValue>]: ReturnType<TransformNumber<NumberValue>[K]>["symbol"]
}

export type ParamsMetaTransformNumber = {
  [K in keyof TransformNumber<NumberValue>]: [
    Parameters<TransformNumber<NumberValue>[K]>[0]["symbol"],
  ]
}

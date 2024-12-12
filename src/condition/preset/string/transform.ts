import { isFixedString, isRandomString, type AllValues, type NumberValue, type StringValue } from "../../value";
import { type ToStringConversion, type ToNumberConversion } from "../convert";

export interface TransformString<T extends AllValues> {
  pass: ToStringConversion<T>
  toNumber: ToNumberConversion<T>
}

export const tString: TransformString<AllValues> = {
  /**
   * 
   * @param val raw value must be `string`
   * @returns raw value must be `string`
   */
  pass: (val: AllValues) : StringValue => {
    if(isFixedString(val) || isRandomString(val)) {
      return val;
    } else {
      throw new Error();
    }
  },
  /**
   * 
   * @param val raw value must be `string`
   * @returns raw value must be `number`
   */
  toNumber: (val: AllValues): NumberValue => {
    switch (val.symbol) {
      case "string":
        return {
          symbol: "number",
          value: parseInt(val.value),
        };
      case "random-string":
        return {
          symbol: "random-number",
          value: parseInt(val.value),
        };
      default:
        throw new Error();
    }
  }
};

export type MetaTransformString = {
  [K in keyof TransformString<StringValue>]: ReturnType<TransformString<StringValue>[K]>["symbol"]
}

export type ParamsMetaTransformString = {
  [K in keyof TransformString<StringValue>]: [
    Parameters<TransformString<StringValue>[K]>[0]["symbol"],
  ]
}

import { isFixedString, isRandomString, type AllValues, type NumberValue, type StringValue } from "../../value";
import { type ToStringConversion, type ToNumberConversion } from "../convert";

export interface PreprocessString<T extends AllValues> {
  pass: ToStringConversion<T>
  toNumber: ToNumberConversion<T>
}

export const ppString: PreprocessString<AllValues> = {
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

export type MetaPreprocessString = {
  [K in keyof PreprocessString<StringValue>]: ReturnType<PreprocessString<StringValue>[K]>["symbol"]
}

export type ParamsMetaPreprocessString = {
  [K in keyof PreprocessString<StringValue>]: [
    Parameters<PreprocessString<StringValue>[K]>[0]["symbol"],
  ]
}

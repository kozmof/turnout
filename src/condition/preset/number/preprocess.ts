import { isFixedNumber, isRandomNumber, type AllValues, type NumberValue, type StringValue } from "../../value";
import { type ToNumberConversion, type ToStringConversion } from "../convert";

export interface PreprocessNumber<T extends AllValues> {
  pass: ToNumberConversion<T>
  toStr: ToStringConversion<T>
}

export const ppNumber: PreprocessNumber<AllValues> = {
  /**
   * 
   * @param val raw value is `number`
   * @returns raw value is `number`
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
   * @param val raw value is `number`
   * @returns raw value is `string`
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

export type MetaPreprocessNumber = {
  [K in keyof PreprocessNumber<NumberValue>]: ReturnType<PreprocessNumber<NumberValue>[K]>["symbol"]
}

export type ParamsMetaPreprocessNumber = {
  [K in keyof PreprocessNumber<NumberValue>]: [
    Parameters<PreprocessNumber<NumberValue>[K]>[0]["symbol"],
  ]
}

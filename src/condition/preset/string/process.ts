import { isRandomValue } from "../../ops";
import { type AllValue, type StringValue, isFixedString, isRandomString } from "../../value";
import { type ToStringProcess } from "../convert";

export interface ProcessString<T extends AllValue, U extends AllValue> {
  concat: ToStringProcess<T, U>
}

export const pString: ProcessString<AllValue, AllValue> = {
  /**
   * 
   * @param a raw value must be string
   * @param b raw value must be string
   * @returns raw value must be string
   */
  concat: (a: AllValue, b: AllValue): StringValue => {
    if ((isFixedString(a) || isRandomString(a)) && (isFixedString(b) || isRandomString(b))) {
      const isRandom = isRandomValue(a, b);
      return {
        symbol: isRandom ? "random-string" : "string",
        value: a.value + b.value
      };
    } else {
      throw new Error();
    }
  }
};

export type MetaProcessString = {
  [K in keyof ProcessString<StringValue, StringValue>]: ReturnType<ProcessString<StringValue, StringValue>[K]>["symbol"]
}

export type ParamsMetaProcessString = {
  [K in keyof ProcessString<StringValue, StringValue>]: [
    Parameters<ProcessString<StringValue, StringValue>[K]>[0]["symbol"],
    Parameters<ProcessString<StringValue, StringValue>[K]>[1]["symbol"]
  ]
}

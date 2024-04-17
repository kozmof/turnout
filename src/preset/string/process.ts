import { isRandomValue } from "../../ops";
import { type AllValues, type StringValue, isFixedString, isRandomString } from "../../value";
import { type ToStringProcess } from "../convert";

export interface ProcessString {
  concat: ToStringProcess
}

export const pString: ProcessString = {
  concat: (a: AllValues, b: AllValues) : StringValue => {
    if((isFixedString(a) || isRandomString(a)) && (isFixedString(b) || isRandomString(b))) {
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
  [K in keyof ProcessString]: ReturnType<ProcessString[K]>["symbol"]
}

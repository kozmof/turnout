import { isArray, isBoolean, isNumber, isString, type AllValue } from "../../value";

export const isComparable = (a: AllValue, b: AllValue): boolean => {
  return (
    (isString(a) && isString(b)) ||
    (isNumber(a) && isNumber(b)) ||
    (isBoolean(a) && isBoolean(b)) ||
    (isArray(a) && isArray(b))
  )
};

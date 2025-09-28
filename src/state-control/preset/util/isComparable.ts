import { isArray, isBoolean, isNumber, isString, type AnyValue } from '../../value';

export const isComparable = (a: AnyValue, b: AnyValue): boolean => {
  return (
    (isString(a) && isString(b)) ||
    (isNumber(a) && isNumber(b)) ||
    (isBoolean(a) && isBoolean(b)) ||
    (isArray(a) && isArray(b))
  );
};

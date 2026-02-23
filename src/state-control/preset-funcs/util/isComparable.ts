import { isArray, isBoolean, isNull, isNumber, isString, type AnyValue } from '../../value';

export const isComparable = (a: AnyValue, b: AnyValue): boolean => {
  return (
    (isString(a) && isString(b)) ||
    (isNumber(a) && isNumber(b)) ||
    (isBoolean(a) && isBoolean(b)) ||
    (isNull(a) && isNull(b)) ||
    (isArray(a) && isArray(b))
  );
};

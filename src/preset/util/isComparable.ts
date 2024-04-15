import { type AllValues, type DeterministicSymbol, type NonDeterministicSymbol } from "../../value";

const isString = (tag: DeterministicSymbol | NonDeterministicSymbol) : boolean => {
  const tags: Array<DeterministicSymbol | NonDeterministicSymbol> = ["string", "random-string"];
  return tags.includes(tag);
};

const isNumber = (tag: DeterministicSymbol | NonDeterministicSymbol) : boolean => {
  const tags: Array<DeterministicSymbol | NonDeterministicSymbol> = ["number", "random-number"];
  return tags.includes(tag);
};

const isBoolean = (tag: DeterministicSymbol | NonDeterministicSymbol) : boolean => {
  const tags: Array<DeterministicSymbol | NonDeterministicSymbol> = ["boolean", "random-boolean"];
  return tags.includes(tag);
};

export const isComparable = (a: AllValues, b: AllValues): boolean => {
  if (isString(a.symbol) && isString(b.symbol)) {
    return true;
  } else if (isNumber(a.symbol) && isNumber(b.symbol)) {
    return true;
  } else if (isBoolean(a.symbol) && isBoolean(b.symbol)) {
    return true;
  } else {
    return false;
  }
};

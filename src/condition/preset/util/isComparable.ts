import { type AllValue, type DeterministicSymbol, type NonDeterministicSymbol } from "../../value";

const isString = (symbol: DeterministicSymbol | NonDeterministicSymbol) : boolean => {
  const symbols: Array<DeterministicSymbol | NonDeterministicSymbol> = ["string", "random-string"];
  return symbols.includes(symbol);
};

const isNumber = (symbol: DeterministicSymbol | NonDeterministicSymbol) : boolean => {
  const symbols: Array<DeterministicSymbol | NonDeterministicSymbol> = ["number", "random-number"];
  return symbols.includes(symbol);
};

const isBoolean = (symbol: DeterministicSymbol | NonDeterministicSymbol) : boolean => {
  const symbols: Array<DeterministicSymbol | NonDeterministicSymbol> = ["boolean", "random-boolean"];
  return symbols.includes(symbol);
};

const isArray = (symbol: DeterministicSymbol | NonDeterministicSymbol) : boolean => {
  const symbols: Array<DeterministicSymbol | NonDeterministicSymbol> = ["array", "random-array"];
  return symbols.includes(symbol);
};

export const isComparable = (a: AllValue, b: AllValue): boolean => {
  if (isString(a.symbol) && isString(b.symbol)) {
    return true;
  } else if (isNumber(a.symbol) && isNumber(b.symbol)) {
    return true;
  } else if (isBoolean(a.symbol) && isBoolean(b.symbol)) {
    return true;
  } else if (isArray(a.symbol) && isArray(b.symbol)) {
    return true;
  } else {
    return false;
  }
};

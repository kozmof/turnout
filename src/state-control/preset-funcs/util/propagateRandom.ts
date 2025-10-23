import {
  type DeterministicSymbol,
  type AnyValue,
  type NonDeterministicSymbol,
  nonDeterministicSymbols,
} from '../../value';

function isRandomValue(a: AnyValue, b: AnyValue | null): boolean {
  const symbols: (NonDeterministicSymbol | DeterministicSymbol)[] =
    nonDeterministicSymbols;
  if (b !== null) {
    return symbols.includes(a.symbol) || symbols.includes(b.symbol);
  } else {
    return symbols.includes(a.symbol);
  }
}
export const propageteRandom = <T extends DeterministicSymbol>(
  symbol: T,
  a: AnyValue,
  b: AnyValue | null
): T | `random-${T}` => {
  const isRandom = isRandomValue(a, b);
  if (isRandom) {
    return `random-${symbol}`;
  } else {
    return symbol;
  }
};

import { isRandomValue } from '../../ops';
import { type DeterministicSymbol, type AnyValue } from '../../value';

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

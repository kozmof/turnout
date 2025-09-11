type Combinations<T> = T extends object
  ? {
      [K in keyof T]: T[K] extends readonly (infer V)[] ? V : never;
    }
  : never;

const isCompleted = <T>(
  current: Partial<Record<keyof T, unknown>>,
  keys: (keyof T)[],
  index: number
): current is Combinations<T> => {
  return index === keys.length;
};

export function generateCombinations<
  T extends Record<string, readonly unknown[]>,
>(input: T): Combinations<T>[] {
  const keys = Object.keys(input) as (keyof T)[];

  const result: Combinations<T>[] = [];

  function gen(
    index: number,
    current: Partial<Record<keyof T, unknown>>
  ): void {
    if (isCompleted(current, keys, index)) {
      result.push(current);
      return;
    }

    const key = keys[index];
    const options = input[key];

    for (const option of options) {
      gen(index + 1, { ...current, [key]: option });
    }
  }

  gen(0, {});
  return result;
}

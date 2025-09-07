type Combinations<T> = T extends object
  ? {
      [K in keyof T]: T[K] extends readonly (infer V)[] ? V : never;
    }
  : never;

export function generateCombinations<
  T extends Record<string, readonly unknown[]>,
>(input: T): Combinations<T>[] {
  const keys = Object.keys(input) as (keyof T)[];

  const result: Combinations<T>[] = [];

  function gen(
    index: number,
    current: Partial<Record<keyof T, unknown>>
  ): void {
    if (index === keys.length) {
      result.push(current as Combinations<T>);
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

// https://typescript-jp.gitbook.io/deep-dive/type-system/literal-types

/** Utility function to create a K:V from a list of strings */
export default function strEnum<T extends string>(o: T[]): { [K in T]: K } {
  return o.reduce<{ [K in T]: K }>(
    (res, key) => {
      res[key] = key;
      return res;
    },
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    Object.create(null)
  );
}

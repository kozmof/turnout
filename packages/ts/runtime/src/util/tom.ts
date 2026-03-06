// TOM: Typed Object Method

type Entries<T> = { [K in keyof T]: [K, T[K]] }[keyof T][];

export const TOM = {
  keys: <T extends object>(obj: T): (keyof T)[] => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return Object.keys(obj) as (keyof T)[];
  },
  entries: <T extends Record<string, unknown>>(obj: T): Entries<T> => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return Object.entries(obj) as Entries<T>;
  }
};

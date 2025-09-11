// TOM: Typed Object Method

type Entries<T> = { [K in keyof T]: [K, T[K]] }[keyof T][];

export const TOM = {
  // Japanese ref: https://zenn.dev/ossamoon/articles/694a601ee62526
  keys: <T extends Record<string, unknown>>(obj: T): (keyof T)[] => {
    return Object.keys(obj);
  },
  entries: <T extends Record<string, unknown>>(obj: T): Entries<T> => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return Object.entries(obj) as Entries<T>;
  }
};

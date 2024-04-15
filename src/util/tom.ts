// TOM: Typed Object Method


export const TOM = {
  // Japanese ref: https://zenn.dev/ossamoon/articles/694a601ee62526
  keys: <T extends Record<string, unknown>>(obj: T): Array<keyof T> => {
    return Object.keys(obj);
  }
};

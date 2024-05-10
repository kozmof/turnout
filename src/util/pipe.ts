import type { AllValues } from "../condition/value";

/**
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/reduce#function_sequential_piping
 * @param functions 
 * @returns 
 */
export const pipe = <T extends AllValues>
  (...functions: Array<(val: T) => T>) =>
    (initialValue: T) =>
      functions.reduce((acc, fn) => fn(acc), initialValue);

import type { AnyValue } from '../state-control/value';

/**
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/reduce#function_sequential_piping
 * @param functions 
 * @returns 
 */
export const pipe = <T extends AnyValue>
  (...functions: ((val: T) => T)[]) =>
    (initialValue: T) =>
      functions.reduce((acc, fn) => fn(acc), initialValue);

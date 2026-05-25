export type Brand<K, T> = K & { __brand: T }

/**
 * Exhaustiveness helper. Call in the `default` branch of a switch over a
 * discriminated union to get a compile-time error if a case is missing.
 *
 * @example
 * switch (value.symbol) {
 *   case 'number': ...
 *   case 'string': ...
 *   default: assertNever(value);
 * }
 */
export function assertNever(x: never, msg?: string): never {
  throw new Error(msg ?? `Unhandled discriminant: ${JSON.stringify(x)}`);
}
/**
 * Drops the keys whose value is `undefined`.
 *
 * `exactOptionalPropertyTypes` is on, so `{ signal: undefined }` does not
 * satisfy `{ signal?: AbortSignal }` — an optional property may be absent or
 * hold a value, never hold `undefined`. Building options from a partial
 * therefore cannot be a plain object literal, and the shape that grew instead
 * was a conditional spread per key:
 *
 * ```ts
 * ...(options.signal === undefined ? {} : { signal: options.signal }),
 * ```
 *
 * Eleven of those across `scene-safe.ts` and `route-safe.ts`, each naming its
 * key three times, and a transposed name in one of them type-checks: the key
 * is still spelled consistently *within* the spread. This says it once.
 */
export type Defined<T> = { [K in keyof T]-?: Exclude<T[K], undefined> };

export function defined<T extends object>(source: T): Partial<Defined<T>> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<Defined<T>>;
}

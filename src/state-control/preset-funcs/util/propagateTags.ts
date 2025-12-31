import {
  type AnyValue,
  type TagSymbol,
} from '../../value';

/**
 * Propagates tags using set union semantics.
 *
 * Combines computational tags from multiple values into a single tag set.
 * This function is used by all operations (binary functions and transforms) to
 * track how tags flow through computations.
 *
 * ## Tag Semantics
 *
 * Effects represent "taints" or "computational origins" rather than event counts.
 * When combining tags, duplicates are removed using set union semantics.
 *
 * ### Examples
 *
 * ```typescript
 * // Combining tags: ['random'] + ['random'] = ['random']
 * const a = { symbol: 'number', value: 5, tags: ['random'] };
 * const b = { symbol: 'number', value: 3, tags: ['random'] };
 * propagateTags(a, b); // => ['random']
 *
 * // Multiple distinct tags are preserved
 * const c = { symbol: 'number', value: 10, tags: ['random', 'cached'] };
 * const d = { symbol: 'number', value: 2, tags: ['network'] };
 * propagateTags(c, d); // => ['random', 'cached', 'network']
 *
 * // Transform with single input (b = null)
 * propagateTags(a, null); // => ['random']
 * ```
 *
 * ### Design Rationale
 *
 * **Why deduplication?**
 * If a value is derived from random inputs, it's random regardless of how many
 * random sources contributed. Effects track "contamination" not "event counts".
 *
 * **Need to track multiple instances?**
 * Use distinct tag symbols for each instance:
 * - Instead of: `['random', 'random']` (deduplicates to `['random']`)
 * - Use: `['random-1', 'random-2']` (preserves both)
 *
 * ### Common Tag Types
 *
 * - `'random'`: Value depends on random number generation
 * - `'network'`: Value depends on network I/O
 * - `'cached'`: Value retrieved from cache
 * - `'io'`: Value depends on file/disk I/O
 * - `'deprecated'`: Value uses deprecated APIs
 * - Custom: Any user-defined string
 *
 * @param a - First value (required)
 * @param b - Second value (optional, null for unary operations like transforms)
 * @returns Readonly array of unique tag symbols (set union of a.tags and b.tags)
 */
export const propagateTags = (
  a: AnyValue,
  b: AnyValue | null
): readonly TagSymbol[] => {
  const tagsSet = new Set<TagSymbol>();

  // Collect tags from a
  a.tags.forEach((tag: TagSymbol) => tagsSet.add(tag));

  // Collect tags from b if it exists
  if (b !== null) {
    b.tags.forEach((tag: TagSymbol) => tagsSet.add(tag));
  }

  // Return unique tags as readonly array
  return Array.from(tagsSet) as readonly TagSymbol[];
};

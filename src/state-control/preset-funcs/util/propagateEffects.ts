import {
  type AnyValue,
  type EffectSymbol,
} from '../../value';

/**
 * Propagates effects using set union semantics.
 *
 * Combines computational effects from multiple values into a single effect set.
 * This function is used by all operations (binary functions and transforms) to
 * track how effects flow through computations.
 *
 * ## Effect Semantics
 *
 * Effects represent "taints" or "computational origins" rather than event counts.
 * When combining effects, duplicates are removed using set union semantics.
 *
 * ### Examples
 *
 * ```typescript
 * // Combining effects: ['random'] + ['random'] = ['random']
 * const a = { symbol: 'number', value: 5, effects: ['random'] };
 * const b = { symbol: 'number', value: 3, effects: ['random'] };
 * propagateEffects(a, b); // => ['random']
 *
 * // Multiple distinct effects are preserved
 * const c = { symbol: 'number', value: 10, effects: ['random', 'cached'] };
 * const d = { symbol: 'number', value: 2, effects: ['network'] };
 * propagateEffects(c, d); // => ['random', 'cached', 'network']
 *
 * // Transform with single input (b = null)
 * propagateEffects(a, null); // => ['random']
 * ```
 *
 * ### Design Rationale
 *
 * **Why deduplication?**
 * If a value is derived from random inputs, it's random regardless of how many
 * random sources contributed. Effects track "contamination" not "event counts".
 *
 * **Need to track multiple instances?**
 * Use distinct effect symbols for each instance:
 * - Instead of: `['random', 'random']` (deduplicates to `['random']`)
 * - Use: `['random-1', 'random-2']` (preserves both)
 *
 * ### Common Effect Types
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
 * @returns Readonly array of unique effect symbols (set union of a.effects and b.effects)
 */
export const propagateEffects = (
  a: AnyValue,
  b: AnyValue | null
): readonly EffectSymbol[] => {
  const effectsSet = new Set<EffectSymbol>();

  // Collect effects from a
  a.effects.forEach((effect: EffectSymbol) => effectsSet.add(effect));

  // Collect effects from b if it exists
  if (b !== null) {
    b.effects.forEach((effect: EffectSymbol) => effectsSet.add(effect));
  }

  // Return unique effects as readonly array
  return Array.from(effectsSet) as readonly EffectSymbol[];
};

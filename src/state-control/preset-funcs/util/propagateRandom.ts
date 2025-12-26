import {
  type AnyValue,
  type EffectSymbol,
} from '../../value';

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

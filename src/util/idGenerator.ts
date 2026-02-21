import type {
  ValueId,
  FuncId,
  CombineDefineId,
  PipeDefineId,
  CondDefineId,
  InterfaceArgId,
} from '../compute-graph/types';
import {
  createValueId,
  createFuncId,
  createCombineDefineId,
  createPipeDefineId,
  createCondDefineId,
  createInterfaceArgId,
} from '../compute-graph/idValidation';

/**
 * ID generation strategy using random hex strings with type prefixes.
 *
 * Format: {prefix}_{randomHex}
 * Examples: v_a3f2d8e1cc9b3f12, f_7b8c9a2e45d10f8a, pd_4f3a1b2c87e6d091
 *
 * This approach:
 * - Uses crypto.getRandomValues for 64 bits of cryptographic randomness
 * - Maintains readability with type prefixes (v/f/pd/td/cd/ia)
 * - Uses 16 hex chars (8 bytes) to minimize collision risk at scale
 * - Avoids encoding semantic information in ID strings
 */

type IdPrefix = 'v' | 'f' | 'pd' | 'td' | 'cd' | 'ia';

/**
 * Generates a random 16-character hex string using crypto.getRandomValues.
 * Provides 64 bits of cryptographic randomness, greatly reducing collision risk.
 */
function generateRandomHex(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export const IdGenerator = {
  /**
   * Generates an ID with type prefix for debugging.
   * Uses 16 random hex chars (64-bit crypto randomness).
   */
  generate(prefix: IdPrefix): string {
    const randomHex = generateRandomHex();
    return `${prefix}_${randomHex}`;
  },

  generateValueId(): ValueId {
    return createValueId(IdGenerator.generate('v'));
  },

  generateFuncId(): FuncId {
    return createFuncId(IdGenerator.generate('f'));
  },

  generateCombineDefineId(): CombineDefineId {
    return createCombineDefineId(IdGenerator.generate('pd'));
  },

  generatePipeDefineId(): PipeDefineId {
    return createPipeDefineId(IdGenerator.generate('td'));
  },

  generateCondDefineId(): CondDefineId {
    return createCondDefineId(IdGenerator.generate('cd'));
  },

  generateInterfaceArgId(): InterfaceArgId {
    return createInterfaceArgId(IdGenerator.generate('ia'));
  },
} as const;

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
 * Examples: v_a3f2d8e1, f_7b8c9a2e, pd_4f3a1b2c
 *
 * This approach:
 * - Uses Math.random() for simple random IDs
 * - Maintains readability with type prefixes (v/f/pd/td/cd/ia)
 * - Uses 8 hex chars for debugging while keeping IDs short
 * - Avoids encoding semantic information in ID strings
 */

type IdPrefix = 'v' | 'f' | 'pd' | 'td' | 'cd' | 'ia';

/**
 * Generates a random 8-character hex string.
 */
function generateRandomHex(): string {
  // Generate two random 32-bit integers and combine them
  const part1 = Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  return part1;
}

export const IdGenerator = {
  /**
   * Generates a short hash ID with type prefix for debugging.
   * Uses 8 random hex chars for readability.
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

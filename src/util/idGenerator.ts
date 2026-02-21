import type {
  ValueId,
  FuncId,
  CombineDefineId,
  PipeDefineId,
  CondDefineId,
  InterfaceArgId,
} from '../compute-graph/types';

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

// Import branded type creators from context
// These will be imported dynamically to avoid circular dependencies
let createValueId: (id: string) => ValueId;
let createFuncId: (id: string) => FuncId;
let createCombineDefineId: (id: string) => CombineDefineId;
let createPipeDefineId: (id: string) => PipeDefineId;
let createCondDefineId: (id: string) => CondDefineId;
let createInterfaceArgId: (id: string) => InterfaceArgId;

/**
 * Initialize the ID generator with branded type creators.
 * This must be called before using the generator to avoid circular dependencies.
 */
export function initializeIdGenerator(creators: {
  createValueId: (id: string) => ValueId;
  createFuncId: (id: string) => FuncId;
  createCombineDefineId: (id: string) => CombineDefineId;
  createPipeDefineId: (id: string) => PipeDefineId;
  createCondDefineId: (id: string) => CondDefineId;
  createInterfaceArgId: (id: string) => InterfaceArgId;
}): void {
  createValueId = creators.createValueId;
  createFuncId = creators.createFuncId;
  createCombineDefineId = creators.createCombineDefineId;
  createPipeDefineId = creators.createPipeDefineId;
  createCondDefineId = creators.createCondDefineId;
  createInterfaceArgId = creators.createInterfaceArgId;
}

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
    if (!createValueId) {
      throw new Error('IdGenerator not initialized. Call initializeIdGenerator() first.');
    }
    return createValueId(IdGenerator.generate('v'));
  },

  generateFuncId(): FuncId {
    if (!createFuncId) {
      throw new Error('IdGenerator not initialized. Call initializeIdGenerator() first.');
    }
    return createFuncId(IdGenerator.generate('f'));
  },

  generateCombineDefineId(): CombineDefineId {
    if (!createCombineDefineId) {
      throw new Error('IdGenerator not initialized. Call initializeIdGenerator() first.');
    }
    return createCombineDefineId(IdGenerator.generate('pd'));
  },

  generatePipeDefineId(): PipeDefineId {
    if (!createPipeDefineId) {
      throw new Error('IdGenerator not initialized. Call initializeIdGenerator() first.');
    }
    return createPipeDefineId(IdGenerator.generate('td'));
  },

  generateCondDefineId(): CondDefineId {
    if (!createCondDefineId) {
      throw new Error('IdGenerator not initialized. Call initializeIdGenerator() first.');
    }
    return createCondDefineId(IdGenerator.generate('cd'));
  },

  generateInterfaceArgId(): InterfaceArgId {
    if (!createInterfaceArgId) {
      throw new Error('IdGenerator not initialized. Call initializeIdGenerator() first.');
    }
    return createInterfaceArgId(IdGenerator.generate('ia'));
  },
} as const;

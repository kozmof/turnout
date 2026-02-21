import type {
  ValueId,
  FuncId,
  CombineDefineId,
  PipeDefineId,
  CondDefineId,
  InterfaceArgId,
  FuncTable,
  CombineFuncDefTable,
  PipeFuncDefTable,
  CondFuncDefTable,
  ValueTable,
} from './types';
import type { NodeId } from './runtime/tree-types';

/**
 * Centralized ID validation module.
 *
 * This module provides two categories of functions:
 *
 * 1. **Branded ID Creators** - Cast strings to branded types
 *    - Naming: `create{Type}Id(id: string): {Type}Id`
 *    - Purpose: Entry point for creating branded IDs
 *    - Example: `createValueId('v1')` returns a branded ValueId
 *
 * 2. **Table-Based Guards** - Check if ID exists in execution context
 *    - Naming: `is{Type}Id(id, table): id is {Type}Id`
 *    - Purpose: Runtime validation that ID exists in context
 *    - Example: `isFuncId(id, funcTable)` checks if ID exists in the function table
 *
 * ## ID Structure
 *
 * IDs are arbitrary non-empty strings. No structural validation is performed.
 * Prefixes (v_, f_, pd_, td_, cd_, ia_) are for debugging/readability only, not enforced.
 */

// ============================================================================
// BRANDED ID CREATORS
// ============================================================================

/**
 * Creates a branded ValueId from a string.
 *
 * @param id - The ID string to brand
 * @returns A branded ValueId
 *
 * @example
 * const valueId = createValueId('v1');
 */
export function createValueId(id: string): ValueId {
  if (id === '') throw new Error('ValueId cannot be empty');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return id as ValueId;
}

/**
 * Creates a branded FuncId from a string.
 *
 * @param id - The ID string to brand
 * @returns A branded FuncId
 *
 * @example
 * const funcId = createFuncId('f1');
 */
export function createFuncId(id: string): FuncId {
  if (id === '') throw new Error('FuncId cannot be empty');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return id as FuncId;
}

/**
 * Creates a branded CombineDefineId from a string.
 *
 * @param id - The ID string to brand
 * @returns A branded CombineDefineId
 *
 * @example
 * const defId = createCombineDefineId('pd_a3f2d8e1');
 */
export function createCombineDefineId(id: string): CombineDefineId {
  if (id === '') throw new Error('CombineDefineId cannot be empty');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return id as CombineDefineId;
}

/**
 * Creates a branded PipeDefineId from a string.
 *
 * @param id - The ID string to brand
 * @returns A branded PipeDefineId
 *
 * @example
 * const defId = createPipeDefineId('td_a3f2d8e1');
 */
export function createPipeDefineId(id: string): PipeDefineId {
  if (id === '') throw new Error('PipeDefineId cannot be empty');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return id as PipeDefineId;
}

/**
 * Creates a branded CondDefineId from a string.
 *
 * @param id - The ID string to brand
 * @returns A branded CondDefineId
 *
 * @example
 * const defId = createCondDefineId('cd_a3f2d8e1');
 */
export function createCondDefineId(id: string): CondDefineId {
  if (id === '') throw new Error('CondDefineId cannot be empty');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return id as CondDefineId;
}

/**
 * Creates a branded InterfaceArgId from a string.
 *
 * @param id - The ID string to brand
 * @returns A branded InterfaceArgId
 *
 * @example
 * const argId = createInterfaceArgId('ia1');
 */
export function createInterfaceArgId(id: string): InterfaceArgId {
  if (id === '') throw new Error('InterfaceArgId cannot be empty');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return id as InterfaceArgId;
}

// ============================================================================
// TABLE-BASED GUARDS
// ============================================================================

/**
 * Type guard to check if an ID exists as a FuncId in the FuncTable.
 * @param id - The ID to check
 * @param funcTable - The function table to check against
 * @returns True if the ID exists in the table
 */
export function isFuncId(
  id: NodeId,
  funcTable: FuncTable
): id is FuncId {
  return id in funcTable;
}

/**
 * Type guard to check if an ID exists as a ValueId in the ValueTable.
 * @param id - The ID to check
 * @param valueTable - The value table to check against
 * @returns True if the ID exists in the table
 */
export function isValueId(
  id: NodeId,
  valueTable: ValueTable
): id is ValueId {
  return id in valueTable;
}

/**
 * Type guard to check if an ID exists as a CombineDefineId in the CombineFuncDefTable.
 * @param id - The ID to check
 * @param combineFuncDefTable - The combine function definition table to check against
 * @returns True if the ID exists in the table
 */
export function isCombineDefineId(
  id: string,
  combineFuncDefTable: CombineFuncDefTable
): id is CombineDefineId {
  return id in combineFuncDefTable;
}

/**
 * Type guard to check if an ID exists as a PipeDefineId in the PipeFuncDefTable.
 * @param id - The ID to check
 * @param pipeFuncDefTable - The pipe function definition table to check against
 * @returns True if the ID exists in the table
 */
export function isPipeDefineId(
  id: string,
  pipeFuncDefTable: PipeFuncDefTable
): id is PipeDefineId {
  return id in pipeFuncDefTable;
}

/**
 * Type guard to check if an ID exists as a CondDefineId in the CondFuncDefTable.
 * @param id - The ID to check
 * @param condFuncDefTable - The conditional function definition table to check against
 * @returns True if the ID exists in the table
 */
export function isCondDefineId(
  id: string,
  condFuncDefTable: CondFuncDefTable
): id is CondDefineId {
  return id in condFuncDefTable;
}

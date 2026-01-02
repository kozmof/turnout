import type {
  ValueId,
  FuncId,
  PlugDefineId,
  TapDefineId,
  CondDefineId,
  InterfaceArgId,
} from './types';

/**
 * Centralized ID validation module.
 *
 * This module provides three categories of functions:
 *
 * 1. **Structural Validators** - Check ID format/structure without table lookups
 *    - Naming: `isValid{Type}Structure(id: string): boolean`
 *    - Purpose: Validate ID format before creation or use
 *
 * 2. **Branded ID Creators** - Validate then cast to branded types
 *    - Naming: `create{Type}Id(id: string): {Type}Id`
 *    - Purpose: Safe entry point for creating branded IDs
 *
 * 3. **Table-Based Guards** - Check if ID exists in execution context
 *    - Located in: `./typeGuards.ts` (separate file)
 *    - Naming: `is{Type}Id(id, table): id is {Type}Id`
 *    - Purpose: Runtime validation that ID exists in context
 *
 * ## Design Rationale
 *
 * Separating structural validation from table-based validation serves two purposes:
 * - **Build-time**: Validate ID format when creating/generating IDs
 * - **Runtime**: Validate ID existence when executing
 *
 * This separation eliminates duplication while keeping concerns separate.
 *
 * ## ID Structure
 *
 * All IDs use the same validation: non-empty strings.
 * Prefixes (v_, f_, pd_, td_, cd_, ia_) are for debugging/readability only, not validation.
 */

// ============================================================================
// STRUCTURAL VALIDATORS
// ============================================================================

/**
 * Validates ValueId structure: non-empty string.
 *
 * @param id - The ID to validate
 * @returns True if the ID is a valid ValueId structure
 *
 * @example
 * isValidValueId('v1')           // true
 * isValidValueId('v_a3f2d8e1')   // true
 * isValidValueId('')             // false
 */
export function isValidValueId(id: string): boolean {
  return typeof id === 'string' && id.length > 0;
}

/**
 * Validates FuncId structure: non-empty string.
 *
 * @param id - The ID to validate
 * @returns True if the ID is a valid FuncId structure
 *
 * @example
 * isValidFuncId('f1')            // true
 * isValidFuncId('f_7b8c9a2e')    // true
 * isValidFuncId('')              // false
 */
export function isValidFuncId(id: string): boolean {
  return typeof id === 'string' && id.length > 0;
}

/**
 * Validates PlugDefineId structure: non-empty string.
 *
 * @param id - The ID to validate
 * @returns True if the ID is a valid PlugDefineId structure
 *
 * @example
 * isValidPlugDefineId('pd_a3f2d8e1')    // true
 * isValidPlugDefineId('myPlugDef')      // true
 * isValidPlugDefineId('')               // false
 */
export function isValidPlugDefineId(id: string): boolean {
  return typeof id === 'string' && id.length > 0;
}

/**
 * Validates TapDefineId structure: non-empty string.
 *
 * @param id - The ID to validate
 * @returns True if the ID is a valid TapDefineId structure
 *
 * @example
 * isValidTapDefineId('td_a3f2d8e1')     // true
 * isValidTapDefineId('myTapDef')        // true
 * isValidTapDefineId('')                // false
 */
export function isValidTapDefineId(id: string): boolean {
  return typeof id === 'string' && id.length > 0;
}

/**
 * Validates CondDefineId structure: non-empty string.
 *
 * @param id - The ID to validate
 * @returns True if the ID is a valid CondDefineId structure
 *
 * @example
 * isValidCondDefineId('cd_a3f2d8e1')    // true
 * isValidCondDefineId('myCondDef')      // true
 * isValidCondDefineId('')               // false
 */
export function isValidCondDefineId(id: string): boolean {
  return typeof id === 'string' && id.length > 0;
}

/**
 * Validates InterfaceArgId structure: non-empty string.
 *
 * @param id - The ID to validate
 * @returns True if the ID is a valid InterfaceArgId structure
 *
 * @example
 * isValidInterfaceArgId('ia1')          // true
 * isValidInterfaceArgId('ia_a3f2d8e1')  // true
 * isValidInterfaceArgId('')             // false
 */
export function isValidInterfaceArgId(id: string): boolean {
  return typeof id === 'string' && id.length > 0;
}

/**
 * Validates StepDefId structure: non-empty string.
 *
 * Used for validating step definitions which can be either PlugDefineId or TapDefineId.
 *
 * @param id - The ID to validate
 * @returns True if the ID is a valid StepDefId structure
 *
 * @example
 * isValidStepDefId('pd_a3f2d8e1')       // true
 * isValidStepDefId('td_a3f2d8e1')       // true
 * isValidStepDefId('myDef')             // true
 * isValidStepDefId('')                  // false
 */
export function isValidStepDefId(id: string): boolean {
  return typeof id === 'string' && id.length > 0;
}

// ============================================================================
// BRANDED ID CREATORS
// ============================================================================

/**
 * Creates a branded ValueId after validating structure.
 *
 * @param id - The ID string to validate and brand
 * @returns A branded ValueId
 * @throws Error if the ID structure is invalid
 *
 * @example
 * const valueId = createValueId('v1');  // Returns ValueId
 * createValueId('');                     // Throws Error
 */
export function createValueId(id: string): ValueId {
  if (!isValidValueId(id)) {
    throw new Error(`Invalid ValueId: ${id}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return id as ValueId;
}

/**
 * Creates a branded FuncId after validating structure.
 *
 * @param id - The ID string to validate and brand
 * @returns A branded FuncId
 * @throws Error if the ID structure is invalid
 *
 * @example
 * const funcId = createFuncId('f1');  // Returns FuncId
 * createFuncId('');                   // Throws Error
 */
export function createFuncId(id: string): FuncId {
  if (!isValidFuncId(id)) {
    throw new Error(`Invalid FuncId: ${id}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return id as FuncId;
}

/**
 * Creates a branded PlugDefineId after validating structure.
 *
 * @param id - The ID string to validate and brand
 * @returns A branded PlugDefineId
 * @throws Error if the ID structure is invalid
 *
 * @example
 * const defId = createPlugDefineId('pd_a3f2d8e1');  // Returns PlugDefineId
 * createPlugDefineId('');                           // Throws Error
 */
export function createPlugDefineId(id: string): PlugDefineId {
  if (!isValidPlugDefineId(id)) {
    throw new Error(`Invalid PlugDefineId: ${id}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return id as PlugDefineId;
}

/**
 * Creates a branded TapDefineId after validating structure.
 *
 * @param id - The ID string to validate and brand
 * @returns A branded TapDefineId
 * @throws Error if the ID structure is invalid
 *
 * @example
 * const defId = createTapDefineId('td_a3f2d8e1');  // Returns TapDefineId
 * createTapDefineId('');                           // Throws Error
 */
export function createTapDefineId(id: string): TapDefineId {
  if (!isValidTapDefineId(id)) {
    throw new Error(`Invalid TapDefineId: ${id}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return id as TapDefineId;
}

/**
 * Creates a branded CondDefineId after validating structure.
 *
 * @param id - The ID string to validate and brand
 * @returns A branded CondDefineId
 * @throws Error if the ID structure is invalid
 *
 * @example
 * const defId = createCondDefineId('cd_a3f2d8e1');  // Returns CondDefineId
 * createCondDefineId('');                           // Throws Error
 */
export function createCondDefineId(id: string): CondDefineId {
  if (!isValidCondDefineId(id)) {
    throw new Error(`Invalid CondDefineId: ${id}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return id as CondDefineId;
}

/**
 * Creates a branded InterfaceArgId after validating structure.
 *
 * @param id - The ID string to validate and brand
 * @returns A branded InterfaceArgId
 * @throws Error if the ID structure is invalid
 *
 * @example
 * const argId = createInterfaceArgId('ia1');  // Returns InterfaceArgId
 * createInterfaceArgId('');                   // Throws Error
 */
export function createInterfaceArgId(id: string): InterfaceArgId {
  if (!isValidInterfaceArgId(id)) {
    throw new Error(`Invalid InterfaceArgId: ${id}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return id as InterfaceArgId;
}

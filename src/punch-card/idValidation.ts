import type {
  ValueId,
  FuncId,
  PlugDefineId,
  TapDefineId,
  CondDefineId,
  InterfaceArgId,
  FuncTable,
  PlugFuncDefTable,
  TapFuncDefTable,
  CondFuncDefTable,
  ValueTable,
} from './types';
import type { NodeId } from './runtime/tree-types';

/**
 * Centralized ID validation module.
 *
 * This module consolidates all ID validation logic in one place and provides three categories of functions:
 *
 * 1. **Structural Validators** - Check ID format/structure without table lookups
 *    - Naming: `isValid{Type}Id(id: string): boolean`
 *    - Purpose: Validate ID format before creation or use
 *    - Example: `isValidValueId('v1')` checks if the string is non-empty
 *
 * 2. **Branded ID Creators** - Validate then cast to branded types
 *    - Naming: `create{Type}Id(id: string): {Type}Id`
 *    - Purpose: Safe entry point for creating branded IDs
 *    - Example: `createValueId('v1')` validates and returns a branded ValueId
 *
 * 3. **Table-Based Guards** - Check if ID exists in execution context
 *    - Naming: `is{Type}Id(id, table): id is {Type}Id`
 *    - Purpose: Runtime validation that ID exists in context
 *    - Example: `isFuncId(id, funcTable)` checks if ID exists in the function table
 *
 * ## Design Rationale
 *
 * Separating structural validation from table-based validation serves two purposes:
 * - **Build-time**: Validate ID format when creating/generating IDs (structural validators)
 * - **Runtime**: Validate ID existence when executing (table-based guards)
 *
 * This separation eliminates duplication while keeping concerns separate.
 *
 * ## ID Structure
 *
 * All IDs use the same structural validation: non-empty strings.
 * Prefixes (v_, f_, pd_, td_, cd_, ia_) are for debugging/readability only, not enforced by validation.
 */

// ============================================================================
// STRUCTURAL VALIDATORS
// ============================================================================

/**
 * Core ID validation logic: non-empty string check.
 * All ID types share the same structural requirements.
 * @internal
 */
function validateIdStructure(id: string): boolean {
  return typeof id === 'string' && id.length > 0;
}

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
  return validateIdStructure(id);
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
  return validateIdStructure(id);
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
  return validateIdStructure(id);
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
  return validateIdStructure(id);
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
  return validateIdStructure(id);
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
  return validateIdStructure(id);
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
  return validateIdStructure(id);
}

// ============================================================================
// BRANDED ID CREATORS
// ============================================================================

/**
 * Generic ID creator that validates then casts to branded type.
 * @param id - The ID string to validate
 * @param validator - The validation function
 * @param typeName - Name for error messages
 * @internal
 */
function createBrandedId<T extends string>(
  id: string,
  validator: (id: string) => boolean,
  typeName: string
): T {
  if (!validator(id)) {
    throw new Error(`Invalid ${typeName}: ${id}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return id as T;
}

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
  return createBrandedId<ValueId>(id, isValidValueId, 'ValueId');
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
  return createBrandedId<FuncId>(id, isValidFuncId, 'FuncId');
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
  return createBrandedId<PlugDefineId>(id, isValidPlugDefineId, 'PlugDefineId');
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
  return createBrandedId<TapDefineId>(id, isValidTapDefineId, 'TapDefineId');
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
  return createBrandedId<CondDefineId>(id, isValidCondDefineId, 'CondDefineId');
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
  return createBrandedId<InterfaceArgId>(id, isValidInterfaceArgId, 'InterfaceArgId');
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
 * Type guard to check if an ID exists as a PlugDefineId in the PlugFuncDefTable.
 * @param id - The ID to check
 * @param plugFuncDefTable - The plug function definition table to check against
 * @returns True if the ID exists in the table
 */
export function isPlugDefineId(
  id: string,
  plugFuncDefTable: PlugFuncDefTable
): id is PlugDefineId {
  return id in plugFuncDefTable;
}

/**
 * Type guard to check if an ID exists as a TapDefineId in the TapFuncDefTable.
 * @param id - The ID to check
 * @param tapFuncDefTable - The tap function definition table to check against
 * @returns True if the ID exists in the table
 */
export function isTapDefineId(
  id: string,
  tapFuncDefTable: TapFuncDefTable
): id is TapDefineId {
  return id in tapFuncDefTable;
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

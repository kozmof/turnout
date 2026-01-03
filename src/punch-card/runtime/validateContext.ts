/**
 * Formalized validation system for ExecutionContext.
 *
 * This module implements rigorous validation that aligns types with runtime checks:
 * 1. Type/Runtime Alignment - Uses UnvalidatedContext to represent potentially invalid input
 * 2. Discriminated Result Types - Success/failure union instead of boolean flags
 * 3. Type Environment Separation - Builds type map once, reuses everywhere
 * 4. Binding Validators - Dispatch table for discriminated union handling
 * 5. Single-Pass Validation - Consolidates traversals into state-accumulating algorithm
 * 6. Error/Warning Separation - Compilation errors vs linting warnings are distinct
 */

import {
  ExecutionContext,
  ValueId,
  FuncId,
  PlugDefineId,
  TapDefineId,
  CondDefineId,
  ValueTable,
  FuncTable,
  TapArgBinding,
  TransformFnNames,
  BinaryFnNames,
} from '../types';
import {
  getTransformFnInputType,
  getTransformFnReturnType,
  getBinaryFnParamTypes,
  getBinaryFnReturnType,
} from './typeInference';
import type { BaseTypeSymbol } from '../../state-control/value';
import { baseTypeSymbols } from '../../state-control/value';

// ============================================================================
// Constants
// ============================================================================

/**
 * Valid base type symbols - imported from value.ts for single source of truth.
 * Cached as a Set for efficient validation lookups.
 */
const VALID_BASE_TYPE_SYMBOLS = new Set(baseTypeSymbols);

// ============================================================================
// Task 1: Type/Runtime Alignment - UnvalidatedContext
// ============================================================================

/**
 * Represents potentially invalid or incomplete execution context input.
 * This type admits the possibility of missing or malformed data,
 * allowing validation to check for these conditions without type system lies.
 */
export type UnvalidatedContext = {
  readonly valueTable?: Partial<ValueTable>;
  readonly funcTable?: Partial<FuncTable>;
  readonly plugFuncDefTable?: Partial<Record<string, unknown>>;
  readonly tapFuncDefTable?: Partial<Record<string, unknown>>;
  readonly condFuncDefTable?: Partial<Record<string, unknown>>;
  readonly returnIdToFuncId?: ReadonlyMap<ValueId, FuncId>;
};

// ============================================================================
// Task 2: Discriminated Result Types
// ============================================================================

export type ValidationError = {
  readonly message: string;
  readonly details?: Record<string, unknown>;
};

export type ValidationWarning = {
  readonly message: string;
  readonly details?: Record<string, unknown>;
};

/**
 * Validation result as discriminated union.
 * Success and failure are structurally distinct - the valid flag is the discriminator.
 */
export type ValidationResult =
  | { readonly valid: true; readonly warnings: readonly ValidationWarning[]; readonly errors: readonly never[] }
  | { readonly valid: false; readonly errors: readonly ValidationError[]; readonly warnings: readonly ValidationWarning[] };

/**
 * Type guard to check if validation succeeded.
 */
export function isValidationSuccess(result: ValidationResult): result is Extract<ValidationResult, { valid: true }> {
  return result.valid;
}

// ============================================================================
// TYPE GUARDS
// ============================================================================
//
// Type guards are organized into three conceptual layers:
//
// 1. **Generic Runtime Checks** - Pure TypeScript validation (isRecord, isBaseTypeSymbol, etc.)
// 2. **Shape Guards** - Check if value has correct type shape without context (has*Shape)
// 3. **Context Existence Guards** - Validate ID exists in UnvalidatedContext (*ExistsInContext)
//
// This separation makes it clear which guards check types vs which validate semantics.
// ============================================================================

// ----------------------------------------------------------------------------
// Generic Runtime Checks
// ----------------------------------------------------------------------------

/**
 * Type guard to check if a value is a Record with string keys.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Type guard to check if a string is a valid BaseTypeSymbol.
 * Uses the canonical list from value.ts to prevent type drift.
 */
function isBaseTypeSymbol(value: unknown): value is BaseTypeSymbol {
  if (typeof value !== 'string') return false;
  return VALID_BASE_TYPE_SYMBOLS.has(value as BaseTypeSymbol);
}

/**
 * Type guard to check if a PlugDef has a valid binary function name property.
 * Validates that the name is a properly formatted BinaryFnNames.
 */
function isPlugDefWithBinaryFnName(value: unknown): value is { name: BinaryFnNames } {
  if (!(value && typeof value === 'object' && 'name' in value && typeof value.name === 'string')) {
    return false;
  }
  // Verify it's a valid BinaryFnNames by checking if getBinaryFnReturnType can parse it
  return getBinaryFnReturnType(value.name as BinaryFnNames) !== null;
}

/**
 * Type guard to check if a TapDef has a sequence property.
 */
function isTapDefWithSequence(value: unknown): value is { sequence: unknown[] } {
  return !!(value && typeof value === 'object' && 'sequence' in value && Array.isArray(value.sequence));
}

/**
 * Type guard to check if a value has a symbol property of type BaseTypeSymbol.
 */
function hasSymbolProperty(value: unknown): value is { symbol: BaseTypeSymbol } {
  return !!(value && typeof value === 'object' && 'symbol' in value && isBaseTypeSymbol(value.symbol));
}

/**
 * Type guard to check if an entry has both name and transformFn properties.
 */
function hasNameAndTransformFn(entry: unknown): entry is { name: string; transformFn: unknown } {
  return !!(entry && typeof entry === 'object' && 'name' in entry && typeof entry.name === 'string' && 'transformFn' in entry);
}

/**
 * Type guard to check if an entry has a conditionId property.
 */
function hasConditionId(entry: unknown): entry is { conditionId: string } {
  return !!(entry && typeof entry === 'object' && 'conditionId' in entry && typeof entry.conditionId === 'string');
}

/**
 * Type guard to check if an entry has a specific branch property (trueBranchId or falseBranchId).
 */
function hasBranchId<K extends string>(entry: unknown, branchKey: K): entry is Record<K, string> {
  return !!(entry && typeof entry === 'object' && branchKey in entry && typeof (entry as Record<K, unknown>)[branchKey] === 'string');
}

// ----------------------------------------------------------------------------
// ID Shape Guards (Structural checks without context)
// ----------------------------------------------------------------------------

/**
 * Type guard checking if a value has the structural shape of a ValueId (non-empty string).
 * Does not validate existence in context - use valueIdExistsInContext for that.
 */
function hasValueIdShape(value: unknown): value is ValueId {
  return typeof value === 'string';
}

/**
 * Type guard checking if a value has the structural shape of a FuncId (non-empty string).
 * Does not validate existence in context - use funcIdExistsInContext for that.
 */
function hasFuncIdShape(value: unknown): value is FuncId {
  return typeof value === 'string';
}

/**
 * Type guard checking if a value has the structural shape of a DefineId (non-empty string).
 * Does not validate existence in context - use defineIdExistsInContext for that.
 */
function hasDefineIdShape(value: unknown): value is PlugDefineId | TapDefineId | CondDefineId {
  return typeof value === 'string';
}

/**
 * Type guard to check if a string is a valid TransformFnNames.
 * Only checks if it's a string - actual validation happens in validatePlugDefEntry.
 */
function isTransformFnName(value: unknown): value is TransformFnNames {
  return typeof value === 'string';
}

/**
 * Type guard to check if a string is a valid BinaryFnNames.
 * Only checks if it's a string - actual validation happens elsewhere if needed.
 */
function isBinaryFnName(value: unknown): value is BinaryFnNames {
  return typeof value === 'string';
}

// ----------------------------------------------------------------------------
// Context Existence Guards (Semantic validation with UnvalidatedContext)
// ----------------------------------------------------------------------------

/**
 * Type guard checking if a ValueId exists in the UnvalidatedContext.
 * Checks both valueTable and optionally returnIds set.
 * This is different from idValidation.isValueId which checks validated tables.
 */
function valueIdExistsInContext(
  value: unknown,
  context: UnvalidatedContext,
  returnIds?: Set<ValueId>
): value is ValueId {
  if (typeof value !== 'string') return false;

  // Check if exists in valueTable or returnIds
  const inValueTable = context.valueTable && value in context.valueTable;
  const inReturnIds = returnIds && returnIds.has(value as ValueId);

  return !!(inValueTable || inReturnIds);
}

/**
 * Type guard checking if a FuncId exists in the UnvalidatedContext.
 * Checks the funcTable for existence.
 * This is different from idValidation.isFuncId which checks validated tables.
 */
function funcIdExistsInContext(
  value: unknown,
  context: UnvalidatedContext
): value is FuncId {
  if (typeof value !== 'string') return false;
  return !!(context.funcTable && value in context.funcTable);
}

/**
 * Type guard checking if a DefineId exists in the UnvalidatedContext.
 * Checks all definition tables (plug, tap, cond) for existence.
 * This is different from idValidation table-based guards which check validated tables.
 */
function defineIdExistsInContext(
  value: unknown,
  context: UnvalidatedContext
): value is PlugDefineId | TapDefineId | CondDefineId {
  if (typeof value !== 'string') return false;

  return !!(
    (context.plugFuncDefTable && value in context.plugFuncDefTable) ||
    (context.tapFuncDefTable && value in context.tapFuncDefTable) ||
    (context.condFuncDefTable && value in context.condFuncDefTable)
  );
}


// ============================================================================
// Task 3: Type Environment Separation
// ============================================================================

/**
 * Type environment maps IDs to their inferred base types.
 * Built once during validation, then reused for all type checks.
 */
export type TypeEnvironment = ReadonlyMap<ValueId | FuncId, BaseTypeSymbol>;

/**
 * Builds type environment from context by inferring all value types.
 */
function buildTypeEnvironment(
  context: UnvalidatedContext
): TypeEnvironment {
  const env = new Map<ValueId | FuncId, BaseTypeSymbol>();

  // Infer types from valueTable
  if (context.valueTable) {
    for (const [valueId, value] of Object.entries(context.valueTable)) {
      if (hasSymbolProperty(value) && hasValueIdShape(valueId)) {
        env.set(valueId, value.symbol);
      }
    }
  }

  return env;
}

/**
 * Infers function return type with proper error handling.
 */
function inferFuncType(
  funcId: FuncId,
  context: UnvalidatedContext,
  visited: Set<FuncId> = new Set()
): BaseTypeSymbol | null {
  // Cycle detection
  if (visited.has(funcId)) return null;

  const funcEntry = context.funcTable?.[funcId];
  if (!funcEntry || typeof funcEntry !== 'object') return null;

  visited.add(funcId);

  const defId = 'defId' in funcEntry ? funcEntry.defId : undefined;
  if (!defId || typeof defId !== 'string') return null;

  // Check if it's a PlugFunc with a binary function name
  const plugDef = context.plugFuncDefTable?.[defId];
  if (isPlugDefWithBinaryFnName(plugDef)) {
    return getBinaryFnReturnType(plugDef.name);
  }

  // Check if it's a TapFunc
  const tapDef = context.tapFuncDefTable?.[defId];
  if (isTapDefWithSequence(tapDef)) {
    if (tapDef.sequence.length === 0) return null;

    const lastStep = tapDef.sequence[tapDef.sequence.length - 1];
    if (lastStep && typeof lastStep === 'object' && 'defId' in lastStep) {
      const lastStepDefId = lastStep.defId as string;
      const lastStepPlugDef = context.plugFuncDefTable?.[lastStepDefId];
      if (isPlugDefWithBinaryFnName(lastStepPlugDef)) {
        return getBinaryFnReturnType(lastStepPlugDef.name);
      }
    }
    return null;
  }

  return null;
}

// ============================================================================
// Task 4: Binding Validators with Dispatch Table
// ============================================================================

type BindingValidationContext = {
  readonly stepIndex: number;
  readonly tapDefArgs: Record<string, unknown>;
  readonly valueTable: Partial<ValueTable>;
  readonly defId: string;
};

type BindingValidator = (
  binding: TapArgBinding,
  argName: string,
  context: BindingValidationContext
) => ValidationError | null;

/**
 * Validates 'input' source bindings - must reference TapFunc arguments.
 */
function validateInputBinding(
  binding: Extract<TapArgBinding, { source: 'input' }>,
  argName: string,
  context: BindingValidationContext
): ValidationError | null {
  if (!(binding.argName in context.tapDefArgs)) {
    return {
      message: `TapFuncDefTable[${context.defId}].sequence[${String(context.stepIndex)}]: Argument binding for '${argName}' references undefined TapFunc input '${binding.argName}'`,
      details: { defId: context.defId, stepIndex: context.stepIndex, argName, inputArgName: binding.argName },
    };
  }
  return null;
}

/**
 * Validates 'step' source bindings - must reference previous steps.
 */
function validateStepBinding(
  binding: Extract<TapArgBinding, { source: 'step' }>,
  argName: string,
  context: BindingValidationContext
): ValidationError | null {
  if (binding.stepIndex < 0 || binding.stepIndex >= context.stepIndex) {
    return {
      message: `TapFuncDefTable[${context.defId}].sequence[${String(context.stepIndex)}]: Argument binding for '${argName}' references invalid step index ${String(binding.stepIndex)} (must be < ${String(context.stepIndex)})`,
      details: { defId: context.defId, stepIndex: context.stepIndex, argName, referencedStepIndex: binding.stepIndex },
    };
  }
  return null;
}

/**
 * Validates 'value' source bindings - must reference existing values.
 */
function validateValueBinding(
  binding: Extract<TapArgBinding, { source: 'value' }>,
  argName: string,
  context: BindingValidationContext
): ValidationError | null {
  if (!(binding.valueId in context.valueTable)) {
    return {
      message: `TapFuncDefTable[${context.defId}].sequence[${String(context.stepIndex)}]: Argument binding for '${argName}' references non-existent ValueId ${String(binding.valueId)}`,
      details: { defId: context.defId, stepIndex: context.stepIndex, argName, valueId: binding.valueId },
    };
  }
  return null;
}

/**
 * Dispatch table for binding validation.
 * Maps binding source to appropriate validator.
 */
const BINDING_VALIDATORS: Record<TapArgBinding['source'], BindingValidator> = {
  input: validateInputBinding as BindingValidator,
  step: validateStepBinding as BindingValidator,
  value: validateValueBinding as BindingValidator,
};

/**
 * Validates a TapArgBinding using the appropriate validator from dispatch table.
 */
function validateBinding(
  binding: TapArgBinding,
  argName: string,
  context: BindingValidationContext
): ValidationError | null {
  const validator = BINDING_VALIDATORS[binding.source];
  return validator(binding, argName, context);
}

// ============================================================================
// Task 5 & 6: Single-Pass Validation with Error/Warning Separation
// ============================================================================

/**
 * Accumulated state during single-pass validation.
 */
type ValidationState = {
  readonly errors: ValidationError[];
  readonly warnings: ValidationWarning[];
  readonly referencedValues: Set<ValueId>;
  readonly referencedDefs: Set<PlugDefineId | TapDefineId | CondDefineId>;
  readonly returnIds: Set<ValueId>;
  readonly typeEnv: Map<ValueId | FuncId, BaseTypeSymbol>;
};

/**
 * Creates initial validation state.
 */
function createValidationState(): ValidationState {
  return {
    errors: [],
    warnings: [],
    referencedValues: new Set(),
    referencedDefs: new Set(),
    returnIds: new Set(),
    typeEnv: new Map(),
  };
}

/**
 * Validates a single FuncTable entry.
 */
function validateFuncEntry(
  funcId: string,
  funcEntry: unknown,
  context: UnvalidatedContext,
  state: ValidationState
): void {
  // Structural validation with type guard
  if (!isRecord(funcEntry)) {
    state.errors.push({
      message: `FuncTable[${funcId}]: Invalid entry`,
      details: { funcId },
    });
    return;
  }

  const entry = funcEntry;

  // Validate defId exists
  if (!('defId' in entry) || typeof entry.defId !== 'string') {
    state.errors.push({
      message: `FuncTable[${funcId}]: Missing or invalid defId`,
      details: { funcId },
    });
    return;
  }

  const defId = entry.defId;

  // Check if definition exists using type guard
  if (!defineIdExistsInContext(defId, context)) {
    state.errors.push({
      message: `FuncTable[${funcId}]: Definition ${defId} does not exist`,
      details: { funcId, defId },
    });
  } else {
    // defId is now narrowed to PlugDefineId | TapDefineId | CondDefineId
    state.referencedDefs.add(defId);
  }

  // Validate returnId
  if ('returnId' in entry && hasValueIdShape(entry.returnId)) {
    state.returnIds.add(entry.returnId);
  }

  // Validate argMap
  if ('argMap' in entry && isRecord(entry.argMap)) {
    for (const [argName, argId] of Object.entries(entry.argMap)) {
      if (!valueIdExistsInContext(argId, context, state.returnIds)) {
        if (typeof argId === 'string') {
          state.errors.push({
            message: `FuncTable[${funcId}].argMap['${argName}']: Referenced ID ${argId} does not exist`,
            details: { funcId, argName, argId },
          });
        }
      } else {
        // argId is now narrowed to ValueId and validated
        state.referencedValues.add(argId);
      }
    }
  }

  // Type validation for PlugFunc
  if (defId in (context.plugFuncDefTable || {})) {
    validatePlugFuncTypes(funcId, entry, defId, context, state);
  }
}

/**
 * Validates type safety for a PlugFunc instance.
 */
function validatePlugFuncTypes(
  funcId: string,
  funcEntry: Record<string, unknown>,
  defId: string,
  context: UnvalidatedContext,
  state: ValidationState
): void {
  const def = context.plugFuncDefTable?.[defId];
  if (!isRecord(def)) return;

  if (!('transformFn' in def) || !isRecord(def.transformFn)) {
    return;
  }

  const transformFn = def.transformFn;
  const argMap = ('argMap' in funcEntry && isRecord(funcEntry.argMap))
    ? funcEntry.argMap
    : {};

  // Validate each argument
  for (const [argName, tfn] of Object.entries(transformFn)) {
    if (!isRecord(tfn) || !('name' in tfn) || !isTransformFnName(tfn.name)) {
      continue;
    }

    const transformFnName = tfn.name;
    const expectedType = getTransformFnInputType(transformFnName);

    const argId = argMap[argName];
    if (!hasValueIdShape(argId)) continue;

    // Get actual type from type environment
    let actualType = state.typeEnv.get(argId);

    // If not in env, try to infer from funcTable
    if (!actualType && hasFuncIdShape(argId) && funcIdExistsInContext(argId, context)) {
      const inferredType = inferFuncType(argId, context);
      if (inferredType) {
        actualType = inferredType;
        state.typeEnv.set(argId, actualType);
      }
    }

    if (actualType && expectedType && actualType !== expectedType) {
      state.errors.push({
        message: `FuncTable[${funcId}].argMap['${argName}']: Argument has type "${actualType}" but transform function "${transformFnName}" expects "${expectedType}"`,
        details: {
          funcId,
          argId,
          argType: actualType,
          transformFn: transformFnName,
          expectedType,
        },
      });
    }
  }
}

/**
 * Validates a PlugFuncDefTable entry.
 */
function validatePlugDefEntry(
  defId: string,
  def: unknown,
  state: ValidationState
): void {
  if (!isRecord(def)) {
    state.errors.push({
      message: `PlugFuncDefTable[${defId}]: Invalid entry`,
      details: { defId },
    });
    return;
  }

  const entry = def;

  // Validate function name
  if (!('name' in entry) || typeof entry.name !== 'string' || entry.name.length === 0) {
    state.errors.push({
      message: `PlugFuncDefTable[${defId}]: Invalid or missing function name`,
      details: { defId, name: entry.name },
    });
  }

  // Validate transform functions
  if (!('transformFn' in entry) || !isRecord(entry.transformFn)) {
    state.errors.push({
      message: `PlugFuncDefTable[${defId}]: Missing transform function definitions`,
      details: { defId },
    });
    return;
  }

  const transformFn = entry.transformFn;

  for (const key of ['a', 'b']) {
    if (!(key in transformFn) || !isRecord(transformFn[key])) {
      state.errors.push({
        message: `PlugFuncDefTable[${defId}]: Missing transform function '${key}'`,
        details: { defId },
      });
      continue;
    }

    const tfn = transformFn[key];
    if (!('name' in tfn) || !isTransformFnName(tfn.name)) {
      state.errors.push({
        message: `PlugFuncDefTable[${defId}]: Transform function '${key}' missing name`,
        details: { defId },
      });
      continue;
    }

    const transformFnName = tfn.name;
    const inputType = getTransformFnInputType(transformFnName);
    const returnType = getTransformFnReturnType(transformFnName);

    if (!inputType || !returnType) {
      state.errors.push({
        message: `PlugFuncDefTable[${defId}].transformFn.${key}: Invalid or unknown transform function "${transformFnName}"`,
        details: { defId, transformFn: transformFnName },
      });
    }
  }

  // Validate binary function compatibility
  if (hasNameAndTransformFn(entry)) {
    validateBinaryFnCompatibility(defId, entry.name, transformFn, state);
  }

  // Check if definition is referenced
  if (hasDefineIdShape(defId) && !state.referencedDefs.has(defId)) {
    state.warnings.push({
      message: `PlugFuncDefTable[${defId}]: Definition is never used`,
      details: { defId },
    });
  }
}

/**
 * Validates that transform function outputs match binary function inputs.
 */
function validateBinaryFnCompatibility(
  defId: string,
  binaryFnName: string,
  transformFn: Record<string, unknown>,
  state: ValidationState
): void {
  if (!isBinaryFnName(binaryFnName)) return;

  const paramTypes = getBinaryFnParamTypes(binaryFnName);
  if (!paramTypes) return;

  const [expectedParamA, expectedParamB] = paramTypes;

  // Check transform 'a'
  if ('a' in transformFn && isRecord(transformFn.a)) {
    const tfnA = transformFn.a;
    if ('name' in tfnA && isTransformFnName(tfnA.name)) {
      const returnType = getTransformFnReturnType(tfnA.name);
      if (returnType && returnType !== expectedParamA) {
        state.errors.push({
          message: `PlugFuncDefTable[${defId}]: Transform function 'a' returns "${returnType}" but binary function "${binaryFnName}" expects "${expectedParamA}" for first parameter`,
          details: {
            defId,
            transformFn: tfnA.name,
            transformReturnType: returnType,
            binaryFn: binaryFnName,
            expectedType: expectedParamA,
          },
        });
      }
    }
  }

  // Check transform 'b'
  if ('b' in transformFn && isRecord(transformFn.b)) {
    const tfnB = transformFn.b;
    if ('name' in tfnB && isTransformFnName(tfnB.name)) {
      const returnType = getTransformFnReturnType(tfnB.name);
      if (returnType && returnType !== expectedParamB) {
        state.errors.push({
          message: `PlugFuncDefTable[${defId}]: Transform function 'b' returns "${returnType}" but binary function "${binaryFnName}" expects "${expectedParamB}" for second parameter`,
          details: {
            defId,
            transformFn: tfnB.name,
            transformReturnType: returnType,
            binaryFn: binaryFnName,
            expectedType: expectedParamB,
          },
        });
      }
    }
  }
}

/**
 * Validates a TapFuncDefTable entry.
 */
function validateTapDefEntry(
  defId: string,
  def: unknown,
  context: UnvalidatedContext,
  state: ValidationState
): void {
  if (!isRecord(def)) {
    state.errors.push({
      message: `TapFuncDefTable[${defId}]: Invalid entry`,
      details: { defId },
    });
    return;
  }

  const entry = def;

  // Validate sequence exists
  if (!('sequence' in entry) || !Array.isArray(entry.sequence)) {
    state.errors.push({
      message: `TapFuncDefTable[${defId}]: Missing or invalid sequence`,
      details: { defId },
    });
    return;
  }

  // Check for empty sequence
  if (entry.sequence.length === 0) {
    state.errors.push({
      message: `TapFuncDefTable[${defId}]: Sequence is empty`,
      details: { defId },
    });
    return;
  }

  const tapDefArgs = ('args' in entry && isRecord(entry.args))
    ? entry.args
    : {};

  // Validate each step
  for (let i = 0; i < entry.sequence.length; i++) {
    const step = entry.sequence[i];
    if (!isRecord(step)) continue;

    const stepObj = step;

    // Validate step defId
    if (!('defId' in stepObj) || typeof stepObj.defId !== 'string') {
      state.errors.push({
        message: `TapFuncDefTable[${defId}].sequence[${String(i)}]: Missing step defId`,
        details: { defId, stepIndex: i },
      });
      continue;
    }

    const stepDefId = stepObj.defId;

    // Check if step definition exists using type guard
    if (!defineIdExistsInContext(stepDefId, context)) {
      state.errors.push({
        message: `TapFuncDefTable[${defId}].sequence[${String(i)}]: Referenced definition ${stepDefId} does not exist`,
        details: { defId, stepIndex: i, stepDefId },
      });
      continue;
    }

    // Validate argument bindings using dispatch table
    if ('argBindings' in stepObj && isRecord(stepObj.argBindings)) {
      const argBindings = stepObj.argBindings;

      for (const [argName, binding] of Object.entries(argBindings)) {
        if (!isRecord(binding) || !('source' in binding)) {
          continue;
        }

        const bindingObj = binding as TapArgBinding;
        const validationContext: BindingValidationContext = {
          stepIndex: i,
          tapDefArgs,
          valueTable: context.valueTable || {},
          defId,
        };

        const error = validateBinding(bindingObj, argName, validationContext);
        if (error) {
          state.errors.push(error);
        }
      }
    }
  }

  // Check if definition is referenced
  if (hasDefineIdShape(defId) && !state.referencedDefs.has(defId)) {
    state.warnings.push({
      message: `TapFuncDefTable[${defId}]: Definition is never used`,
      details: { defId },
    });
  }
}

/**
 * Validates a CondFuncDefTable entry.
 */
function validateCondDefEntry(
  defId: string,
  def: unknown,
  context: UnvalidatedContext,
  state: ValidationState
): void {
  if (!isRecord(def)) {
    state.errors.push({
      message: `CondFuncDefTable[${defId}]: Invalid entry`,
      details: { defId },
    });
    return;
  }

  const entry = def;

  // Validate condition ID
  if (hasConditionId(entry)) {
    const conditionId = entry.conditionId;

    // Check if it's a valid ValueId or FuncId
    const isValue = valueIdExistsInContext(conditionId, context);
    const isFunc = funcIdExistsInContext(conditionId, context);

    if (!isValue && !isFunc) {
      state.errors.push({
        message: `CondFuncDefTable[${defId}].conditionId: Referenced ID ${conditionId} does not exist`,
        details: { defId, conditionId },
      });
    } else if (isValue) {
      // Narrowed to ValueId
      state.referencedValues.add(conditionId);
    }
  }

  // Validate branch IDs
  for (const branchKey of ['trueBranchId', 'falseBranchId'] as const) {
    if (hasBranchId(entry, branchKey)) {
      const branchId = entry[branchKey];
      if (!funcIdExistsInContext(branchId, context)) {
        state.errors.push({
          message: `CondFuncDefTable[${defId}].${branchKey}: Referenced FuncId ${branchId} does not exist`,
          details: { defId, [branchKey]: branchId },
        });
      }
    }
  }

  // Check if definition is referenced
  if (hasDefineIdShape(defId) && !state.referencedDefs.has(defId)) {
    state.warnings.push({
      message: `CondFuncDefTable[${defId}]: Definition is never used`,
      details: { defId },
    });
  }
}

/**
 * Checks for unreferenced values in the ValueTable.
 */
function checkUnreferencedValues(
  context: UnvalidatedContext,
  state: ValidationState
): void {
  if (!context.valueTable) return;

  for (const valueId of Object.keys(context.valueTable)) {
    if (hasValueIdShape(valueId) && !state.referencedValues.has(valueId)) {
      state.warnings.push({
        message: `ValueTable[${valueId}]: Value is never referenced`,
        details: { valueId },
      });
    }
  }
}

/**
 * Main validation function - single-pass algorithm with state accumulation.
 *
 * This consolidates all validation into a single traversal of the context,
 * accumulating errors, warnings, and metadata in a shared state object.
 */
export function validateContext(context: UnvalidatedContext): ValidationResult {
  const state = createValidationState();

  // Build initial type environment from values
  const initialTypeEnv = buildTypeEnvironment(context);
  for (const [id, type] of initialTypeEnv) {
    state.typeEnv.set(id, type);
  }

  // Single pass over funcTable - validates structure and types
  if (context.funcTable) {
    for (const [funcId, funcEntry] of Object.entries(context.funcTable)) {
      validateFuncEntry(funcId, funcEntry, context, state);
    }
  }

  // Single pass over plugFuncDefTable - validates structure and checks usage
  if (context.plugFuncDefTable) {
    for (const [defId, def] of Object.entries(context.plugFuncDefTable)) {
      validatePlugDefEntry(defId, def, state);
    }
  }

  // Single pass over tapFuncDefTable - validates structure and checks usage
  if (context.tapFuncDefTable) {
    for (const [defId, def] of Object.entries(context.tapFuncDefTable)) {
      validateTapDefEntry(defId, def, context, state);
    }
  }

  // Single pass over condFuncDefTable - validates structure and checks usage
  if (context.condFuncDefTable) {
    for (const [defId, def] of Object.entries(context.condFuncDefTable)) {
      validateCondDefEntry(defId, def, context, state);
    }
  }

  // Check for unreferenced values (warnings only)
  checkUnreferencedValues(context, state);

  // Return discriminated union result
  if (state.errors.length === 0) {
    return {
      valid: true,
      warnings: state.warnings,
      errors: [],
    };
  } else {
    return {
      valid: false,
      errors: state.errors,
      warnings: state.warnings,
    };
  }
}

/**
 * Validates context and throws an error if invalid.
 * Useful for strict validation before execution.
 */
export function assertValidContext(context: UnvalidatedContext): asserts context is ExecutionContext {
  const result = validateContext(context);

  if (!result.valid) {
    const errorMessages = result.errors
      .map(err => `  - ${err.message}`)
      .join('\n');

    throw new Error(
      `ExecutionContext validation failed:\n${errorMessages}`
    );
  }
}

/**
 * Type guard to check if an unvalidated context is a valid ExecutionContext.
 */
export function isValidContext(context: UnvalidatedContext): context is ExecutionContext {
  const result = validateContext(context);
  return result.valid;
}

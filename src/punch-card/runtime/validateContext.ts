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
} from './typeInference';
import type { BaseTypeSymbol } from '../../state-control/value';

// ============================================================================
// Task 1: Type/Runtime Alignment - UnvalidatedContext
// ============================================================================

/**
 * Represents potentially invalid or incomplete execution context input.
 * This type admits the possibility of missing or malformed data,
 * allowing validation to check for these conditions without type system lies.
 */
export type UnvalidatedContext = {
  readonly valueTable: Partial<ValueTable>;
  readonly funcTable: Partial<FuncTable>;
  readonly plugFuncDefTable: Partial<Record<string, unknown>>;
  readonly tapFuncDefTable: Partial<Record<string, unknown>>;
  readonly condFuncDefTable: Partial<Record<string, unknown>>;
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
      if (value && typeof value === 'object' && 'symbol' in value && typeof value.symbol === 'string') {
        env.set(valueId as ValueId, value.symbol as BaseTypeSymbol);
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

  // Check if it's a PlugFunc
  const plugDef = context.plugFuncDefTable?.[defId];
  if (plugDef && typeof plugDef === 'object' && 'name' in plugDef && typeof plugDef.name === 'string') {
    return getBinaryFnReturnType(plugDef.name);
  }

  // Check if it's a TapFunc
  const tapDef = context.tapFuncDefTable?.[defId];
  if (tapDef && typeof tapDef === 'object' && 'sequence' in tapDef && Array.isArray(tapDef.sequence)) {
    if (tapDef.sequence.length === 0) return null;

    const lastStep = tapDef.sequence[tapDef.sequence.length - 1];
    if (lastStep && typeof lastStep === 'object' && 'defId' in lastStep) {
      const lastStepDefId = lastStep.defId as string;
      const lastStepPlugDef = context.plugFuncDefTable?.[lastStepDefId];
      if (lastStepPlugDef && typeof lastStepPlugDef === 'object' && 'name' in lastStepPlugDef) {
        return getBinaryFnReturnType(lastStepPlugDef.name as string);
      }
    }
    return null;
  }

  return null;
}

/**
 * Helper to get return type from binary function name.
 */
function getBinaryFnReturnType(binaryFnName: string): BaseTypeSymbol | null {
  const parts = binaryFnName.split('::');
  if (parts.length !== 2) return null;

  const namespace = parts[0];

  switch (namespace) {
    case 'binaryFnNumber':
      return 'number';
    case 'binaryFnString':
      return 'string';
    case 'binaryFnBoolean':
      return 'boolean';
    case 'binaryFnArray':
      return 'array';
    case 'binaryFnGeneric':
      return 'boolean';
    default:
      return null;
  }
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
      message: `TapFuncDefTable[${context.defId}].sequence[${context.stepIndex}]: Argument binding for '${argName}' references undefined TapFunc input '${binding.argName}'`,
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
      message: `TapFuncDefTable[${context.defId}].sequence[${context.stepIndex}]: Argument binding for '${argName}' references invalid step index ${binding.stepIndex} (must be < ${context.stepIndex})`,
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
  if (!(binding.valueId in (context.valueTable || {}))) {
    return {
      message: `TapFuncDefTable[${context.defId}].sequence[${context.stepIndex}]: Argument binding for '${argName}' references non-existent ValueId ${String(binding.valueId)}`,
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
  // Structural validation
  if (!funcEntry || typeof funcEntry !== 'object') {
    state.errors.push({
      message: `FuncTable[${funcId}]: Invalid entry`,
      details: { funcId },
    });
    return;
  }

  const entry = funcEntry as Record<string, unknown>;

  // Validate defId exists
  if (!('defId' in entry) || typeof entry.defId !== 'string') {
    state.errors.push({
      message: `FuncTable[${funcId}]: Missing or invalid defId`,
      details: { funcId },
    });
    return;
  }

  const defId = entry.defId;

  // Check if definition exists
  const defExists =
    defId in (context.plugFuncDefTable || {}) ||
    defId in (context.tapFuncDefTable || {}) ||
    defId in (context.condFuncDefTable || {});

  if (!defExists) {
    state.errors.push({
      message: `FuncTable[${funcId}]: Definition ${defId} does not exist`,
      details: { funcId, defId },
    });
  } else {
    state.referencedDefs.add(defId as PlugDefineId | TapDefineId | CondDefineId);
  }

  // Validate returnId
  if ('returnId' in entry && typeof entry.returnId === 'string') {
    state.returnIds.add(entry.returnId as ValueId);
  }

  // Validate argMap
  if ('argMap' in entry && entry.argMap && typeof entry.argMap === 'object') {
    const argMap = entry.argMap as Record<string, unknown>;
    for (const [argName, argId] of Object.entries(argMap)) {
      if (typeof argId === 'string') {
        const valueId = argId as ValueId;
        const isValid =
          valueId in (context.valueTable || {}) ||
          state.returnIds.has(valueId);

        if (!isValid) {
          state.errors.push({
            message: `FuncTable[${funcId}].argMap['${argName}']: Referenced ID ${argId} does not exist`,
            details: { funcId, argName, argId },
          });
        } else {
          state.referencedValues.add(valueId);
        }
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
  if (!def || typeof def !== 'object') return;

  const plugDef = def as Record<string, unknown>;
  if (!('transformFn' in plugDef) || !plugDef.transformFn || typeof plugDef.transformFn !== 'object') {
    return;
  }

  const transformFn = plugDef.transformFn as Record<string, unknown>;
  const argMap = ('argMap' in funcEntry && funcEntry.argMap && typeof funcEntry.argMap === 'object')
    ? funcEntry.argMap as Record<string, unknown>
    : {};

  // Validate each argument
  for (const [argName, tfn] of Object.entries(transformFn)) {
    if (!tfn || typeof tfn !== 'object' || !('name' in tfn) || typeof tfn.name !== 'string') {
      continue;
    }

    const transformFnName = tfn.name as TransformFnNames;
    const expectedType = getTransformFnInputType(transformFnName);

    const argId = argMap[argName];
    if (typeof argId !== 'string') continue;

    // Get actual type from type environment
    let actualType = state.typeEnv.get(argId as ValueId);

    // If not in env, try to infer from funcTable
    if (!actualType && argId in (context.funcTable || {})) {
      const inferredType = inferFuncType(argId as FuncId, context);
      if (inferredType) {
        actualType = inferredType;
        state.typeEnv.set(argId as FuncId, actualType);
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
  if (!def || typeof def !== 'object') {
    state.errors.push({
      message: `PlugFuncDefTable[${defId}]: Invalid entry`,
      details: { defId },
    });
    return;
  }

  const entry = def as Record<string, unknown>;

  // Validate function name
  if (!('name' in entry) || typeof entry.name !== 'string' || entry.name.length === 0) {
    state.errors.push({
      message: `PlugFuncDefTable[${defId}]: Invalid or missing function name`,
      details: { defId, name: entry.name },
    });
  }

  // Validate transform functions
  if (!('transformFn' in entry) || !entry.transformFn || typeof entry.transformFn !== 'object') {
    state.errors.push({
      message: `PlugFuncDefTable[${defId}]: Missing transform function definitions`,
      details: { defId },
    });
    return;
  }

  const transformFn = entry.transformFn as Record<string, unknown>;

  for (const key of ['a', 'b']) {
    if (!(key in transformFn) || !transformFn[key] || typeof transformFn[key] !== 'object') {
      state.errors.push({
        message: `PlugFuncDefTable[${defId}]: Missing transform function '${key}'`,
        details: { defId },
      });
      continue;
    }

    const tfn = transformFn[key] as Record<string, unknown>;
    if (!('name' in tfn) || typeof tfn.name !== 'string') {
      state.errors.push({
        message: `PlugFuncDefTable[${defId}]: Transform function '${key}' missing name`,
        details: { defId },
      });
      continue;
    }

    const transformFnName = tfn.name as TransformFnNames;
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
  if ('name' in entry && typeof entry.name === 'string' && 'transformFn' in entry) {
    validateBinaryFnCompatibility(defId, entry.name, transformFn, state);
  }

  // Check if definition is referenced
  if (!state.referencedDefs.has(defId as PlugDefineId)) {
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
  const paramTypes = getBinaryFnParamTypes(binaryFnName as BinaryFnNames);
  if (!paramTypes) return;

  const [expectedParamA, expectedParamB] = paramTypes;

  // Check transform 'a'
  if ('a' in transformFn && transformFn.a && typeof transformFn.a === 'object') {
    const tfnA = transformFn.a as Record<string, unknown>;
    if ('name' in tfnA && typeof tfnA.name === 'string') {
      const returnType = getTransformFnReturnType(tfnA.name as TransformFnNames);
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
  if ('b' in transformFn && transformFn.b && typeof transformFn.b === 'object') {
    const tfnB = transformFn.b as Record<string, unknown>;
    if ('name' in tfnB && typeof tfnB.name === 'string') {
      const returnType = getTransformFnReturnType(tfnB.name as TransformFnNames);
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
  if (!def || typeof def !== 'object') {
    state.errors.push({
      message: `TapFuncDefTable[${defId}]: Invalid entry`,
      details: { defId },
    });
    return;
  }

  const entry = def as Record<string, unknown>;

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

  const tapDefArgs = ('args' in entry && entry.args && typeof entry.args === 'object')
    ? entry.args as Record<string, unknown>
    : {};

  // Validate each step
  for (let i = 0; i < entry.sequence.length; i++) {
    const step = entry.sequence[i];
    if (!step || typeof step !== 'object') continue;

    const stepObj = step as Record<string, unknown>;

    // Validate step defId
    if (!('defId' in stepObj) || typeof stepObj.defId !== 'string') {
      state.errors.push({
        message: `TapFuncDefTable[${defId}].sequence[${i}]: Missing step defId`,
        details: { defId, stepIndex: i },
      });
      continue;
    }

    const stepDefId = stepObj.defId;

    // Check if step definition exists
    const stepDefExists =
      stepDefId in (context.plugFuncDefTable || {}) ||
      stepDefId in (context.tapFuncDefTable || {}) ||
      stepDefId in (context.condFuncDefTable || {});

    if (!stepDefExists) {
      state.errors.push({
        message: `TapFuncDefTable[${defId}].sequence[${i}]: Referenced definition ${stepDefId} does not exist`,
        details: { defId, stepIndex: i, stepDefId },
      });
      continue;
    }

    // Validate argument bindings using dispatch table
    if ('argBindings' in stepObj && stepObj.argBindings && typeof stepObj.argBindings === 'object') {
      const argBindings = stepObj.argBindings as Record<string, unknown>;

      for (const [argName, binding] of Object.entries(argBindings)) {
        if (!binding || typeof binding !== 'object' || !('source' in binding)) {
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
  if (!state.referencedDefs.has(defId as TapDefineId)) {
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
  if (!def || typeof def !== 'object') {
    state.errors.push({
      message: `CondFuncDefTable[${defId}]: Invalid entry`,
      details: { defId },
    });
    return;
  }

  const entry = def as Record<string, unknown>;

  // Validate condition ID
  if ('conditionId' in entry && typeof entry.conditionId === 'string') {
    const conditionId = entry.conditionId;
    const conditionIdValid =
      conditionId in (context.funcTable || {}) ||
      conditionId in (context.valueTable || {});

    if (!conditionIdValid) {
      state.errors.push({
        message: `CondFuncDefTable[${defId}].conditionId: Referenced ID ${conditionId} does not exist`,
        details: { defId, conditionId },
      });
    } else if (conditionId in (context.valueTable || {})) {
      state.referencedValues.add(conditionId as ValueId);
    }
  }

  // Validate branch IDs
  for (const branchKey of ['trueBranchId', 'falseBranchId']) {
    if (branchKey in entry && typeof entry[branchKey] === 'string') {
      const branchId = entry[branchKey] as string;
      if (!(branchId in (context.funcTable || {}))) {
        state.errors.push({
          message: `CondFuncDefTable[${defId}].${branchKey}: Referenced FuncId ${branchId} does not exist`,
          details: { defId, [branchKey]: branchId },
        });
      }
    }
  }

  // Check if definition is referenced
  if (!state.referencedDefs.has(defId as CondDefineId)) {
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
    if (!state.referencedValues.has(valueId as ValueId)) {
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

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
  CombineDefineId,
  PipeDefineId,
  CondDefineId,
  ValueTable,
  FuncTable,
  PipeArgBinding,
  TransformFnNames,
  BinaryFnNames,
} from "../types";
import {
  getTransformFnInputType,
  getTransformFnReturnType,
  getBinaryFnParamTypes,
  getBinaryFnReturnType,
} from "./typeInference";
import { createPipeArgName, createValueId } from "../idValidation";
import type { BaseTypeSymbol } from "../../state-control/value";
import { baseTypeSymbols } from "../../state-control/value";

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
  readonly combineFuncDefTable?: Partial<Record<string, unknown>>;
  readonly pipeFuncDefTable?: Partial<Record<string, unknown>>;
  readonly condFuncDefTable?: Partial<Record<string, unknown>>;
};

// ============================================================================
// ValidatedContext - Branded type for contexts that have passed validation
// ============================================================================

const _validatedBrand: unique symbol = Symbol("validatedContext");

/**
 * An ExecutionContext that has been verified by validateContext.
 * The brand makes it impossible to construct this type without going through
 * the validation functions in this module, enforcing validation at the type level.
 */
export type ValidatedContext = ExecutionContext & {
  readonly [_validatedBrand]: true;
};

function createValidatedContext(context: ExecutionContext): ValidatedContext {
  return {
    ...context,
    [_validatedBrand]: true,
  };
}

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
 * On success, the result includes the context cast to ValidatedContext so callers
 * can pass it directly to executeGraph without an extra assertion.
 */
export type ValidationResult =
  | {
      readonly valid: true;
      readonly context: ValidatedContext;
      readonly warnings: readonly ValidationWarning[];
      readonly errors: readonly never[];
    }
  | {
      readonly valid: false;
      readonly errors: readonly ValidationError[];
      readonly warnings: readonly ValidationWarning[];
    };

/**
 * Type guard to check if validation succeeded.
 */
export function isValidationSuccess(
  result: ValidationResult,
): result is Extract<ValidationResult, { valid: true }> {
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
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Type guard to check if a string is a valid BaseTypeSymbol.
 * Uses the canonical list from value.ts to prevent type drift.
 */
function isBaseTypeSymbol(value: unknown): value is BaseTypeSymbol {
  if (typeof value !== "string") return false;
  return VALID_BASE_TYPE_SYMBOLS.has(value as BaseTypeSymbol);
}

/**
 * Type guard to check if a CombineDef has a valid binary function name property.
 * Validates that the name is a properly formatted BinaryFnNames.
 */
function isCombineDefWithBinaryFnName(
  value: unknown,
): value is { name: BinaryFnNames } {
  if (
    !(
      value &&
      typeof value === "object" &&
      "name" in value &&
      typeof value.name === "string"
    )
  ) {
    return false;
  }
  // Verify it's a valid BinaryFnNames by checking if getBinaryFnReturnType can parse it
  return getBinaryFnReturnType(value.name as BinaryFnNames) !== null;
}

/**
 * Type guard to check if a PipeDef has a sequence property.
 */
function isPipeDefWithSequence(
  value: unknown,
): value is { sequence: unknown[] } {
  return !!(
    value &&
    typeof value === "object" &&
    "sequence" in value &&
    Array.isArray(value.sequence)
  );
}

/**
 * Type guard to check if a value has a symbol property of type BaseTypeSymbol.
 */
function hasSymbolProperty(
  value: unknown,
): value is { symbol: BaseTypeSymbol } {
  return !!(
    value &&
    typeof value === "object" &&
    "symbol" in value &&
    isBaseTypeSymbol(value.symbol)
  );
}

/**
 * Type guard to check if an entry has both name and transformFn properties.
 */
function hasNameAndTransformFn(
  entry: unknown,
): entry is { name: string; transformFn: unknown } {
  return !!(
    entry &&
    typeof entry === "object" &&
    "name" in entry &&
    typeof entry.name === "string" &&
    "transformFn" in entry
  );
}

// ----------------------------------------------------------------------------
// ID Shape Guards (Structural checks without context)
// ----------------------------------------------------------------------------

/**
 * Type guard that checks if a value is a string and narrows it to a branded type.
 *
 * This only checks typeof === 'string' - it does NOT validate brand invariants.
 * Use *ExistsInContext guards for semantic validation.
 *
 * @example
 * if (isStringAs<ValueId>(valueId)) {
 *   // TypeScript knows valueId is ValueId (a string)
 * }
 */
function isStringAs<T>(value: unknown): value is T {
  return typeof value === "string";
}

/**
 * Runtime helper to safely check key existence without assuming object shape.
 */
function hasKey(table: unknown, key: string): boolean {
  return isRecord(table) && key in table;
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
  returnIds?: Set<ValueId>,
): value is ValueId {
  if (typeof value !== "string") return false;

  // Check if exists in valueTable or returnIds
  const inValueTable = hasKey(context.valueTable, value);
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
  context: UnvalidatedContext,
): value is FuncId {
  if (typeof value !== "string") return false;
  return hasKey(context.funcTable, value);
}

/**
 * Type guard checking if a DefineId exists in the UnvalidatedContext.
 * Checks all definition tables (combine, pipe, cond) for existence.
 * This is different from idValidation table-based guards which check validated tables.
 */
function defineIdExistsInContext(
  value: unknown,
  context: UnvalidatedContext,
): value is CombineDefineId | PipeDefineId | CondDefineId {
  if (typeof value !== "string") return false;

  return !!(
    hasKey(context.combineFuncDefTable, value) ||
    hasKey(context.pipeFuncDefTable, value) ||
    hasKey(context.condFuncDefTable, value)
  );
}

/**
 * Type guard checking if a string is a valid pipe step definition ID.
 * Pipe steps may only reference combine or pipe definitions — not cond definitions.
 * Returns 'cond' if the value exists only in condFuncDefTable (invalid for pipe steps).
 */
function pipeStepDefIdExistsInContext(
  value: unknown,
  context: UnvalidatedContext,
): { exists: boolean; isCondDef: boolean } {
  if (typeof value !== "string") return { exists: false, isCondDef: false };

  const inCombine = hasKey(context.combineFuncDefTable, value);
  const inPipe = hasKey(context.pipeFuncDefTable, value);
  const inCond = hasKey(context.condFuncDefTable, value);

  return {
    exists: inCombine || inPipe || inCond,
    isCondDef: !inCombine && !inPipe && inCond,
  };
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
function buildTypeEnvironment(context: UnvalidatedContext): TypeEnvironment {
  const env = new Map<ValueId | FuncId, BaseTypeSymbol>();

  // Infer types from valueTable
  if (context.valueTable) {
    for (const [valueId, value] of Object.entries(context.valueTable)) {
      if (hasSymbolProperty(value) && isStringAs<ValueId>(valueId)) {
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
  visited: Set<FuncId> = new Set(),
): BaseTypeSymbol | null {
  // Cycle detection
  if (visited.has(funcId)) return null;

  const funcEntry = context.funcTable?.[funcId];
  if (!funcEntry || typeof funcEntry !== "object") return null;

  visited.add(funcId);

  const defId = "defId" in funcEntry ? funcEntry.defId : undefined;
  if (!defId || typeof defId !== "string") return null;

  // Check if it's a CombineFunc with a binary function name
  const combineDef = context.combineFuncDefTable?.[defId];
  if (isCombineDefWithBinaryFnName(combineDef)) {
    return getBinaryFnReturnType(combineDef.name);
  }

  // Check if it's a PipeFunc
  const pipeDef = context.pipeFuncDefTable?.[defId];
  if (isPipeDefWithSequence(pipeDef)) {
    if (pipeDef.sequence.length === 0) return null;

    const lastStep = pipeDef.sequence[pipeDef.sequence.length - 1];
    if (lastStep && typeof lastStep === "object" && "defId" in lastStep) {
      const lastStepDefId = lastStep.defId as string;
      const lastStepCombineDef = context.combineFuncDefTable?.[lastStepDefId];
      if (isCombineDefWithBinaryFnName(lastStepCombineDef)) {
        return getBinaryFnReturnType(lastStepCombineDef.name);
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
  readonly pipeDefArgs: Record<string, unknown>;
  readonly valueTable: Partial<ValueTable>;
  readonly defId: string;
  readonly referencedValues: Set<ValueId>;
};

type BindingValidator = (
  binding: PipeArgBinding,
  argName: string,
  context: BindingValidationContext,
) => ValidationError | null;

/**
 * Validates 'input' source bindings - must reference PipeFunc arguments.
 */
function validateInputBinding(
  binding: Extract<PipeArgBinding, { source: "input" }>,
  argName: string,
  context: BindingValidationContext,
): ValidationError | null {
  if (!(binding.argName in context.pipeDefArgs)) {
    return {
      message: `PipeFuncDefTable[${context.defId}].sequence[${String(context.stepIndex)}]: Argument binding for '${argName}' references undefined PipeFunc input '${binding.argName}'`,
      details: {
        defId: context.defId,
        stepIndex: context.stepIndex,
        argName,
        inputArgName: binding.argName,
      },
    };
  }
  return null;
}

/**
 * Validates 'step' source bindings - must reference previous steps.
 */
function validateStepBinding(
  binding: Extract<PipeArgBinding, { source: "step" }>,
  argName: string,
  context: BindingValidationContext,
): ValidationError | null {
  if (
    !Number.isInteger(binding.stepIndex) ||
    binding.stepIndex < 0 ||
    binding.stepIndex >= context.stepIndex
  ) {
    return {
      message: `PipeFuncDefTable[${context.defId}].sequence[${String(context.stepIndex)}]: Argument binding for '${argName}' references invalid step index ${String(binding.stepIndex)} (must be < ${String(context.stepIndex)})`,
      details: {
        defId: context.defId,
        stepIndex: context.stepIndex,
        argName,
        referencedStepIndex: binding.stepIndex,
      },
    };
  }
  return null;
}

/**
 * Validates 'value' source bindings - must reference existing values.
 */
function validateValueBinding(
  binding: Extract<PipeArgBinding, { source: "value" }>,
  argName: string,
  context: BindingValidationContext,
): ValidationError | null {
  if (!hasKey(context.valueTable, binding.id)) {
    return {
      message: `PipeFuncDefTable[${context.defId}].sequence[${String(context.stepIndex)}]: Argument binding for '${argName}' references non-existent ValueId ${String(binding.id)}`,
      details: {
        defId: context.defId,
        stepIndex: context.stepIndex,
        argName,
        valueId: binding.id,
      },
    };
  }
  context.referencedValues.add(binding.id);
  return null;
}

function parseBinding(
  binding: unknown,
  defId: string,
  stepIndex: number,
  argName: string,
): { binding?: PipeArgBinding; error?: ValidationError } {
  if (
    !isRecord(binding) ||
    !("source" in binding) ||
    typeof binding.source !== "string"
  ) {
    return {
      error: {
        message: `PipeFuncDefTable[${defId}].sequence[${String(stepIndex)}]: Argument binding for '${argName}' is invalid`,
        details: { defId, stepIndex, argName },
      },
    };
  }

  switch (binding.source) {
    case "input":
      if (
        !("argName" in binding) ||
        typeof binding.argName !== "string" ||
        binding.argName.length === 0
      ) {
        return {
          error: {
            message: `PipeFuncDefTable[${defId}].sequence[${String(stepIndex)}]: 'input' binding for '${argName}' must include string argName`,
            details: { defId, stepIndex, argName },
          },
        };
      }
      return {
        binding: {
          source: "input",
          argName: createPipeArgName(binding.argName),
        },
      };
    case "step":
      if (!("stepIndex" in binding) || typeof binding.stepIndex !== "number") {
        return {
          error: {
            message: `PipeFuncDefTable[${defId}].sequence[${String(stepIndex)}]: 'step' binding for '${argName}' must include numeric stepIndex`,
            details: { defId, stepIndex, argName },
          },
        };
      }
      return {
        binding: {
          source: "step",
          stepIndex: binding.stepIndex,
        },
      };
    case "value":
      if (
        !("id" in binding) ||
        typeof binding.id !== "string" ||
        binding.id.length === 0
      ) {
        return {
          error: {
            message: `PipeFuncDefTable[${defId}].sequence[${String(stepIndex)}]: 'value' binding for '${argName}' must include string id`,
            details: { defId, stepIndex, argName },
          },
        };
      }
      return {
        binding: {
          source: "value",
          id: createValueId(binding.id),
        },
      };
    default:
      return {
        error: {
          message: `PipeFuncDefTable[${defId}].sequence[${String(stepIndex)}]: Argument binding for '${argName}' has unknown source "${binding.source}"`,
          details: { defId, stepIndex, argName, source: binding.source },
        },
      };
  }
}

/**
 * Dispatch table for binding validation.
 * Maps binding source to appropriate validator.
 */
const BINDING_VALIDATORS: Record<PipeArgBinding["source"], BindingValidator> = {
  input: validateInputBinding as BindingValidator,
  step: validateStepBinding as BindingValidator,
  value: validateValueBinding as BindingValidator,
};

/**
 * Validates a PipeArgBinding using the appropriate validator from dispatch table.
 */
function validateBinding(
  binding: PipeArgBinding,
  argName: string,
  context: BindingValidationContext,
): ValidationError | null {
  const validator = BINDING_VALIDATORS[binding.source];
  if (!validator) {
    return {
      message: `PipeFuncDefTable[${context.defId}].sequence[${String(context.stepIndex)}]: Argument binding for '${argName}' has unknown source "${(binding as { source: string }).source}"`,
      details: { defId: context.defId, stepIndex: context.stepIndex, argName },
    };
  }
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
  readonly referencedDefs: Set<CombineDefineId | PipeDefineId | CondDefineId>;
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
  state: ValidationState,
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

  // Validate kind discriminant
  if (!("kind" in entry) || typeof entry.kind !== "string") {
    state.errors.push({
      message: `FuncTable[${funcId}]: Missing or invalid kind`,
      details: { funcId, kind: "kind" in entry ? entry.kind : undefined },
    });
    return;
  }
  if (
    entry.kind !== "combine" &&
    entry.kind !== "pipe" &&
    entry.kind !== "cond"
  ) {
    state.errors.push({
      message: `FuncTable[${funcId}]: Unknown kind "${entry.kind}"`,
      details: { funcId, kind: entry.kind },
    });
    return;
  }

  // Validate defId exists
  if (!("defId" in entry) || typeof entry.defId !== "string") {
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
    // defId is now narrowed to CombineDefineId | PipeDefineId | CondDefineId
    state.referencedDefs.add(defId);
  }

  // Validate returnId
  if (!("returnId" in entry) || !isStringAs<ValueId>(entry.returnId)) {
    state.errors.push({
      message: `FuncTable[${funcId}]: Missing or invalid returnId`,
      details: { funcId },
    });
  } else {
    state.returnIds.add(entry.returnId);
  }

  // Validate kind/definition compatibility
  if (entry.kind === "combine" && !hasKey(context.combineFuncDefTable, defId)) {
    state.errors.push({
      message: `FuncTable[${funcId}]: kind "combine" must reference CombineFuncDefTable, got ${defId}`,
      details: { funcId, defId, kind: entry.kind },
    });
  }
  if (entry.kind === "pipe" && !hasKey(context.pipeFuncDefTable, defId)) {
    state.errors.push({
      message: `FuncTable[${funcId}]: kind "pipe" must reference PipeFuncDefTable, got ${defId}`,
      details: { funcId, defId, kind: entry.kind },
    });
  }
  if (entry.kind === "cond" && !hasKey(context.condFuncDefTable, defId)) {
    state.errors.push({
      message: `FuncTable[${funcId}]: kind "cond" must reference CondFuncDefTable, got ${defId}`,
      details: { funcId, defId, kind: entry.kind },
    });
  }

  const hasArgMap = "argMap" in entry && isRecord(entry.argMap);
  if ((entry.kind === "combine" || entry.kind === "pipe") && !hasArgMap) {
    state.errors.push({
      message: `FuncTable[${funcId}]: kind "${entry.kind}" requires argMap`,
      details: { funcId, kind: entry.kind },
    });
  }
  if (entry.kind === "cond" && "argMap" in entry && !isRecord(entry.argMap)) {
    state.errors.push({
      message: `FuncTable[${funcId}]: cond argMap must be an object when provided`,
      details: { funcId },
    });
  }

  // Validate argMap
  const argMap = hasArgMap ? (entry.argMap as Record<string, unknown>) : null;
  if (argMap) {
    for (const [argName, argId] of Object.entries(argMap)) {
      if (!isStringAs<ValueId>(argId)) {
        state.errors.push({
          message: `FuncTable[${funcId}].argMap['${argName}']: Argument ID must be a string`,
          details: { funcId, argName, argId },
        });
        continue;
      }
      if (!valueIdExistsInContext(argId, context, state.returnIds)) {
        state.errors.push({
          message: `FuncTable[${funcId}].argMap['${argName}']: Referenced ID ${argId} does not exist`,
          details: { funcId, argName, argId },
        });
      } else {
        // argId is now narrowed to ValueId and validated
        state.referencedValues.add(argId);
      }
    }
  }

  // Type validation for CombineFunc
  if (entry.kind === "combine" && hasKey(context.combineFuncDefTable, defId)) {
    validateCombineFuncTypes(funcId, entry, defId, context, state);
  }
}

/**
 * Validates type safety for a CombineFunc instance.
 */
function validateCombineFuncTypes(
  funcId: string,
  funcEntry: Record<string, unknown>,
  defId: string,
  context: UnvalidatedContext,
  state: ValidationState,
): void {
  const def = context.combineFuncDefTable?.[defId];
  if (!isRecord(def)) return;

  if (!("transformFn" in def) || !isRecord(def.transformFn)) {
    return;
  }

  const transformFn = def.transformFn;
  const argMap =
    "argMap" in funcEntry && isRecord(funcEntry.argMap) ? funcEntry.argMap : {};

  // Validate each argument (Fix 4: transformFn values are strings directly)
  for (const [argName, tfn] of Object.entries(transformFn)) {
    if (!isStringAs<TransformFnNames>(tfn)) {
      continue;
    }

    const transformFnName = tfn;
    const expectedType = getTransformFnInputType(transformFnName);

    const argId = argMap[argName];
    if (!isStringAs<ValueId>(argId)) continue;

    // Get actual type from type environment
    let actualType = state.typeEnv.get(argId);

    // If not in env, try to infer from funcTable
    if (
      !actualType &&
      isStringAs<FuncId>(argId) &&
      funcIdExistsInContext(argId, context)
    ) {
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
 * Validates a CombineFuncDefTable entry.
 */
function validateCombineDefEntry(
  defId: string,
  def: unknown,
  state: ValidationState,
): void {
  if (!isRecord(def)) {
    state.errors.push({
      message: `CombineFuncDefTable[${defId}]: Invalid entry`,
      details: { defId },
    });
    return;
  }

  const entry = def;

  // Validate function name
  if (
    !("name" in entry) ||
    typeof entry.name !== "string" ||
    entry.name.length === 0
  ) {
    state.errors.push({
      message: `CombineFuncDefTable[${defId}]: Invalid or missing function name`,
      details: { defId, name: entry.name },
    });
  } else {
    const binaryReturnType = getBinaryFnReturnType(entry.name as BinaryFnNames);
    if (!binaryReturnType) {
      state.errors.push({
        message: `CombineFuncDefTable[${defId}]: Invalid or unknown binary function "${entry.name}"`,
        details: { defId, binaryFn: entry.name },
      });
    }
  }

  // Validate transform functions
  if (!("transformFn" in entry) || !isRecord(entry.transformFn)) {
    state.errors.push({
      message: `CombineFuncDefTable[${defId}]: Missing transform function definitions`,
      details: { defId },
    });
    return;
  }

  const transformFn = entry.transformFn;

  // Fix 4: transformFn.a and .b are now TransformFnNames strings directly (no { name } wrapper)
  for (const key of ["a", "b"]) {
    if (!(key in transformFn) || typeof transformFn[key] !== "string") {
      state.errors.push({
        message: `CombineFuncDefTable[${defId}]: Missing transform function '${key}'`,
        details: { defId },
      });
      continue;
    }

    const transformFnName = transformFn[key] as string;
    if (!isStringAs<TransformFnNames>(transformFnName)) {
      state.errors.push({
        message: `CombineFuncDefTable[${defId}]: Transform function '${key}' missing name`,
        details: { defId },
      });
      continue;
    }

    const inputType = getTransformFnInputType(transformFnName);
    const returnType = getTransformFnReturnType(transformFnName);

    if (!inputType || !returnType) {
      state.errors.push({
        message: `CombineFuncDefTable[${defId}].transformFn.${key}: Invalid or unknown transform function "${transformFnName}"`,
        details: { defId, transformFn: transformFnName },
      });
    }
  }

  // Validate binary function compatibility
  if (hasNameAndTransformFn(entry)) {
    validateBinaryFnCompatibility(defId, entry.name, transformFn, state);
  }

  // Check if definition is referenced
  if (
    isStringAs<CombineDefineId | PipeDefineId | CondDefineId>(defId) &&
    !state.referencedDefs.has(defId)
  ) {
    state.warnings.push({
      message: `CombineFuncDefTable[${defId}]: Definition is never used`,
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
  state: ValidationState,
): void {
  if (!isStringAs<BinaryFnNames>(binaryFnName)) return;

  const paramTypes = getBinaryFnParamTypes(binaryFnName);
  if (!paramTypes) return;

  const [expectedParamA, expectedParamB] = paramTypes;

  // Check transform 'a' (Fix 4: direct string, no { name } wrapper)
  if ("a" in transformFn && isStringAs<TransformFnNames>(transformFn.a)) {
    const returnType = getTransformFnReturnType(transformFn.a);
    if (returnType && returnType !== expectedParamA) {
      state.errors.push({
        message: `CombineFuncDefTable[${defId}]: Transform function 'a' returns "${returnType}" but binary function "${binaryFnName}" expects "${expectedParamA}" for first parameter`,
        details: {
          defId,
          transformFn: transformFn.a,
          transformReturnType: returnType,
          binaryFn: binaryFnName,
          expectedType: expectedParamA,
        },
      });
    }
  }

  // Check transform 'b' (Fix 4: direct string, no { name } wrapper)
  if ("b" in transformFn && isStringAs<TransformFnNames>(transformFn.b)) {
    const returnType = getTransformFnReturnType(transformFn.b);
    if (returnType && returnType !== expectedParamB) {
      state.errors.push({
        message: `CombineFuncDefTable[${defId}]: Transform function 'b' returns "${returnType}" but binary function "${binaryFnName}" expects "${expectedParamB}" for second parameter`,
        details: {
          defId,
          transformFn: transformFn.b,
          transformReturnType: returnType,
          binaryFn: binaryFnName,
          expectedType: expectedParamB,
        },
      });
    }
  }
}

/**
 * Validates a PipeFuncDefTable entry.
 */
function validatePipeDefEntry(
  defId: string,
  def: unknown,
  context: UnvalidatedContext,
  state: ValidationState,
): void {
  if (!isRecord(def)) {
    state.errors.push({
      message: `PipeFuncDefTable[${defId}]: Invalid entry`,
      details: { defId },
    });
    return;
  }

  const entry = def;

  // Validate sequence exists
  if (!("sequence" in entry) || !Array.isArray(entry.sequence)) {
    state.errors.push({
      message: `PipeFuncDefTable[${defId}]: Missing or invalid sequence`,
      details: { defId },
    });
    return;
  }

  // Check for empty sequence
  if (entry.sequence.length === 0) {
    state.errors.push({
      message: `PipeFuncDefTable[${defId}]: Sequence is empty`,
      details: { defId },
    });
    return;
  }

  const pipeDefArgs = "args" in entry && isRecord(entry.args) ? entry.args : {};

  // Validate each step
  for (let i = 0; i < entry.sequence.length; i++) {
    const step = entry.sequence[i];
    if (!isRecord(step)) {
      state.errors.push({
        message: `PipeFuncDefTable[${defId}].sequence[${String(i)}]: Step must be an object`,
        details: { defId, stepIndex: i },
      });
      continue;
    }

    const stepObj = step;

    // Validate step defId
    if (!("defId" in stepObj) || typeof stepObj.defId !== "string") {
      state.errors.push({
        message: `PipeFuncDefTable[${defId}].sequence[${String(i)}]: Missing step defId`,
        details: { defId, stepIndex: i },
      });
      continue;
    }

    const stepDefId = stepObj.defId;

    // Check if step definition exists and is a valid pipe step type (combine or pipe only)
    const stepDefCheck = pipeStepDefIdExistsInContext(stepDefId, context);
    if (!stepDefCheck.exists) {
      state.errors.push({
        message: `PipeFuncDefTable[${defId}].sequence[${String(i)}]: Referenced definition ${stepDefId} does not exist`,
        details: { defId, stepIndex: i, stepDefId },
      });
      continue;
    }
    if (stepDefCheck.isCondDef) {
      state.errors.push({
        message: `PipeFuncDefTable[${defId}].sequence[${String(i)}]: CondFunc definition ${stepDefId} cannot be used as a pipe step; only combine and pipe definitions are supported`,
        details: { defId, stepIndex: i, stepDefId },
      });
      continue;
    }

    if (!("argBindings" in stepObj) || !isRecord(stepObj.argBindings)) {
      state.errors.push({
        message: `PipeFuncDefTable[${defId}].sequence[${String(i)}]: Missing or invalid argBindings`,
        details: { defId, stepIndex: i },
      });
      continue;
    }

    // Validate argument bindings using dispatch table
    const argBindings = stepObj.argBindings;
    for (const [argName, rawBinding] of Object.entries(argBindings)) {
      const parsed = parseBinding(rawBinding, defId, i, argName);
      if (parsed.error) {
        state.errors.push(parsed.error);
        continue;
      }
      if (!parsed.binding) continue;

      const validationContext: BindingValidationContext = {
        stepIndex: i,
        pipeDefArgs,
        valueTable: context.valueTable || {},
        defId,
        referencedValues: state.referencedValues,
      };

      const error = validateBinding(parsed.binding, argName, validationContext);
      if (error) {
        state.errors.push(error);
      }
    }
  }

  // Check if definition is referenced
  if (
    isStringAs<CombineDefineId | PipeDefineId | CondDefineId>(defId) &&
    !state.referencedDefs.has(defId)
  ) {
    state.warnings.push({
      message: `PipeFuncDefTable[${defId}]: Definition is never used`,
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
  state: ValidationState,
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
  if (!("conditionId" in entry) || !isRecord(entry.conditionId)) {
    state.errors.push({
      message: `CondFuncDefTable[${defId}]: Missing or invalid conditionId`,
      details: { defId },
    });
  } else {
    const conditionId = entry.conditionId;

    if (
      !("source" in conditionId) ||
      typeof conditionId.source !== "string" ||
      !("id" in conditionId) ||
      typeof conditionId.id !== "string"
    ) {
      state.errors.push({
        message: `CondFuncDefTable[${defId}].conditionId: Must include string source and id`,
        details: { defId },
      });
    } else if (
      conditionId.source !== "value" &&
      conditionId.source !== "func"
    ) {
      state.errors.push({
        message: `CondFuncDefTable[${defId}].conditionId: Unknown source "${conditionId.source}"`,
        details: { defId, source: conditionId.source },
      });
    } else if (conditionId.source === "value") {
      const id = conditionId.id;
      if (!valueIdExistsInContext(id, context)) {
        state.errors.push({
          message: `CondFuncDefTable[${defId}].conditionId: Referenced ValueId ${id} does not exist`,
          details: { defId, conditionId: id },
        });
      } else {
        state.referencedValues.add(id);
        const conditionType = state.typeEnv.get(id);
        if (conditionType && conditionType !== "boolean") {
          state.errors.push({
            message: `CondFuncDefTable[${defId}].conditionId: Condition value must be boolean, got "${conditionType}"`,
            details: { defId, conditionId: id, conditionType },
          });
        }
      }
    } else {
      const id = conditionId.id;
      if (!funcIdExistsInContext(id, context)) {
        state.errors.push({
          message: `CondFuncDefTable[${defId}].conditionId: Referenced FuncId ${id} does not exist`,
          details: { defId, conditionId: id },
        });
      } else {
        const inferredType = inferFuncType(id, context);
        if (inferredType && inferredType !== "boolean") {
          state.errors.push({
            message: `CondFuncDefTable[${defId}].conditionId: Function condition must return boolean, got "${inferredType}"`,
            details: { defId, conditionId: id, conditionType: inferredType },
          });
        }
      }
    }
  }

  // Validate branch IDs
  for (const branchKey of ["trueBranchId", "falseBranchId"] as const) {
    if (!(branchKey in entry) || typeof entry[branchKey] !== "string") {
      state.errors.push({
        message: `CondFuncDefTable[${defId}].${branchKey}: Missing or invalid FuncId`,
        details: { defId, branchKey },
      });
      continue;
    }

    const branchId = entry[branchKey];
    if (!funcIdExistsInContext(branchId, context)) {
      state.errors.push({
        message: `CondFuncDefTable[${defId}].${branchKey}: Referenced FuncId ${branchId} does not exist`,
        details: { defId, [branchKey]: branchId },
      });
    }
  }

  // Check if definition is referenced
  if (
    isStringAs<CombineDefineId | PipeDefineId | CondDefineId>(defId) &&
    !state.referencedDefs.has(defId)
  ) {
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
  state: ValidationState,
): void {
  if (!isRecord(context.valueTable)) return;

  for (const valueId of Object.keys(context.valueTable)) {
    if (isStringAs<ValueId>(valueId) && !state.referencedValues.has(valueId)) {
      state.warnings.push({
        message: `ValueTable[${valueId}]: Value is never referenced`,
        details: { valueId },
      });
    }
  }
}

/**
 * Pre-collects all function return IDs to make argMap reference validation order-independent.
 */
function collectReturnIds(
  context: UnvalidatedContext,
  state: ValidationState,
): void {
  if (!isRecord(context.funcTable)) return;

  for (const funcEntry of Object.values(context.funcTable)) {
    if (
      isRecord(funcEntry) &&
      "returnId" in funcEntry &&
      isStringAs<ValueId>(funcEntry.returnId)
    ) {
      state.returnIds.add(funcEntry.returnId);
    }
  }
}

/**
 * Detects cycles in FuncTable dependencies (argMap producers + Cond branches/conditions).
 */
function checkFunctionCycles(
  context: UnvalidatedContext,
  state: ValidationState,
): void {
  if (!isRecord(context.funcTable)) return;

  const returnIdToFuncId = new Map<string, string>();
  for (const [funcId, funcEntry] of Object.entries(context.funcTable)) {
    if (
      isRecord(funcEntry) &&
      "returnId" in funcEntry &&
      typeof funcEntry.returnId === "string"
    ) {
      returnIdToFuncId.set(funcEntry.returnId, funcId);
    }
  }

  const deps = new Map<string, Set<string>>();

  for (const [funcId, funcEntry] of Object.entries(context.funcTable)) {
    if (!isRecord(funcEntry)) continue;
    const funcDeps = new Set<string>();

    if ("argMap" in funcEntry && isRecord(funcEntry.argMap)) {
      for (const argId of Object.values(funcEntry.argMap)) {
        if (typeof argId !== "string") continue;
        const producer = returnIdToFuncId.get(argId);
        if (producer) funcDeps.add(producer);
      }
    }

    if (
      "defId" in funcEntry &&
      typeof funcEntry.defId === "string" &&
      hasKey(context.condFuncDefTable, funcEntry.defId)
    ) {
      const condDef = context.condFuncDefTable?.[funcEntry.defId];
      if (isRecord(condDef)) {
        if (
          "conditionId" in condDef &&
          isRecord(condDef.conditionId) &&
          "source" in condDef.conditionId &&
          condDef.conditionId.source === "func" &&
          "id" in condDef.conditionId &&
          typeof condDef.conditionId.id === "string"
        ) {
          funcDeps.add(condDef.conditionId.id);
        }
        if (
          "trueBranchId" in condDef &&
          typeof condDef.trueBranchId === "string"
        ) {
          funcDeps.add(condDef.trueBranchId);
        }
        if (
          "falseBranchId" in condDef &&
          typeof condDef.falseBranchId === "string"
        ) {
          funcDeps.add(condDef.falseBranchId);
        }
      }
    }

    deps.set(funcId, funcDeps);
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const stack: string[] = [];
  const reported = new Set<string>();

  const reportCycle = (cyclePath: string[]): void => {
    const key = cyclePath.join(" -> ");
    if (reported.has(key)) return;
    reported.add(key);
    state.errors.push({
      message: `FuncTable: Cycle detected ${key}`,
      details: { cycle: cyclePath },
    });
  };

  const dfs = (funcId: string): void => {
    if (visited.has(funcId)) return;
    if (visiting.has(funcId)) {
      const start = stack.indexOf(funcId);
      const cycle =
        start >= 0 ? [...stack.slice(start), funcId] : [funcId, funcId];
      reportCycle(cycle);
      return;
    }

    visiting.add(funcId);
    stack.push(funcId);

    const funcDeps = deps.get(funcId);
    if (funcDeps) {
      for (const dep of funcDeps) {
        if (deps.has(dep)) dfs(dep);
      }
    }

    stack.pop();
    visiting.delete(funcId);
    visited.add(funcId);
  };

  for (const funcId of deps.keys()) {
    dfs(funcId);
  }
}

/**
 * Detects recursive Pipe definition graphs such as td1 -> td1 or td1 -> td2 -> td1.
 */
function checkPipeDefinitionCycles(
  context: UnvalidatedContext,
  state: ValidationState,
): void {
  if (!isRecord(context.pipeFuncDefTable)) return;

  const deps = new Map<string, Set<string>>();
  for (const [defId, def] of Object.entries(context.pipeFuncDefTable)) {
    const defDeps = new Set<string>();
    if (isRecord(def) && "sequence" in def && Array.isArray(def.sequence)) {
      for (const step of def.sequence) {
        if (
          !isRecord(step) ||
          !("defId" in step) ||
          typeof step.defId !== "string"
        )
          continue;
        if (hasKey(context.pipeFuncDefTable, step.defId)) {
          defDeps.add(step.defId);
        }
      }
    }
    deps.set(defId, defDeps);
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const stack: string[] = [];
  const reported = new Set<string>();

  const reportCycle = (cyclePath: string[]): void => {
    const key = cyclePath.join(" -> ");
    if (reported.has(key)) return;
    reported.add(key);
    state.errors.push({
      message: `PipeFuncDefTable: Cycle detected ${key}`,
      details: { cycle: cyclePath },
    });
  };

  const dfs = (defId: string): void => {
    if (visited.has(defId)) return;
    if (visiting.has(defId)) {
      const start = stack.indexOf(defId);
      const cycle =
        start >= 0 ? [...stack.slice(start), defId] : [defId, defId];
      reportCycle(cycle);
      return;
    }

    visiting.add(defId);
    stack.push(defId);

    const defDeps = deps.get(defId);
    if (defDeps) {
      for (const dep of defDeps) {
        if (deps.has(dep)) dfs(dep);
      }
    }

    stack.pop();
    visiting.delete(defId);
    visited.add(defId);
  };

  for (const defId of deps.keys()) {
    dfs(defId);
  }
}

/**
 * Main validation function - single-pass algorithm with state accumulation.
 *
 * This consolidates all validation into a single traversal of the context,
 * accumulating errors, warnings, and metadata in a shared state object.
 */
/**
 * Checks that all required execution tables are present in the context.
 * Pushes one error per missing table. Called before any semantic validation.
 */
function checkRequiredTables(
  context: UnvalidatedContext,
  state: ValidationState,
): context is ExecutionContext {
  const required = [
    "valueTable",
    "funcTable",
    "combineFuncDefTable",
    "pipeFuncDefTable",
    "condFuncDefTable",
  ] as const;

  let hasAllRequiredTables = true;

  for (const tableName of required) {
    const table = context[tableName];
    if (table === undefined) {
      hasAllRequiredTables = false;
      state.errors.push({
        message: `ExecutionContext is missing required table: ${tableName}`,
        details: { tableName },
      });
      continue;
    }
    if (!isRecord(table)) {
      hasAllRequiredTables = false;
      state.errors.push({
        message: `ExecutionContext table ${tableName} must be an object`,
        details: { tableName, actualType: typeof table },
      });
    }
  }

  return hasAllRequiredTables;
}

export function validateContext(context: UnvalidatedContext): ValidationResult {
  const state = createValidationState();

  // Structural pre-check: all tables must be present before semantic validation
  const hasAllRequiredTables = checkRequiredTables(context, state);
  if (!hasAllRequiredTables || state.errors.length > 0) {
    return {
      valid: false,
      errors: state.errors,
      warnings: state.warnings,
    };
  }

  // Build initial type environment from values
  const initialTypeEnv = buildTypeEnvironment(context);
  for (const [id, type] of initialTypeEnv) {
    state.typeEnv.set(id, type);
  }

  // Pre-collect return IDs to make function output references order-independent
  collectReturnIds(context, state);

  // Single pass over funcTable - validates structure and types
  if (context.funcTable) {
    for (const [funcId, funcEntry] of Object.entries(context.funcTable)) {
      validateFuncEntry(funcId, funcEntry, context, state);
    }
  }

  // Single pass over combineFuncDefTable - validates structure and checks usage
  if (context.combineFuncDefTable) {
    for (const [defId, def] of Object.entries(context.combineFuncDefTable)) {
      validateCombineDefEntry(defId, def, state);
    }
  }

  // Single pass over pipeFuncDefTable - validates structure and checks usage
  if (context.pipeFuncDefTable) {
    for (const [defId, def] of Object.entries(context.pipeFuncDefTable)) {
      validatePipeDefEntry(defId, def, context, state);
    }
  }

  // Single pass over condFuncDefTable - validates structure and checks usage
  if (context.condFuncDefTable) {
    for (const [defId, def] of Object.entries(context.condFuncDefTable)) {
      validateCondDefEntry(defId, def, context, state);
    }
  }

  // Detect dependency cycles before execution.
  checkFunctionCycles(context, state);
  checkPipeDefinitionCycles(context, state);

  // Check for unreferenced values (warnings only)
  checkUnreferencedValues(context, state);

  // Return discriminated union result
  if (state.errors.length === 0) {
    return {
      valid: true,
      context: createValidatedContext(context),
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
 * Validates context and throws an error if invalid, otherwise returns the ValidatedContext.
 * Use the return value to get a type-safe ValidatedContext for passing to executeGraph.
 */
export function assertValidContext(
  context: UnvalidatedContext,
): ValidatedContext {
  const result = validateContext(context);

  if (!result.valid) {
    const errorMessages = result.errors
      .map((err) => `  - ${err.message}`)
      .join("\n");

    throw new Error(`ExecutionContext validation failed:\n${errorMessages}`);
  }

  return result.context;
}

/**
 * Type guard to check if an unvalidated context is a ValidatedContext.
 * After this returns true, the context is narrowed to ValidatedContext and can be
 * passed directly to executeGraph.
 */
export function isValidContext(
  context: UnvalidatedContext,
): context is ValidatedContext {
  const result = validateContext(context);
  return result.valid;
}

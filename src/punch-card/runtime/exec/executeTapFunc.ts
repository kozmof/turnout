import {
  FuncId,
  TapDefineId,
  ExecutionContext,
  ValueTable,
  ValueId,
  TapStepBinding,
  TapArgBinding,
} from '../../types';
import {
  createEmptySequenceError,
  createMissingValueError,
  createFunctionExecutionError,
} from '../errors';
import { executePlugFunc, type ExecutionResult } from './executePlugFunc';
import {
  isValidValueId,
  isValidFuncId,
  isValidStepDefId,
  isPlugDefineId,
  isTapDefineId,
  isCondDefineId,
  createValueId,
  createFuncId,
} from '../../idValidation';

export function validateScopedValueTable(
  scopedValueTable: Partial<ValueTable>,
  tapDefArgs: Record<string, unknown>,
  argMap: { [argName: string]: ValueId }
): asserts scopedValueTable is ValueTable {
  // Verify that all expected arguments are present in the scoped table
  const expectedValueIds = Object.keys(tapDefArgs).map(
    argName => argMap[argName]
  );

  for (const valueId of expectedValueIds) {
    if (!(valueId in scopedValueTable)) {
      throw new Error(
        `Scoped value table is incomplete: missing ${valueId}`
      );
    }
  }
}

export function createScopedValueTable(
  argMap: { [argName: string]: ValueId },
  tapDefArgs: Record<string, unknown>,
  sourceValueTable: ValueTable
): ValueTable {
  const scopedValueTable: Partial<ValueTable> = {};

  for (const argName of Object.keys(tapDefArgs)) {
    if (!(argName in argMap)) {
      throw new Error(`Argument ${argName} is missing from argMap`);
    }

    const valueId = argMap[argName];

    const value = sourceValueTable[valueId];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (value === undefined) {
      throw createMissingValueError(valueId);
    }

    scopedValueTable[valueId] = value;
  }

  // Validate before returning
  validateScopedValueTable(scopedValueTable, tapDefArgs, argMap);

  return scopedValueTable;
}

export function createScopedContext(
  context: ExecutionContext,
  scopedValueTable: ValueTable
): ExecutionContext {
  return {
    ...context,
    valueTable: scopedValueTable,
  };
}

/**
 * Resolves a TapArgBinding to a concrete ValueId.
 * This determines which value should be used for a step's argument.
 */
function resolveArgBinding(
  binding: TapArgBinding,
  tapFuncArgMap: { [argName: string]: ValueId },
  stepResults: ValueId[]
): ValueId {
  switch (binding.source) {
    case 'input': {
      // Reference to TapFunc's input argument
      const inputValueId = tapFuncArgMap[binding.argName];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (inputValueId === undefined) {
        throw new Error(
          `TapFunc input argument '${binding.argName}' not found in argMap`
        );
      }
      return inputValueId;
    }

    case 'step': {
      // Reference to a previous step's result
      if (binding.stepIndex < 0 || binding.stepIndex >= stepResults.length) {
        throw new Error(
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          `Invalid step reference: stepIndex ${binding.stepIndex} out of bounds (have ${stepResults.length} results)`
        );
      }
      return stepResults[binding.stepIndex];
    }

    case 'value':
      // Direct value reference
      return binding.valueId;

    default: {
      // Exhaustiveness check
      const _exhaustive: never = binding;
      throw new Error(`Unknown binding source: ${String(_exhaustive)}`);
    }
  }
}


/**
 * Creates a temporary FuncId for executing a step within a TapFunc.
 * This is an internal implementation detail.
 */
function createTempFuncId(
  tapFuncId: FuncId,
  stepIndex: number
): FuncId {
  const id = `${tapFuncId}__step${String(stepIndex)}`;
  // Validate the constructed ID using centralized validator
  if (!isValidFuncId(id)) {
    throw new Error(`Invalid temporary FuncId: ${id}`);
  }
  return createFuncId(id);
}

/**
 * Executes a single step in the TapFunc sequence.
 * Creates a temporary function instance and executes it.
 * Returns the step result ID and updated value table.
 */
function executeStep(
  step: TapStepBinding,
  stepIndex: number,
  tapFuncId: FuncId,
  tapFuncArgMap: { [argName: string]: ValueId },
  stepResults: ValueId[],
  scopedContext: ExecutionContext
): { stepReturnId: ValueId; updatedValueTable: ValueTable } {
  const { defId, argBindings } = step;

  // Resolve all argument bindings to concrete ValueIds
  const resolvedArgMap: { [argName: string]: ValueId } = {};
  for (const [argName, binding] of Object.entries(argBindings)) {
    resolvedArgMap[argName] = resolveArgBinding(
      binding,
      tapFuncArgMap,
      stepResults
    );
  }

  // Create a return ValueId for this step
  const stepReturnIdStr = `${tapFuncId}__step${String(stepIndex)}__result`;
  if (!isValidValueId(stepReturnIdStr)) {
    throw new Error('Invalid ValueId for step return');
  }
  const stepReturnId = createValueId(stepReturnIdStr);

  // Create a temporary FuncId for this step execution
  const tempFuncId = createTempFuncId(tapFuncId, stepIndex);

  // Validate and narrow defId type using centralized validator
  if (!isValidStepDefId(defId)) {
    throw new Error(`Invalid step defId: ${defId}`);
  }

  // Create context with temporary function entry
  const stepContext: ExecutionContext = {
    ...scopedContext,
    funcTable: {
      ...scopedContext.funcTable,
      [tempFuncId]: {
        defId,
        argMap: resolvedArgMap,
        returnId: stepReturnId,
      },
    },
  };

  // Execute based on definition type and get result
  let execResult: ExecutionResult;

  if (isPlugDefineId(defId, scopedContext.plugFuncDefTable)) {
    execResult = executePlugFunc(
      tempFuncId,
      defId,
      stepContext
    );
  } else if (isTapDefineId(defId, scopedContext.tapFuncDefTable)) {
    // Recursive TapFunc execution
    execResult = executeTapFunc(
      tempFuncId,
      defId,
      stepContext
    );
  } else if (isCondDefineId(defId, scopedContext.condFuncDefTable)) {
    throw new Error(
      `CondFunc execution within TapFunc is not yet implemented. Step ${String(stepIndex)} references ${String(defId)}`
    );
  } else {
    throw createFunctionExecutionError(
      tempFuncId,
      `Unknown definition type: ${String(defId)}`
    );
  }

  return {
    stepReturnId,
    updatedValueTable: execResult.updatedValueTable,
  };
}

/**
 * Executes a TapFunc and returns the result along with updated state.
 * This is a pure function - it does not mutate the input context.
 *
 * @param funcId - The function instance to execute
 * @param defId - The function definition ID
 * @param context - The execution context (read-only)
 * @returns Execution result with computed value and updated value table
 */
export function executeTapFunc(
  funcId: FuncId,
  defId: TapDefineId,
  context: ExecutionContext
): ExecutionResult {
  const funcEntry = context.funcTable[funcId];
  const def = context.tapFuncDefTable[defId];

  if (def.sequence.length === 0) {
    throw createEmptySequenceError(funcId);
  }

  // Create scoped value table with TapFunc's input arguments
  const scopedValueTable = createScopedValueTable(
    funcEntry.argMap,
    def.args,
    context.valueTable
  );

  // Start with scoped context - we'll thread state through steps
  let currentValueTable = scopedValueTable;
  let scopedContext = createScopedContext(context, currentValueTable);

  // Track return ValueIds from each step
  const stepResults: ValueId[] = [];

  // Execute each step in sequence, threading state through
  for (let i = 0; i < def.sequence.length; i++) {
    const step = def.sequence[i];

    // Execute step with current state
    const stepResult = executeStep(
      step,
      i,
      funcId,
      funcEntry.argMap,
      stepResults,
      scopedContext
    );

    // Update current state for next step
    currentValueTable = stepResult.updatedValueTable;
    scopedContext = createScopedContext(context, currentValueTable);

    // Add step result for subsequent steps to reference
    stepResults.push(stepResult.stepReturnId);
  }

  // Return the last step's result (TapFunc semantics)
  const finalResultId = stepResults[stepResults.length - 1];
  const finalResult = currentValueTable[finalResultId];

  // Return result with updated value table (immutable update to main context)
  return {
    value: finalResult,
    updatedValueTable: {
      ...context.valueTable,
      [funcEntry.returnId]: finalResult,
    },
  };
}

import {
  FuncId,
  TapDefineId,
  ExecutionContext,
  ValueTable,
  ValueId,
  TapStepBinding,
  TapArgBinding,
  PlugDefineId,
} from '../../types';
import {
  createEmptySequenceError,
  createMissingValueError,
  createFunctionExecutionError,
} from '../errors';
import { isPlugDefineId, isTapDefineId, isCondDefineId } from '../../typeGuards';
import { executePlugFunc } from './executePlugFunc';

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

    default:
      // Exhaustiveness check
      const _exhaustive: never = binding;
      throw new Error(`Unknown binding source: ${(_exhaustive as any).source}`);
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
  return `${tapFuncId}__step${stepIndex}` as FuncId;
}

/**
 * Executes a single step in the TapFunc sequence.
 * Creates a temporary function instance and executes it.
 */
function executeStep(
  step: TapStepBinding,
  stepIndex: number,
  tapFuncId: FuncId,
  tapFuncArgMap: { [argName: string]: ValueId },
  stepResults: ValueId[],
  scopedContext: ExecutionContext
): ValueId {
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
  const stepReturnId = `${tapFuncId}__step${stepIndex}__result` as ValueId;

  // Create a temporary FuncId for this step execution
  const tempFuncId = createTempFuncId(tapFuncId, stepIndex);

  // Execute based on definition type
  if (isPlugDefineId(defId, scopedContext.plugFuncDefTable)) {
    executePlugFunc(
      tempFuncId,
      defId as PlugDefineId,
      {
        ...scopedContext,
        funcTable: {
          ...scopedContext.funcTable,
          [tempFuncId]: {
            defId: defId as PlugDefineId,
            argMap: resolvedArgMap,
            returnId: stepReturnId,
          },
        },
      }
    );
  } else if (isTapDefineId(defId, scopedContext.tapFuncDefTable)) {
    // Recursive TapFunc execution
    executeTapFunc(
      tempFuncId,
      defId as TapDefineId,
      {
        ...scopedContext,
        funcTable: {
          ...scopedContext.funcTable,
          [tempFuncId]: {
            defId: defId as TapDefineId,
            argMap: resolvedArgMap,
            returnId: stepReturnId,
          },
        },
      }
    );
  } else if (isCondDefineId(defId, scopedContext.condFuncDefTable)) {
    throw new Error(
      `CondFunc execution within TapFunc is not yet implemented. Step ${stepIndex} references ${defId}`
    );
  } else {
    throw createFunctionExecutionError(
      tempFuncId,
      `Unknown definition type: ${defId}`
    );
  }

  return stepReturnId;
}

export function executeTapFunc(
  funcId: FuncId,
  defId: TapDefineId,
  context: ExecutionContext
): void {
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

  const scopedContext = createScopedContext(context, scopedValueTable);

  // Track return ValueIds from each step
  const stepResults: ValueId[] = [];

  // Execute each step in sequence
  for (let i = 0; i < def.sequence.length; i++) {
    const step = def.sequence[i];

    const stepReturnId = executeStep(
      step,
      i,
      funcId,
      funcEntry.argMap,
      stepResults,
      scopedContext
    );

    // Add step result to scoped context for subsequent steps
    const stepResultValue = scopedContext.valueTable[stepReturnId];
    if (stepResultValue === undefined) {
      throw createMissingValueError(stepReturnId);
    }

    stepResults.push(stepReturnId);
  }

  // Return the last step's result (TapFunc semantics)
  const finalResultId = stepResults[stepResults.length - 1];
  const finalResult = scopedContext.valueTable[finalResultId];

  if (finalResult === undefined) {
    throw createMissingValueError(finalResultId);
  }

  // Store result in the main ValueTable
  context.valueTable[funcEntry.returnId] = finalResult;
}

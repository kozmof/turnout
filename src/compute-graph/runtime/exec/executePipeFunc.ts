import {
  FuncId,
  PipeDefineId,
  ExecutionContext,
  ExecutionResult,
  ScopedExecutionContext,
  ValueTable,
  ValueId,
  PipeStepBinding,
  PipeArgBinding,
} from '../../types';
import {
  createEmptySequenceError,
  createMissingValueError,
  createFunctionExecutionError,
} from '../errors';
import { executeCombineFunc } from './executeCombineFunc';
import {
  isCombineDefineId,
  isPipeDefineId,
  createValueId,
  createFuncId,
} from '../../idValidation';

export function validateScopedValueTable(
  scopedValueTable: Partial<ValueTable>,
  pipeDefArgs: Record<string, unknown>,
  argMap: { [argName: string]: ValueId }
): asserts scopedValueTable is ValueTable {
  // Verify that all expected arguments are present in the scoped table
  const expectedValueIds = Object.keys(pipeDefArgs).map(
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
  pipeDefArgs: Record<string, unknown>,
  sourceValueTable: ValueTable
): ValueTable {
  const scopedValueTable: Partial<ValueTable> = {};

  for (const argName of Object.keys(pipeDefArgs)) {
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
  validateScopedValueTable(scopedValueTable, pipeDefArgs, argMap);

  return scopedValueTable;
}

export function createScopedContext(
  context: ExecutionContext | ScopedExecutionContext,
  scopedValueTable: ValueTable
): ScopedExecutionContext {
  const visibleValueIds = new Set<ValueId>();
  for (const valueId of Object.keys(scopedValueTable)) {
    visibleValueIds.add(createValueId(valueId));
  }

  return {
    valueTable: scopedValueTable,
    funcTable: context.funcTable,
    combineFuncDefTable: context.combineFuncDefTable,
    pipeFuncDefTable: context.pipeFuncDefTable,
    condFuncDefTable: context.condFuncDefTable,
    scope: 'pipe',
    visibleValueIds,
  };
}

/**
 * Resolves a PipeArgBinding to a concrete ValueId.
 * This determines which value should be used for a step's argument.
 */
function resolveArgBinding(
  binding: PipeArgBinding,
  pipeFuncArgMap: { [argName: string]: ValueId },
  stepResults: readonly ValueId[]
): ValueId {
  switch (binding.source) {
    case 'input': {
      // Reference to PipeFunc's input argument
      const inputValueId = pipeFuncArgMap[binding.argName];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (inputValueId === undefined) {
        throw new Error(
          `PipeFunc input argument '${binding.argName}' not found in argMap`
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
      // Direct value reference (Fix 3: renamed from valueId to id)
      return binding.id;

    default: {
      // Exhaustiveness check
      const _exhaustive: never = binding;
      throw new Error(`Unknown binding source: ${String(_exhaustive)}`);
    }
  }
}


/**
 * Creates a temporary FuncId for executing a step within a PipeFunc.
 * This is an internal implementation detail.
 */
function createTempFuncId(
  pipeFuncId: FuncId,
  stepIndex: number
): FuncId {
  const id = `${pipeFuncId}__step${String(stepIndex)}`;
  return createFuncId(id);
}

/**
 * Executes a single step in the PipeFunc sequence.
 * Creates a temporary function instance and executes it.
 * Returns the step result ID and updated value table.
 */
function executeStep(
  step: PipeStepBinding,
  stepIndex: number,
  pipeFuncId: FuncId,
  pipeFuncArgMap: { [argName: string]: ValueId },
  stepResults: readonly ValueId[],
  scopedContext: ScopedExecutionContext
): { stepReturnId: ValueId; updatedValueTable: ValueTable } {
  const { defId, argBindings } = step;

  // Resolve all argument bindings to concrete ValueIds
  const resolvedArgMap: { [argName: string]: ValueId } = {};
  for (const [argName, binding] of Object.entries(argBindings)) {
    resolvedArgMap[argName] = resolveArgBinding(
      binding,
      pipeFuncArgMap,
      stepResults
    );
  }

  // Create a return ValueId for this step
  const stepReturnIdStr = `${pipeFuncId}__step${String(stepIndex)}__result`;
  const stepReturnId = createValueId(stepReturnIdStr);

  // Create a temporary FuncId for this step execution
  const tempFuncId = createTempFuncId(pipeFuncId, stepIndex);

  // Create context with temporary function entry (Fix 2: include kind discriminant)
  let stepContext: ExecutionContext;
  if (isCombineDefineId(defId, scopedContext.combineFuncDefTable)) {
    stepContext = {
      valueTable: scopedContext.valueTable,
      combineFuncDefTable: scopedContext.combineFuncDefTable,
      pipeFuncDefTable: scopedContext.pipeFuncDefTable,
      condFuncDefTable: scopedContext.condFuncDefTable,
      funcTable: {
        ...scopedContext.funcTable,
        [tempFuncId]: { kind: 'combine', defId, argMap: resolvedArgMap, returnId: stepReturnId },
      },
    };
  } else {
    stepContext = {
      valueTable: scopedContext.valueTable,
      combineFuncDefTable: scopedContext.combineFuncDefTable,
      pipeFuncDefTable: scopedContext.pipeFuncDefTable,
      condFuncDefTable: scopedContext.condFuncDefTable,
      funcTable: {
        ...scopedContext.funcTable,
        [tempFuncId]: { kind: 'pipe', defId, argMap: resolvedArgMap, returnId: stepReturnId },
      },
    };
  }

  // Execute based on definition type and get result
  let execResult: ExecutionResult;

  if (isCombineDefineId(defId, scopedContext.combineFuncDefTable)) {
    execResult = executeCombineFunc(
      tempFuncId,
      defId,
      stepContext
    );
  } else if (isPipeDefineId(defId, scopedContext.pipeFuncDefTable)) {
    // Recursive PipeFunc execution
    execResult = executePipeFunc(
      tempFuncId,
      defId,
      stepContext
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
 * Executes a PipeFunc and returns the result along with updated state.
 * This is a pure function - it does not mutate the input context.
 *
 * @param funcId - The function instance to execute
 * @param defId - The function definition ID
 * @param context - The execution context (read-only)
 * @returns Execution result with computed value and updated value table
 */
export function executePipeFunc(
  funcId: FuncId,
  defId: PipeDefineId,
  context: ExecutionContext
): ExecutionResult {
  const funcEntry = context.funcTable[funcId];
  if (funcEntry.kind === 'cond') {
    throw new Error(`executePipeFunc called with cond entry for ${funcId}`);
  }
  const def = context.pipeFuncDefTable[defId];

  if (def.sequence.length === 0) {
    throw createEmptySequenceError(funcId);
  }

  // Create scoped value table with PipeFunc's input arguments
  const scopedValueTable = createScopedValueTable(
    funcEntry.argMap,
    def.args,
    context.valueTable
  );

  type PipeStepAccumulator = {
    readonly currentValueTable: ValueTable;
    readonly scopedContext: ScopedExecutionContext;
    readonly stepResults: readonly ValueId[];
  };

  // Execute each step in sequence, threading state through via reduce
  const { currentValueTable, stepResults } = def.sequence.reduce<PipeStepAccumulator>(
    ({ currentValueTable, scopedContext, stepResults }, step, i) => {
      const stepResult = executeStep(
        step,
        i,
        funcId,
        funcEntry.argMap,
        stepResults,
        scopedContext
      );
      const nextTable = stepResult.updatedValueTable;
      return {
        currentValueTable: nextTable,
        scopedContext: createScopedContext(scopedContext, nextTable),
        stepResults: [...stepResults, stepResult.stepReturnId],
      };
    },
    {
      currentValueTable: scopedValueTable,
      scopedContext: createScopedContext(context, scopedValueTable),
      stepResults: [],
    }
  );

  // Return the last step's result (PipeFunc semantics)
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

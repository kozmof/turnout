import {
  FuncId,
  FuncArgMap,
  ArgName,
  PipeDefineId,
  ExecutionContext,
  ExecutionResult,
  ScopedExecutionContext,
  ValueTable,
  ValueId,
  PipeStepBinding,
  PipeArgBinding,
  PipeFuncDefTable,
  isArgMapEntry,
} from "../../types.js";
import {
  createEmptySequenceError,
  createMissingValueError,
  createFunctionExecutionError,
} from "../errors.js";
import { executeCombineFunc } from "./executeCombineFunc.js";
import {
  isCombineDefineId,
  isPipeDefineId,
  createValueId,
  createFuncId,
  createArgName,
} from "../../idValidation.js";

type PipeArgSpec = readonly string[] | Record<string, unknown>;

function getPipeArgNames(pipeArgSpec: PipeArgSpec): string[] {
  if (Array.isArray(pipeArgSpec)) {
    return pipeArgSpec.filter((argName): argName is string => typeof argName === "string");
  }
  return Object.keys(pipeArgSpec);
}

export function validateScopedValueTable(
  scopedValueTable: Partial<ValueTable>,
  pipeDefArgs: PipeArgSpec,
  argMap: FuncArgMap,
  extraValueIds: readonly ValueId[] = [],
): asserts scopedValueTable is ValueTable {
  // Verify that all expected arguments are present in the scoped table
  const expectedValueIds = [
    ...getPipeArgNames(pipeDefArgs).map((argName) => argMap[createArgName(argName)]),
    ...extraValueIds,
  ];

  for (const valueId of expectedValueIds) {
    if (valueId === undefined || !(valueId in scopedValueTable)) {
      throw new Error(`Scoped value table is incomplete: missing ${valueId}`);
    }
  }
}

export function createScopedValueTable(
  argMap: FuncArgMap,
  pipeDefArgs: PipeArgSpec,
  sourceValueTable: ValueTable,
  extraValueIds: readonly ValueId[] = [],
): ValueTable {
  const scopedValueTable: Partial<ValueTable> = {};

  for (const argName of getPipeArgNames(pipeDefArgs)) {
    if (!(argName in argMap)) {
      throw new Error(`Argument ${argName} is missing from argMap`);
    }

    const valueId = argMap[createArgName(argName)];
    if (valueId === undefined) {
      throw new Error(`Argument ${argName} is missing from argMap`);
    }

    const value = sourceValueTable[valueId];
    if (value === undefined) {
      throw createMissingValueError(valueId);
    }

    scopedValueTable[valueId] = value;
  }

  for (const valueId of extraValueIds) {
    const value = sourceValueTable[valueId];
    if (value === undefined) {
      throw createMissingValueError(valueId);
    }
    scopedValueTable[valueId] = value;
  }

  // Validate before returning
  validateScopedValueTable(scopedValueTable, pipeDefArgs, argMap, extraValueIds);

  return scopedValueTable;
}

export function createScopedContext(
  context: ExecutionContext | ScopedExecutionContext,
  scopedValueTable: ValueTable,
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
    scope: "pipe",
    visibleValueIds,
  };
}

/**
 * Resolves a PipeArgBinding to a concrete ValueId.
 * This determines which value should be used for a step's argument.
 */
function resolveArgBinding(
  binding: PipeArgBinding,
  pipeFuncArgMap: FuncArgMap,
  stepResults: readonly ValueId[],
): ValueId {
  switch (binding.source) {
    case "input": {
      // Reference to PipeFunc's input argument
      const inputValueId = pipeFuncArgMap[binding.argName];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (inputValueId === undefined) {
        throw new Error(`PipeFunc input argument '${binding.argName}' not found in argMap`);
      }
      return inputValueId;
    }

    case "step": {
      // Reference to a previous step's result
      if (binding.stepIndex < 0 || binding.stepIndex >= stepResults.length) {
        throw new Error(
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          `Invalid step reference: stepIndex ${binding.stepIndex} out of bounds (have ${stepResults.length} results)`,
        );
      }
      return stepResults[binding.stepIndex]!;
    }

    case "value":
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
 * Collects direct value bindings that must remain visible inside pipe-local execution.
 */
function collectPipeValueBindings(
  defId: PipeDefineId,
  pipeFuncDefTable: Readonly<PipeFuncDefTable>,
  visited: ReadonlySet<PipeDefineId> = new Set(),
): ValueId[] {
  if (visited.has(defId)) return [];
  const def = pipeFuncDefTable[defId];
  if (def === undefined) return [];

  const nextVisited = new Set(visited);
  nextVisited.add(defId);
  const valueIds: ValueId[] = [];

  for (const step of def.sequence) {
    for (const binding of Object.values(step.argBindings)) {
      if (binding.source === "value") {
        valueIds.push(binding.id);
      }
    }

    if (isPipeDefineId(step.defId, pipeFuncDefTable)) {
      valueIds.push(...collectPipeValueBindings(step.defId, pipeFuncDefTable, nextVisited));
    }
  }

  return [...new Set(valueIds)];
}

/**
 * Creates a temporary FuncId for executing a step within a PipeFunc.
 * This is an internal implementation detail.
 */
function createTempFuncId(pipeFuncId: FuncId, stepIndex: number): FuncId {
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
  pipeFuncArgMap: FuncArgMap,
  stepResults: readonly ValueId[],
  scopedContext: ScopedExecutionContext,
): { stepReturnId: ValueId; updatedValueTable: ValueTable } {
  const { defId, argBindings } = step;

  // Resolve all argument bindings to concrete ValueIds
  const resolvedArgMap: Record<ArgName, ValueId> = {} as Record<ArgName, ValueId>;
  for (const [argName, binding] of Object.entries(argBindings)) {
    resolvedArgMap[createArgName(argName)] = resolveArgBinding(
      binding,
      pipeFuncArgMap,
      stepResults,
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
        [tempFuncId]: {
          kind: "combine",
          defId,
          argMap: resolvedArgMap as FuncArgMap,
          returnId: stepReturnId,
        },
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
        [tempFuncId]: {
          kind: "pipe",
          defId,
          argMap: resolvedArgMap as FuncArgMap,
          returnId: stepReturnId,
        },
      },
    };
  }

  // Execute based on definition type and get result
  let execResult: ExecutionResult;

  if (isCombineDefineId(defId, scopedContext.combineFuncDefTable)) {
    execResult = executeCombineFunc(tempFuncId, defId, stepContext);
  } else if (isPipeDefineId(defId, scopedContext.pipeFuncDefTable)) {
    // Recursive PipeFunc execution
    execResult = executePipeFunc(tempFuncId, defId, stepContext);
  } else {
    throw createFunctionExecutionError(tempFuncId, `Unknown definition type: ${String(defId)}`);
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
  context: ExecutionContext,
): ExecutionResult {
  const funcEntry = context.funcTable[funcId];
  if (funcEntry === undefined || !isArgMapEntry(funcEntry)) {
    throw new Error(`executePipeFunc called with cond entry for ${funcId}`);
  }
  const def = context.pipeFuncDefTable[defId];
  if (def === undefined) {
    throw new Error(`executePipeFunc: missing pipe definition ${defId}`);
  }

  if (def.sequence.length === 0) {
    throw createEmptySequenceError(funcId);
  }

  // Create scoped value table with PipeFunc's input arguments and literal value bindings.
  const scopedValueTable = createScopedValueTable(
    funcEntry.argMap,
    def.args,
    context.valueTable,
    collectPipeValueBindings(defId, context.pipeFuncDefTable),
  );

  type PipeStepAccumulator = {
    readonly currentValueTable: ValueTable;
    readonly scopedContext: ScopedExecutionContext;
    readonly stepResults: readonly ValueId[];
  };

  // Execute each step in sequence, threading state through via reduce
  const { currentValueTable, stepResults } = def.sequence.reduce<PipeStepAccumulator>(
    ({ scopedContext, stepResults: accStepResults }, step, i) => {
      const stepResult = executeStep(
        step,
        i,
        funcId,
        funcEntry.argMap,
        accStepResults,
        scopedContext,
      );
      const nextTable = stepResult.updatedValueTable;
      return {
        currentValueTable: nextTable,
        scopedContext: createScopedContext(scopedContext, nextTable),
        stepResults: [...accStepResults, stepResult.stepReturnId],
      };
    },
    {
      currentValueTable: scopedValueTable,
      scopedContext: createScopedContext(context, scopedValueTable),
      stepResults: [],
    },
  );

  // Return the last step's result (PipeFunc semantics)
  const finalResultId = stepResults[stepResults.length - 1];
  if (finalResultId === undefined) {
    throw new Error(`executePipeFunc: pipe ${funcId} produced no step results`);
  }
  const finalResult = currentValueTable[finalResultId];
  if (finalResult === undefined) {
    throw createMissingValueError(finalResultId);
  }

  // Return result with updated value table (immutable update to main context)
  return {
    value: finalResult,
    updatedValueTable: {
      ...context.valueTable,
      [funcEntry.returnId]: finalResult,
    },
  };
}

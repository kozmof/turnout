import { FuncId, TapDefineId, ExecutionContext, ValueId } from '../../types';
import {
  createMissingDefinitionError,
  createEmptySequenceError,
  createMissingDependencyError,
  createMissingValueError,
} from '../errors';
import { AnyValue } from '../../../state-control/value';
import { executeTree } from '../executeTree';
import { buildExecutionTree } from '../buildExecutionTree';

export function executeTapFunc(
  funcId: FuncId,
  defId: TapDefineId,
  context: ExecutionContext
): void {
  const funcEntry = context.funcTable[funcId];
  const def = context.tapFuncDefTable[defId];

  if (!def) {
    throw createMissingDefinitionError(defId, funcId);
  }

  if (def.sequence.length === 0) {
    throw createEmptySequenceError(funcId);
  }

  // Create a scoped value table that starts with only the TapFunc args
  const scopedValueTable: typeof context.valueTable = {} as any;

  // Populate scoped value table with TapFunc arg values
  for (const argName of Object.keys(def.args)) {
    const valueId = funcEntry.argMap[argName] as ValueId;
    if (!valueId) {
      throw createMissingDependencyError(valueId, funcId);
    }

    const value = context.valueTable[valueId];
    if (!value) {
      throw createMissingValueError(valueId);
    }

    // Add the arg value to the scoped table
    scopedValueTable[valueId] = value;
  }

  // Create a scoped context with the scoped value table
  const scopedContext: ExecutionContext = {
    ...context,
    valueTable: scopedValueTable,
  };

  const results: AnyValue[] = [];

  // Iterate through sequence and collect results
  for (const stepFuncId of def.sequence) {
    const stepFuncEntry = context.funcTable[stepFuncId];

    if (!stepFuncEntry) {
      throw createMissingDependencyError(stepFuncId, funcId);
    }

    // Build and execute the step tree with scoped context
    const stepTree = buildExecutionTree(stepFuncId, scopedContext);
    const stepResult = executeTree(stepTree, scopedContext);

    // Add the step result to the scoped value table for subsequent steps
    scopedContext.valueTable[stepFuncEntry.returnId] = stepResult;

    results.push(stepResult);
  }

  // Return the last result (TapFunc semantics)
  const finalResult = results[results.length - 1];

  // Store result in the main ValueTable
  context.valueTable[funcEntry.returnId] = finalResult;
}

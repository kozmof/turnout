import { FuncId, TapDefineId, ExecutionContext, ValueId, ValueTable } from '../../types';
import {
  createMissingDefinitionError,
  createEmptySequenceError,
  createMissingDependencyError,
  createMissingValueError,
} from '../errors';
import { AnyValue } from '../../../state-control/value';
import { executeTree } from '../executeTree';
import { buildExecutionTree } from '../buildExecutionTree';

export function validateScopedValueTable(
  scopedValueTable: Partial<ValueTable>,
  tapDefArgs: Record<string, unknown>,
  argMap: { [argName: string]: ValueId | FuncId }
): asserts scopedValueTable is ValueTable {
  // Verify that all expected arguments are present in the scoped table
  const expectedValueIds = Object.keys(tapDefArgs).map(
    argName => argMap[argName] as ValueId
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
  argMap: { [argName: string]: ValueId | FuncId },
  tapDefArgs: Record<string, unknown>,
  sourceValueTable: ValueTable,
  funcId: FuncId
): ValueTable {
  const scopedValueTable: Partial<ValueTable> = {};

  for (const argName of Object.keys(tapDefArgs)) {
    const valueId = argMap[argName] as ValueId;
    if (!valueId) {
      throw createMissingDependencyError(valueId, funcId);
    }

    const value = sourceValueTable[valueId];
    if (!value) {
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

  const scopedValueTable = createScopedValueTable(
    funcEntry.argMap,
    def.args,
    context.valueTable,
    funcId
  );

  const scopedContext = createScopedContext(context, scopedValueTable);

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

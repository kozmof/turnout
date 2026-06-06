import { ExecutionContext, type ExecutionResult, type ValueTable } from '../types';
import { ExecutionTree } from './tree-types';
import { isCombineDefineId, isPipeDefineId } from '../idValidation';
import { createFunctionExecutionError } from './errors';
import { executeCombineFunc } from './exec/executeCombineFunc';
import { executePipeFunc } from './exec/executePipeFunc';
import { executeCondFunc } from './exec/executeCondFunc';

/**
 * Executes an execution tree and returns the result along with updated state.
 * This is a pure function - it does not mutate the input context.
 *
 * @param tree - The execution tree to execute
 * @param context - The execution context (read-only)
 * @returns Execution result with computed value and updated value table
 */
export function executeTree(
  tree: ExecutionTree,
  context: ExecutionContext
): ExecutionResult {
  return executeTreeInternal(tree, context, context.valueTable);
}

/**
 * Internal traversal that threads valueTable separately from the static context
 * to avoid creating a new ExecutionContext object on every recursive call.
 * A combined context is only constructed once, right before invoking an executor.
 */
function executeTreeInternal(
  tree: ExecutionTree,
  context: ExecutionContext,
  valueTable: ValueTable,
): ExecutionResult {
  // Base case: value node (leaf)
  if (tree.nodeType === 'value') {
    return {
      value: tree.value,
      updatedValueTable: valueTable,
    };
  }

  // Conditional node: evaluate condition, then execute only one branch
  if (tree.nodeType === 'conditional') {
    const funcId = tree.nodeId;

    const conditionResult = executeTreeInternal(tree.conditionTree, context, valueTable);
    valueTable = conditionResult.updatedValueTable;

    const conditionValue = conditionResult.value;
    if (conditionValue.symbol !== 'boolean') {
      throw createFunctionExecutionError(
        funcId,
        `Condition must evaluate to boolean, got ${conditionValue.symbol}`
      );
    }

    const branchResult = conditionValue.value
      ? executeTreeInternal(tree.trueBranchTree, context, valueTable)
      : executeTreeInternal(tree.falseBranchTree, context, valueTable);

    valueTable = branchResult.updatedValueTable;

    return executeCondFunc(funcId, withValueTable(context, valueTable), branchResult.value);
  }

  // Regular function node (tree.nodeType === 'function')
  // Post-order traversal: execute children first, threading valueTable through
  if (tree.children) {
    for (const child of tree.children) {
      const childResult = executeTreeInternal(child, context, valueTable);
      valueTable = childResult.updatedValueTable;
    }
  }

  // Build the context object once, right before calling the executor
  const updatedContext = withValueTable(context, valueTable);
  const funcId = tree.nodeId;
  const defId = tree.funcDef;

  if (isCombineDefineId(defId, context.combineFuncDefTable)) {
    return executeCombineFunc(funcId, defId, updatedContext);
  } else if (isPipeDefineId(defId, context.pipeFuncDefTable)) {
    return executePipeFunc(funcId, defId, updatedContext);
  } else {
    throw createFunctionExecutionError(
      funcId,
      `Unknown definition type for ${String(defId)}`
    );
  }
}

function withValueTable(
  context: ExecutionContext,
  valueTable: ValueTable
): ExecutionContext {
  if (context.valueTable === valueTable) return context;
  return {
    valueTable,
    funcTable: context.funcTable,
    combineFuncDefTable: context.combineFuncDefTable,
    pipeFuncDefTable: context.pipeFuncDefTable,
    condFuncDefTable: context.condFuncDefTable,
  };
}

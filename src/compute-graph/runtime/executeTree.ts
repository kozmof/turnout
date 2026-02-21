import { ExecutionContext } from '../types';
import { ExecutionTree } from './tree-types';
import { isCombineDefineId, isPipeDefineId } from '../idValidation';
import { createFunctionExecutionError } from './errors';
import { executeCombineFunc, type ExecutionResult } from './exec/executeCombineFunc';
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
  // Base case: value node (leaf)
  if (tree.nodeType === 'value') {
    // TypeScript now knows tree is ValueNode, so tree.value exists
    return {
      value: tree.value,
      updatedValueTable: context.valueTable, // No changes for leaf nodes
    };
  }

  // Conditional node: evaluate condition, then execute only one branch
  if (tree.nodeType === 'conditional') {
    // TypeScript now knows tree is ConditionalNode
    // All required fields are guaranteed to exist (conditionTree, trueBranchTree, etc.)
    const funcId = tree.nodeId;

    // Execute condition tree
    const conditionResult = executeTree(tree.conditionTree, context);

    // Update context with condition result
    let currentContext: ExecutionContext = {
      ...context,
      valueTable: conditionResult.updatedValueTable,
    };

    // Execute the appropriate branch based on condition
    const branchResult = conditionResult.value.value
      ? executeTree(tree.trueBranchTree, currentContext)
      : executeTree(tree.falseBranchTree, currentContext);

    // Update context with branch result
    currentContext = {
      ...currentContext,
      valueTable: branchResult.updatedValueTable,
    };

    // Execute the conditional function to store the result
    const condFuncResult = executeCondFunc(
      funcId,
      currentContext,
      conditionResult.value,
      branchResult.value,
      branchResult.value // both are the same since we only executed one
    );

    return condFuncResult;
  }

  // Regular function node (tree.nodeType === 'function')
  // TypeScript now knows tree is FunctionNode
  // All required fields are guaranteed to exist (funcDef, returnId, nodeId is FuncId)

  // Post-order traversal: execute children first, threading state through
  let currentValueTable = context.valueTable;

  if (tree.children) {
    for (const child of tree.children) {
      const childResult = executeTree(child, {
        ...context,
        valueTable: currentValueTable,
      });
      // Thread the updated state to the next child
      currentValueTable = childResult.updatedValueTable;
    }
  }

  // Update context with accumulated state from children
  const updatedContext: ExecutionContext = {
    ...context,
    valueTable: currentValueTable,
  };

  // Now execute this function
  const funcId = tree.nodeId;
  const defId = tree.funcDef;

  let execResult: ExecutionResult;

  if (isCombineDefineId(defId, context.combineFuncDefTable)) {
    execResult = executeCombineFunc(funcId, defId, updatedContext);
  } else if (isPipeDefineId(defId, context.pipeFuncDefTable)) {
    execResult = executePipeFunc(funcId, defId, updatedContext);
  } else {
    throw createFunctionExecutionError(
      funcId,
      `Unknown definition type for ${String(defId)}`
    );
  }

  return execResult;
}

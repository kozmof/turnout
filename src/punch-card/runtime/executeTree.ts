import { ExecutionContext, FuncId, ValueId } from '../types';
import { ExecutionTree } from './tree-types';
import { isPlugDefineId, isTapDefineId } from '../typeGuards';
import { createFunctionExecutionError, createInvalidTreeNodeError, createMissingValueError } from './errors';
import { executePlugFunc, type ExecutionResult } from './exec/executePlugFunc';
import { executeTapFunc } from './exec/executeTapFunc';
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
    // Value should already be in the context or in the tree
    if (tree.value === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      throw createMissingValueError(tree.nodeId as ValueId);
    }
    return {
      value: tree.value,
      updatedValueTable: context.valueTable, // No changes for leaf nodes
    };
  }

  // Conditional node: evaluate condition, then execute only one branch
  if (tree.nodeType === 'conditional') {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const funcId = tree.nodeId as FuncId;

    if (!tree.conditionTree) {
      throw createInvalidTreeNodeError(funcId, 'Conditional node missing condition tree');
    }
    if (!tree.trueBranchTree) {
      throw createInvalidTreeNodeError(funcId, 'Conditional node missing true branch tree');
    }
    if (!tree.falseBranchTree) {
      throw createInvalidTreeNodeError(funcId, 'Conditional node missing false branch tree');
    }
    if (!tree.returnId) {
      throw createInvalidTreeNodeError(funcId, 'Conditional node missing return ID');
    }

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

  // Regular function node
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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const funcId = tree.nodeId as FuncId;
  if (!tree.funcDef) {
    throw createInvalidTreeNodeError(funcId, 'Function node missing function definition');
  }
  const defId = tree.funcDef;

  let execResult: ExecutionResult;

  if (isPlugDefineId(defId, context.plugFuncDefTable)) {
    execResult = executePlugFunc(funcId, defId, updatedContext);
  } else if (isTapDefineId(defId, context.tapFuncDefTable)) {
    execResult = executeTapFunc(funcId, defId, updatedContext);
  } else {
    throw createFunctionExecutionError(
      funcId,
      `Unknown definition type for ${defId}`
    );
  }

  return execResult;
}

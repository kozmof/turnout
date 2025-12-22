import { ExecutionContext, FuncId, ValueId } from '../types';
import { ExecutionTree } from './tree-types';
import { AnyValue } from '../../state-control/value';
import { isPlugDefineId, isTapDefineId } from '../typeGuards';
import { createFunctionExecutionError, createInvalidTreeNodeError, createMissingValueError } from './errors';
import { executePlugFunc } from './exec/executePlugFunc';
import { executeTapFunc } from './exec/executeTapFunc';
import { executeCondFunc } from './exec/executeCondFunc';

export function executeTree(
  tree: ExecutionTree,
  context: ExecutionContext
): AnyValue {
  // Base case: value node (leaf)
  if (tree.nodeType === 'value') {
    // Value should already be in the context or in the tree
    if (tree.value === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      throw createMissingValueError(tree.nodeId as ValueId);
    }
    return tree.value;
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

    // Execute the appropriate branch based on condition
    const branchResult = conditionResult.value
      ? executeTree(tree.trueBranchTree, context)
      : executeTree(tree.falseBranchTree, context);

    // Execute the conditional function to store the result
    executeCondFunc(
      funcId,
      context,
      conditionResult,
      branchResult,
      branchResult // both are the same since we only executed one
    );

    // Return the result
    const result = context.valueTable[tree.returnId];
    return result;
  }

  // Regular function node
  // Post-order traversal: execute children first
  if (tree.children) {
    for (const child of tree.children) {
      executeTree(child, context);
    }
  }

  // Now execute this function
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const funcId = tree.nodeId as FuncId;
  if (!tree.funcDef) {
    throw createInvalidTreeNodeError(funcId, 'Function node missing function definition');
  }
  const defId = tree.funcDef;

  if (isPlugDefineId(defId, context.plugFuncDefTable)) {
    executePlugFunc(funcId, defId, context);
  } else if (isTapDefineId(defId, context.tapFuncDefTable)) {
    executeTapFunc(funcId, defId, context);
  } else {
    throw createFunctionExecutionError(
      funcId,
      `Unknown definition type for ${defId}`
    );
  }

  // Return the result
  if (!tree.returnId) {
    throw createInvalidTreeNodeError(funcId, 'Function node missing return ID');
  }
  const result = context.valueTable[tree.returnId];
  return result;
}

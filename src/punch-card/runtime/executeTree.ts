import { ExecutionContext, FuncId, PlugDefineId, TapDefineId, CondDefineId } from '../types';
import { ExecutionTree } from './tree-types';
import { AnyValue } from '../../state-control/value';
import { isPlugDefineId, isTapDefineId, isCondDefineId } from '../typeGuards';
import { createFunctionExecutionError } from './errors';
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
    return tree.value!;
  }

  // Conditional node: evaluate condition, then execute only one branch
  if (tree.nodeType === 'conditional') {
    const funcId = tree.nodeId as FuncId;
    const defId = tree.funcDef!;

    // Execute condition tree
    const conditionResult = executeTree(tree.conditionTree!, context);

    // Execute the appropriate branch based on condition
    const branchResult = conditionResult.value
      ? executeTree(tree.trueBranchTree!, context)
      : executeTree(tree.falseBranchTree!, context);

    // Execute the conditional function to store the result
    executeCondFunc(
      funcId,
      defId as CondDefineId,
      context,
      conditionResult,
      branchResult,
      branchResult // both are the same since we only executed one
    );

    // Return the result
    const result = context.valueTable[tree.returnId!];
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
  const funcId = tree.nodeId as FuncId;
  const defId = tree.funcDef!;

  if (isPlugDefineId(defId, context.plugFuncDefTable)) {
    executePlugFunc(funcId, defId as PlugDefineId, context);
  } else if (isTapDefineId(defId, context.tapFuncDefTable)) {
    executeTapFunc(funcId, defId as TapDefineId, context);
  } else {
    throw createFunctionExecutionError(
      funcId,
      `Unknown definition type for ${defId}`
    );
  }

  // Return the result
  const result = context.valueTable[tree.returnId!];
  return result;
}

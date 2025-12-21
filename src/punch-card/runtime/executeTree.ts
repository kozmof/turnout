import { ExecutionContext, FuncId, PlugDefineId, TapDefineId } from '../types';
import { ExecutionTree } from './tree-types';
import { AnyValue } from '../../state-control/value';
import { isPlugDefineId, isTapDefineId } from '../typeGuards';
import { createFunctionExecutionError } from './errors';
import { executePlugFunc } from './exec/executePlugFunc';
import { executeTapFunc } from './exec/executeTapFunc';

export function executeTree(
  tree: ExecutionTree,
  context: ExecutionContext
): AnyValue {
  // Base case: value node (leaf)
  if (tree.nodeType === 'value') {
    // Value should already be in the context or in the tree
    return tree.value!;
  }

  // Recursive case: function node
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

import {
  FuncId,
  ExecutionContext,
  ValueId,
} from '../types';
import { ExecutionTree, NodeId } from './tree-types';
import type { ValueNode, FunctionNode, ConditionalNode } from './tree-types';
import { isFuncId, isCondDefineId } from '../idValidation';
import { createMissingValueError } from './errors';
import { TOM } from '../../util/tom';

/**
 * Creates a mapping from ValueId to FuncId for functions that produce those values.
 * This is useful for performance optimization to avoid rebuilding this map repeatedly.
 */
export function buildReturnIdToFuncIdMap(context: ExecutionContext): ReadonlyMap<ValueId, FuncId> {
  const returnIdToFuncId = new Map<ValueId, FuncId>();
  for (const [funcId, funcEntry] of TOM.entries(context.funcTable)) {
    returnIdToFuncId.set(funcEntry.returnId, funcId);
  }
  return returnIdToFuncId;
}

function getReturnIdToFuncIdMap(context: ExecutionContext): ReadonlyMap<ValueId, FuncId> {
  // Use pre-computed map if available
  if (context.returnIdToFuncId) {
    return context.returnIdToFuncId;
  }

  // Otherwise, build it on demand
  return buildReturnIdToFuncIdMap(context);
}

export function buildExecutionTree(
  nodeId: NodeId,
  context: ExecutionContext,
  visited: Set<NodeId> = new Set(),
  memo: Map<NodeId, ExecutionTree> = new Map()
): ExecutionTree {
  // Return cached result for shared DAG nodes (diamond patterns)
  const cached = memo.get(nodeId);
  if (cached !== undefined) return cached;

  // Detect cycles (shouldn't happen in valid trees, but check anyway)
  // A cycle exists if we're currently visiting this node (in our ancestor chain)
  if (visited.has(nodeId)) {
    throw new Error(`Cycle detected at node ${nodeId}`);
  }

  // Mark as visiting (will be unmarked when we leave this call)
  visited.add(nodeId);

  try {
    const result = buildExecutionTreeInternal(nodeId, context, visited, memo);
    memo.set(nodeId, result);
    return result;
  } finally {
    // Clean up: remove from visited set after processing
    // This allows sibling branches to visit the same node without false cycles
    visited.delete(nodeId);
  }
}

function buildExecutionTreeInternal(
  nodeId: NodeId,
  context: ExecutionContext,
  visited: Set<NodeId>,
  memo: Map<NodeId, ExecutionTree>
): ExecutionTree {

  // Get the returnId -> FuncId mapping (pre-computed or on-demand)
  const returnIdToFuncId = getReturnIdToFuncIdMap(context);

  // Base case: ValueId (leaf node)
  if (!isFuncId(nodeId, context.funcTable)) {
    const valueId = nodeId;

    // Check if this value is produced by another function
    const producerFuncId = returnIdToFuncId.get(valueId);
    if (producerFuncId !== undefined) {
      return buildExecutionTree(producerFuncId, context, visited, memo);
    }

    // Otherwise, it's a pre-defined value
    const value = context.valueTable[valueId];

    // Value must exist in the table
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (value === undefined) {
      throw createMissingValueError(valueId);
    }

    const valueNode: ValueNode = {
      nodeType: 'value',
      nodeId: valueId,
      value,
    };
    return valueNode;
  }

  // Recursive case: FuncId (internal node)
  const funcId = nodeId;
  const funcEntry = context.funcTable[funcId];
  const defId = funcEntry.defId;

  // Check if this is a CondFunc (conditional)
  if (isCondDefineId(defId, context.condFuncDefTable)) {
    const condDef = context.condFuncDefTable[defId];

    // Build trees for condition and both branches
    // Each branch can visit the same nodes independently (no false cycle detection)
    // because visited set is cleaned up after each subtree completes
    const conditionTree = buildExecutionTree(condDef.conditionId.id, context, visited, memo);
    const trueBranchTree = buildExecutionTree(condDef.trueBranchId, context, visited, memo);
    const falseBranchTree = buildExecutionTree(condDef.falseBranchId, context, visited, memo);

    const conditionalNode: ConditionalNode = {
      nodeType: 'conditional',
      nodeId: funcId,
      funcDef: defId, // defId is narrowed to CondDefineId by the type guard
      returnId: funcEntry.returnId,
      conditionTree,
      trueBranchTree,
      falseBranchTree,
    };
    return conditionalNode;
  }

  const children: ExecutionTree[] = [];

  // Add children from argMap
  // Each child can independently visit the same nodes because visited set
  // is cleaned up after each child completes
  for (const argId of Object.values(funcEntry.argMap)) {
    const childTree = buildExecutionTree(argId, context, visited, memo);
    children.push(childTree);
  }

  // Note: For PipeFunc, we do NOT add sequence children here
  // The sequence functions will be executed within the scoped context by executePipeFunc
  // This prevents sequence functions from being executed in the main tree traversal

  // At this point, defId must be CombineDefineId | PipeDefineId (CondDefineId was handled above)
  const functionNode: FunctionNode = {
    nodeType: 'function',
    nodeId: funcId,
    funcDef: defId,
    returnId: funcEntry.returnId,
    children: children.length > 0 ? children : undefined,
  };
  return functionNode;
}

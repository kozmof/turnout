import {
  FuncId,
  ExecutionContext,
  ValueId,
} from '../types';
import { ExecutionTree, NodeId } from './tree-types';
import { isFuncId, isCondDefineId } from '../typeGuards';

/**
 * Creates a mapping from ValueId to FuncId for functions that produce those values.
 * This is useful for performance optimization to avoid rebuilding this map repeatedly.
 */
export function buildReturnIdToFuncIdMap(context: ExecutionContext): ReadonlyMap<ValueId, FuncId> {
  const returnIdToFuncId = new Map<ValueId, FuncId>();
  for (const [funcId, funcEntry] of Object.entries(context.funcTable)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    returnIdToFuncId.set(funcEntry.returnId, funcId as FuncId);
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
  visited: Set<NodeId> = new Set()
): ExecutionTree {
  // Detect cycles (shouldn't happen in valid trees, but check anyway)
  if (visited.has(nodeId)) {
    throw new Error(`Cycle detected at node ${nodeId}`);
  }

  visited.add(nodeId);

  // Get the returnId -> FuncId mapping (pre-computed or on-demand)
  const returnIdToFuncId = getReturnIdToFuncIdMap(context);

  // Base case: ValueId (leaf node)
  if (!isFuncId(nodeId, context.funcTable)) {
    const valueId = nodeId;

    // Check if this value is produced by another function
    const producerFuncId = returnIdToFuncId.get(valueId);
    if (producerFuncId !== undefined) {
      return buildExecutionTree(producerFuncId, context, visited);
    }

    // Otherwise, it's a pre-defined value
    const value = context.valueTable[valueId];

    return {
      nodeId: valueId,
      nodeType: 'value',
      value,
    };
  }

  // Recursive case: FuncId (internal node)
  const funcId = nodeId;
  const funcEntry = context.funcTable[funcId];
  const defId = funcEntry.defId;

  // Check if this is a CondFunc (conditional)
  if (isCondDefineId(defId, context.condFuncDefTable)) {
    const condDef = context.condFuncDefTable[defId];

    // Build trees for condition and both branches
    const conditionTree = buildExecutionTree(condDef.conditionId, context, new Set(visited));
    const trueBranchTree = buildExecutionTree(condDef.trueBranchId, context, new Set(visited));
    const falseBranchTree = buildExecutionTree(condDef.falseBranchId, context, new Set(visited));

    return {
      nodeId: funcId,
      nodeType: 'conditional',
      funcDef: funcEntry.defId,
      returnId: funcEntry.returnId,
      conditionTree,
      trueBranchTree,
      falseBranchTree,
    };
  }

  const children: ExecutionTree[] = [];

  // Add children from argMap
  for (const argId of Object.values(funcEntry.argMap)) {
    const childTree = buildExecutionTree(argId, context, new Set(visited));
    children.push(childTree);
  }

  // Note: For TapFunc, we do NOT add sequence children here
  // The sequence functions will be executed within the scoped context by executeTapFunc
  // This prevents sequence functions from being executed in the main tree traversal

  return {
    nodeId: funcId,
    nodeType: 'function',
    funcDef: funcEntry.defId,
    children: children.length > 0 ? children : undefined,
    returnId: funcEntry.returnId,
  };
}

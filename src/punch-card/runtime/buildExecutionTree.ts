import {
  FuncId,
  ExecutionContext,
  ValueId,
  TapDefineId,
} from '../types';
import { ExecutionTree, NodeId } from './tree-types';
import { createMissingDependencyError } from './errors';
import { isFuncId, isTapDefineId } from '../typeGuards';

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

  // Build a map of returnId -> FuncId for quick lookup
  const returnIdToFuncId = new Map<ValueId, FuncId>();
  for (const [funcId, funcEntry] of Object.entries(context.funcTable) as Array<
    [FuncId, (typeof context.funcTable)[FuncId]]
  >) {
    returnIdToFuncId.set(funcEntry.returnId, funcId);
  }

  // Base case: ValueId (leaf node)
  if (!isFuncId(nodeId, context.funcTable)) {
    const valueId = nodeId as ValueId;

    // Check if this value is produced by another function
    if (returnIdToFuncId.has(valueId)) {
      const producerFuncId = returnIdToFuncId.get(valueId)!;
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
  const funcId = nodeId as FuncId;
  const funcEntry = context.funcTable[funcId];

  if (!funcEntry) {
    throw createMissingDependencyError(funcId, funcId);
  }

  const children: ExecutionTree[] = [];

  // Add children from argMap
  for (const argId of Object.values(funcEntry.argMap)) {
    const childTree = buildExecutionTree(argId, context, new Set(visited));
    children.push(childTree);
  }

  // If this is a TapFunc, add children from sequence
  const defId = funcEntry.defId;
  if (isTapDefineId(defId, context.tapFuncDefTable)) {
    const tapDef = context.tapFuncDefTable[defId as TapDefineId];
    if (tapDef && tapDef.sequence) {
      for (const seqFuncId of tapDef.sequence) {
        const childTree = buildExecutionTree(seqFuncId, context, new Set(visited));
        children.push(childTree);
      }
    }
  }

  return {
    nodeId: funcId,
    nodeType: 'function',
    funcDef: funcEntry.defId,
    children: children.length > 0 ? children : undefined,
    returnId: funcEntry.returnId,
  };
}

import {
  FuncId,
  FuncTable,
  ValueTable,
  ValueId,
  TapFuncDefTable,
  TapDefineId,
} from '../types';
import { DependencyGraph, NodeId } from './graph-types';
import { createMissingDependencyError } from './errors';
import { isFuncId, isTapDefineId } from '../typeGuards';

export function buildDependencyGraph(
  funcTable: FuncTable,
  valueTable: ValueTable,
  tapFuncDefTable: TapFuncDefTable,
  rootFuncId: FuncId
): DependencyGraph {
  const graph: DependencyGraph = {
    nodes: new Set(),
    edges: new Map(),
    inDegree: new Map(),
  };

  // First pass: build a map of returnId -> FuncId
  const returnIdToFuncId = new Map<ValueId, FuncId>();
  for (const [funcId, funcEntry] of Object.entries(funcTable) as Array<
    [FuncId, (typeof funcTable)[FuncId]]
  >) {
    returnIdToFuncId.set(funcEntry.returnId, funcId);
  }

  const queue: NodeId[] = [rootFuncId];
  const visited = new Set<NodeId>();

  while (queue.length > 0) {
    const nodeId = queue.shift()!;

    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    graph.nodes.add(nodeId);

    // Initialize in-degree for this node if not exists
    if (!graph.inDegree.has(nodeId)) {
      graph.inDegree.set(nodeId, 0);
    }

    // If it's a FuncId, process its dependencies
    if (isFuncId(nodeId, funcTable)) {
      const funcEntry = funcTable[nodeId];

      if (!funcEntry) {
        throw createMissingDependencyError(nodeId, nodeId);
      }

      // Initialize edges for this node
      if (!graph.edges.has(nodeId)) {
        graph.edges.set(nodeId, new Set());
      }

      // Add dependencies from argMap
      for (const [argName, depId] of Object.entries(funcEntry.argMap)) {
        let actualDep: NodeId = depId;

        // If depId is a ValueId that's produced by another function,
        // depend on that function instead
        if (!isFuncId(depId, funcTable) && returnIdToFuncId.has(depId as ValueId)) {
          actualDep = returnIdToFuncId.get(depId as ValueId)!;
        }

        // Add edge: nodeId depends on actualDep
        graph.edges.get(nodeId)!.add(actualDep);

        // Update in-degree: nodeId has one more dependency
        const currentInDegree = graph.inDegree.get(nodeId) || 0;
        graph.inDegree.set(nodeId, currentInDegree + 1);

        // Initialize actualDep in-degree if not exists
        if (!graph.inDegree.has(actualDep)) {
          graph.inDegree.set(actualDep, 0);
        }

        // Add actualDep to nodes
        graph.nodes.add(actualDep);

        // Queue dependency for processing
        queue.push(actualDep);
      }

      // If this is a TapFunc, add dependencies for sequence functions
      const defId = funcEntry.defId;
      if (isTapDefineId(defId, tapFuncDefTable)) {
        const tapDef = tapFuncDefTable[defId as TapDefineId];
        if (tapDef && tapDef.sequence) {
          for (const seqFuncId of tapDef.sequence) {
            // Add edge: nodeId depends on seqFuncId
            graph.edges.get(nodeId)!.add(seqFuncId);

            // Update in-degree: nodeId has one more dependency
            const currentInDegree = graph.inDegree.get(nodeId) || 0;
            graph.inDegree.set(nodeId, currentInDegree + 1);

            // Initialize seqFuncId in-degree if not exists
            if (!graph.inDegree.has(seqFuncId)) {
              graph.inDegree.set(seqFuncId, 0);
            }

            // Add seqFuncId to nodes
            graph.nodes.add(seqFuncId);

            // Queue dependency for processing
            queue.push(seqFuncId);
          }
        }
      }
    }
  }

  return graph;
}

import { DependencyGraph, ExecutionOrder, NodeId } from './graph-types';
import { createCyclicDependencyError } from './errors';

export function topologicalSort(graph: DependencyGraph): ExecutionOrder {
  // Clone in-degree map for modification
  const inDegree = new Map(graph.inDegree);
  const result: NodeId[] = [];

  // Queue of nodes with no dependencies (in-degree = 0)
  const queue: NodeId[] = [];

  for (const [nodeId, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    result.push(nodeId);

    // For each node that depends on current node
    // Find nodes where nodeId is in their dependencies
    for (const [dependentId, dependencies] of graph.edges.entries()) {
      if (dependencies.has(nodeId)) {
        const newDegree = inDegree.get(dependentId)! - 1;
        inDegree.set(dependentId, newDegree);

        if (newDegree === 0) {
          queue.push(dependentId);
        }
      }
    }
  }

  // Cycle detection: if not all nodes processed, there's a cycle
  if (result.length !== graph.nodes.size) {
    const remaining = Array.from(graph.nodes).filter(
      (node) => !result.includes(node)
    );
    throw createCyclicDependencyError(remaining);
  }

  return result;
}

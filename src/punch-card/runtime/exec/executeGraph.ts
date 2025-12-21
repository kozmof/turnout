import { FuncId, ExecutionContext } from '../../types';
import { AnyValue } from '../../../state-control/value';
import { ExecutionTracker } from '../graph-types';
import {
  GraphExecutionError,
  createMissingDependencyError,
  createFunctionExecutionError,
  isGraphExecutionError,
} from '../errors';
import { buildDependencyGraph } from '../buildDependencyGraph';
import { topologicalSort } from '../topologicalSort';
import { executeNode } from './executeNode';

export function executeGraph(
  rootFuncId: FuncId,
  context: ExecutionContext
): AnyValue {
  // 1. Build dependency graph
  const graph = buildDependencyGraph(
    context.funcTable,
    context.valueTable,
    context.tapFuncDefTable,
    rootFuncId
  );

  // 2. Compute execution order via topological sort
  const executionOrder = topologicalSort(graph);

  // 3. Initialize execution tracker
  const tracker: ExecutionTracker = new Map();
  for (const nodeId of graph.nodes) {
    tracker.set(nodeId, { state: 'pending' });
  }

  // 4. Execute nodes in order
  for (const nodeId of executionOrder) {
    const state = tracker.get(nodeId);

    // Skip if already completed (e.g., shared values)
    if (state?.state === 'completed') {
      continue;
    }

    executeNode(nodeId, context, tracker);
  }

  // 5. Return the result
  const rootFuncEntry = context.funcTable[rootFuncId];

  if (!rootFuncEntry) {
    throw createMissingDependencyError(rootFuncId, rootFuncId);
  }

  const result = context.valueTable[rootFuncEntry.returnId];

  if (!result) {
    throw createFunctionExecutionError(
      rootFuncId,
      'Root function did not produce a result'
    );
  }

  return result;
}

export function executeGraphSafe(
  rootFuncId: FuncId,
  context: ExecutionContext
): { result?: AnyValue; errors: GraphExecutionError[] } {
  const errors: GraphExecutionError[] = [];

  try {
    const result = executeGraph(rootFuncId, context);
    return { result, errors };
  } catch (error) {
    if (isGraphExecutionError(error)) {
      errors.push(error);
    } else {
      errors.push(
        createFunctionExecutionError(
          rootFuncId,
          String(error),
          error instanceof Error ? error : undefined
        )
      );
    }
    return { errors };
  }
}

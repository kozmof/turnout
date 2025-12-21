import { ExecutionContext, FuncId, PlugDefineId, TapDefineId } from '../../types';
import { NodeId, ExecutionTracker } from '../graph-types';
import { GraphExecutionError } from '../errors';
import { isFuncId, isPlugDefineId, isTapDefineId } from '../../typeGuards';
import { executePlugFunc } from './executePlugFunc';
import { executeTapFunc } from './executeTapFunc';

export function executeNode(
  nodeId: NodeId,
  context: ExecutionContext,
  tracker: ExecutionTracker
): void {
  // ValueIds are just lookups, not executions
  if (!isFuncId(nodeId, context.funcTable)) {
    // It's a ValueId - just mark it as completed
    // Input values should already exist; output values will be created by functions
    tracker.set(nodeId, { state: 'completed' });
    return;
  }

  // Must be FuncId
  const funcId = nodeId as FuncId;
  const funcEntry = context.funcTable[funcId];

  if (!funcEntry) {
    throw {
      kind: 'missingDependency',
      missingId: funcId,
      dependentId: funcId,
    } as GraphExecutionError;
  }

  tracker.set(funcId, { state: 'computing' });

  try {
    // Determine if it's a PlugFunc or TapFunc
    const defId = funcEntry.defId;

    if (isPlugDefineId(defId, context.plugFuncDefTable)) {
      executePlugFunc(funcId, defId as PlugDefineId, context);
    } else if (isTapDefineId(defId, context.tapFuncDefTable)) {
      executeTapFunc(funcId, defId as TapDefineId, context);
    } else {
      throw {
        kind: 'functionExecution',
        funcId,
        message: `Unknown definition type for ${defId}`,
      } as GraphExecutionError;
    }

    tracker.set(funcId, { state: 'completed' });
  } catch (error) {
    tracker.set(funcId, {
      state: 'error',
      error: error instanceof Error ? error : new Error(String(error)),
    });
    throw error;
  }
}

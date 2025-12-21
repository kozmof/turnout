// Main execution engine
export { executeGraph, executeGraphSafe } from './executeGraph';

// Types
export type {
  ExecutionContext,
  ValueTable,
  FuncTable,
  PlugFuncDefTable,
  TapFuncDefTable,
  FuncId,
  ValueId,
  PlugDefineId,
  TapDefineId,
  InterfaceArgId,
} from './types';

export type { GraphExecutionError } from './errors';

export type {
  NodeId,
  DependencyGraph,
  ExecutionOrder,
  ExecutionState,
  ExecutionTracker,
} from './graph-types';

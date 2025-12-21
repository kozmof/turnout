// Main execution engine
export { executeGraph, executeGraphSafe } from './runtime/exec/executeGraph';

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

export type { GraphExecutionError } from './runtime/errors';

export type {
  NodeId,
  DependencyGraph,
  ExecutionOrder,
  ExecutionState,
  ExecutionTracker,
} from './runtime/graph-types';

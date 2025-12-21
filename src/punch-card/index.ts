// Main execution engine
export { executeGraph, executeGraphSafe } from './runtime/exec/executeGraph';

// Types
export type {
  ExecutionContext,
  ValueTable,
  FuncTable,
  PlugFuncDefTable,
  TapFuncDefTable,
  CondFuncDefTable,
  FuncId,
  ValueId,
  PlugDefineId,
  TapDefineId,
  CondDefineId,
  InterfaceArgId,
} from './types';

export type { GraphExecutionError } from './runtime/errors';
export {
  createMissingDependencyError,
  createMissingDefinitionError,
  createFunctionExecutionError,
  createEmptySequenceError,
  createMissingValueError,
  isGraphExecutionError,
} from './runtime/errors';

export type { NodeId, ExecutionTree } from './runtime/tree-types';

// Main execution engine
export { executeGraph, executeGraphSafe } from './runtime/exec/executeGraph';
export { buildReturnIdToFuncIdMap } from './runtime/buildExecutionTree';
export type { ExecutionResult } from './runtime/exec/executeCombineFunc';

// Context validation
export {
  validateContext,
  assertValidContext,
} from './runtime/validateContext';
export type {
  ValidationError,
  ValidationWarning,
  ValidationResult,
} from './runtime/validateContext';

// Types
export type {
  ExecutionContext,
  ValueTable,
  FuncTable,
  CombineFuncDefTable,
  PipeFuncDefTable,
  CondFuncDefTable,
  FuncId,
  ValueId,
  CombineDefineId,
  PipeDefineId,
  CondDefineId,
  InterfaceArgId,
  PipeStepBinding,
  PipeArgBinding,
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

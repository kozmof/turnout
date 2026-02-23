// Main execution engine
export { executeGraph, executeGraphSafe } from './runtime/exec/executeGraph';
export { buildReturnIdToFuncIdMap } from './runtime/buildExecutionTree';
export type { ExecutionResult } from './types';

// Context validation
export {
  validateContext,
  assertValidContext,
  isValidContext,
} from './runtime/validateContext';
export type {
  UnvalidatedContext,
  ValidatedContext,
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
  ConditionId,
  FuncId,
  ValueId,
  PipeArgName,
  CombineDefineId,
  PipeDefineId,
  CondDefineId,
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

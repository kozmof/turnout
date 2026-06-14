// Main execution engine
export { executeGraph, executeGraphSafe } from "./runtime/exec/executeGraph.js";
export { buildExecutionTree, buildReturnIdToFuncIdMap } from "./runtime/buildExecutionTree.js";
export { executeTree } from "./runtime/executeTree.js";
export type { ExecutionResult } from "./types.js";

// Type inference helpers
export { getBinaryFnReturnType } from "./runtime/typeInference.js";

// Context validation
export { validateContext, assertValidContext, isValidContext } from "./runtime/validateContext.js";
export type {
  UnvalidatedContext,
  ValidatedContext,
  ValidationError,
  ValidationWarning,
  ValidationResult,
} from "./runtime/validateContext.js";

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
  ArgName,
  CombineDefineId,
  PipeDefineId,
  CondDefineId,
  PipeStepBinding,
  PipeArgBinding,
  BinaryFnNames,
  TransformFnNames,
} from "./types.js";

export { isValueCondition, isFuncCondition } from "./types.js";

export type { GraphExecutionError } from "./runtime/errors.js";
export {
  createMissingDependencyError,
  createMissingDefinitionError,
  createFunctionExecutionError,
  createEmptySequenceError,
  createMissingValueError,
  isGraphExecutionError,
} from "./runtime/errors.js";

export type { NodeId, ExecutionTree } from "./runtime/tree-types.js";

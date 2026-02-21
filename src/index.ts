// ── Value types ──────────────────────────────────────────────────────────────
export type {
  Value,
  BaseTypeSymbol,
  BaseTypeSubSymbol,
  TagSymbol,
  NumberValue,
  StringValue,
  BooleanValue,
  ArrayValue,
  ArrayNumberValue,
  ArrayStringValue,
  ArrayBooleanValue,
  PureNumberValue,
  PureStringValue,
  PureBooleanValue,
  PureArrayValue,
  NonArrayValue,
  AnyValue,
} from './state-control/value';

export {
  baseTypeSymbols,
  isNumber,
  isString,
  isBoolean,
  isArray,
  isPure,
  hasTag,
  isPureNumber,
  isPureString,
  isPureBoolean,
} from './state-control/value';

// ── Value builders ────────────────────────────────────────────────────────────
export {
  buildNumber,
  buildString,
  buildBoolean,
  buildArray,
  buildArrayNumber,
  buildArrayString,
  buildArrayBoolean,
  binaryNumberOp,
  binaryStringOp,
  binaryBooleanOp,
  unaryNumberOp,
  unaryStringOp,
  unaryBooleanOp,
  convertValue,
} from './state-control/value-builders';

// ── Value error types ─────────────────────────────────────────────────────────
export type {
  InvalidValueError,
  ValueBuilderError,
} from './state-control/errors';

export {
  createInvalidValueError,
  isValueBuilderError,
} from './state-control/errors';

// ── Compute-graph runtime ─────────────────────────────────────────────────────
export {
  executeGraph,
  executeGraphSafe,
  buildReturnIdToFuncIdMap,
} from './compute-graph';

export type { ExecutionResult } from './compute-graph';

export {
  validateContext,
  assertValidContext,
} from './compute-graph';

export type {
  ValidationError,
  ValidationWarning,
  ValidationResult,
} from './compute-graph';

// ── Compute-graph types ───────────────────────────────────────────────────────
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
  CombineDefineId,
  PipeDefineId,
  CondDefineId,
  InterfaceArgId,
  PipeStepBinding,
  PipeArgBinding,
} from './compute-graph';

export type {
  GraphExecutionError,
  NodeId,
  ExecutionTree,
} from './compute-graph';

export {
  createMissingDependencyError,
  createMissingDefinitionError,
  createFunctionExecutionError,
  createEmptySequenceError,
  createMissingValueError,
  isGraphExecutionError,
} from './compute-graph';

// ── Builder API ───────────────────────────────────────────────────────────────
export { ctx, combine, pipe, cond, val, ref } from './compute-graph/builder';

export type {
  ContextBuilder,
  ContextSpec,
  BuildResult,
  BuilderValidationError,
  UndefinedConditionError,
  UndefinedBranchError,
  UndefinedValueReferenceError,
  UndefinedPipeArgumentError,
  UndefinedPipeStepReferenceError,
} from './compute-graph/builder';

export { isBuilderValidationError } from './compute-graph/builder';

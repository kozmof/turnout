// ── Value types ──────────────────────────────────────────────────────────────
export type {
  Value,
  BaseTypeSymbol,
  BaseTypeSubSymbol,
  NullReasonSubSymbol,
  TagSymbol,
  NumberValue,
  StringValue,
  BooleanValue,
  NullValue,
  ArrayValue,
  ArrayNumberValue,
  ArrayStringValue,
  ArrayBooleanValue,
  ArrayNullValue,
  TypedArrayValue,
  AnyArrayValue,
  PureNumberValue,
  PureStringValue,
  PureBooleanValue,
  PureNullValue,
  PureArrayValue,
  NonArrayValue,
  AnyValue,
} from "./state-control/value.js";

export {
  baseTypeSymbols,
  nullReasonSubSymbols,
  isNumber,
  isString,
  isBoolean,
  isNull,
  isArray,
  isTypedArray,
  isPure,
  hasTag,
  isPureNumber,
  isPureString,
  isPureBoolean,
  isPureNull,
} from "./state-control/value.js";

// ── Value builders ────────────────────────────────────────────────────────────
export {
  buildNumber,
  buildString,
  buildBoolean,
  buildNull,
  buildArray,
  buildArrayNumber,
  buildArrayString,
  buildArrayBoolean,
  buildArrayNull,
  binaryNumberOp,
  binaryStringOp,
  binaryBooleanOp,
  unaryNumberOp,
  unaryStringOp,
  unaryBooleanOp,
  convertValue,
} from "./state-control/value-builders.js";

// ── Value error types ─────────────────────────────────────────────────────────
export type { InvalidValueError, ValueBuilderError } from "./state-control/errors.js";

export { createInvalidValueError, isValueBuilderError } from "./state-control/errors.js";

// ── Compute-graph runtime ─────────────────────────────────────────────────────
export {
  executeGraph,
  executeGraphSafe,
  buildExecutionTree,
  executeTree,
  buildReturnIdToFuncIdMap,
  getBinaryFnReturnType,
} from "./compute-graph/index.js";

export type { ExecutionResult } from "./compute-graph/index.js";

export { validateContext, assertValidContext, isValidContext } from "./compute-graph/index.js";

export type {
  UnvalidatedContext,
  ValidatedContext,
  ValidationError,
  ValidationWarning,
  ValidationResult,
} from "./compute-graph/index.js";

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
  ArgName,
  CombineDefineId,
  PipeDefineId,
  CondDefineId,
  PipeStepBinding,
  PipeArgBinding,
  BinaryFnNames,
  TransformFnNames,
} from "./compute-graph/index.js";

export { isValueCondition, isFuncCondition } from "./compute-graph/index.js";

export type { GraphExecutionError, NodeId, ExecutionTree } from "./compute-graph/index.js";

export {
  createMissingDependencyError,
  createMissingDefinitionError,
  createFunctionExecutionError,
  createEmptySequenceError,
  createMissingValueError,
  isGraphExecutionError,
} from "./compute-graph/index.js";

// ── Exhaustiveness helper ─────────────────────────────────────────────────────
export { assertNever } from "./util/brand.js";

// ── Builder API ───────────────────────────────────────────────────────────────
export { ctx, combine, pipe, cond, val, ref } from "./compute-graph/builder/index.js";

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
} from "./compute-graph/builder/index.js";

export { isBuilderValidationError } from "./compute-graph/builder/index.js";

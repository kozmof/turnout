import type {
  ExecutionContext,
  ValueId,
  FuncId,
  CombineDefineId,
  PipeDefineId,
  CondDefineId,
  PipeStepBinding,
  PipeArgBinding,
  TransformFnNames,
  BinaryFnNames,
} from '../types';
import type {
  ContextSpec,
  BuildResult,
  ValueLiteral,
  FunctionBuilder,
  CombineBuilder,
  PipeBuilder,
  CondBuilder,
  ContextBuilder as BuilderState,
  ValueRef,
  ValueInputRef,
  FuncOutputRef,
  StepOutputRef,
  TransformRef,
} from './types';
import { buildNumber, buildString, buildBoolean, buildNull, buildArray } from '../../state-control/value-builders';
import type { AnyValue, BaseTypeSymbol } from '../../state-control/value';
import { isValidValue } from '../../state-control/value';
import { getBinaryFnReturnType } from '../runtime/typeInference';
import {
  createUndefinedConditionError,
  createUndefinedBranchError,
  createUndefinedValueReferenceError,
  createUndefinedPipeArgumentError,
  createUndefinedPipeStepReferenceError,
} from './errors';
import type {
  TransformFnBooleanNameSpace,
} from '../../state-control/preset-funcs/boolean/transformFn';
import type {
  TransformFnNullNameSpace,
} from '../../state-control/preset-funcs/null/transformFn';
import type {
  TransformFnNumberNameSpace,
} from '../../state-control/preset-funcs/number/transformFn';
import type {
  TransformFnStringNameSpace,
} from '../../state-control/preset-funcs/string/transformFn';
import type {
  TransformFnArrayNameSpace,
} from '../../state-control/preset-funcs/array/transformFn';
import { NAMESPACE_DELIMITER } from '../../util/constants';
import { IdGenerator } from '../../util/idGenerator';
import {
  createValueId,
  createFuncId,
  createPipeArgName,
} from '../idValidation';

/**
 * ID Factory - Generates hash-based IDs and tracks metadata.
 * Replaces semantic ID patterns with opaque hashes.
 */
const IdFactory = {
  createStepOutput(
    parentFuncId: FuncId,
    stepIndex: number,
    state: BuilderState
  ): ValueId {
    const stepOutputId = IdGenerator.generateValueId();

    // Store metadata instead of encoding in ID
    state.stepMetadata[stepOutputId] = {
      parentFuncId,
      stepIndex,
    };

    return stepOutputId;
  },

  createReturnValue(sourceFuncId: FuncId, state: BuilderState): ValueId {
    const returnValueId = IdGenerator.generateValueId();

    state.returnValueMetadata[returnValueId] = {
      sourceFuncId,
    };

    return returnValueId;
  },

  // Lookup helpers to replace parsing
  getStepMetadata(
    valueId: ValueId,
    state: BuilderState
  ): { parentFuncId: FuncId; stepIndex: number } | null {
    return state.stepMetadata[valueId] ?? null;
  },

  getReturnValueSource(
    valueId: ValueId,
    state: BuilderState
  ): FuncId | null {
    return state.returnValueMetadata[valueId]?.sourceFuncId ?? null;
  },

  isStepOutput(valueId: ValueId, state: BuilderState): boolean {
    return valueId in state.stepMetadata;
  },

  isFunctionOutput(valueId: ValueId, state: BuilderState): boolean {
    return valueId in state.returnValueMetadata;
  },
} as const;

/**
 * Safely gets a value from the valueTable, returning undefined if not found.
 */
function getValueFromTable(
  valueRef: ValueRef,
  valueTable: Record<string, AnyValue>
): AnyValue | undefined {
  return valueTable[valueRef];
}

const getFuncFromTable = (
  funcId: string,
  funcTable: BuilderState['funcTable']
): BuilderState['funcTable'][string] | undefined => {
  return funcTable[funcId]
}

const getCombineFuncDefFromTable = (
  defId: CombineDefineId | PipeDefineId | CondDefineId,
  combineFuncDefTable: BuilderState['combineFuncDefTable']
): BuilderState['combineFuncDefTable'][CombineDefineId] | undefined => {
  return combineFuncDefTable[defId]
}

/**
 * Gets the "pass" transform function name for a given base type symbol.
 * Pass transforms pass values through unchanged without modification.
 *
 * Constructs the name using the standard pattern from state-control/preset-funcs.
 */
function getPassTransformFn(typeSymbol: BaseTypeSymbol): TransformFnNames {
  switch (typeSymbol) {
    case 'boolean': {
      const namespace: TransformFnBooleanNameSpace = 'transformFnBoolean';
      return `${namespace}${NAMESPACE_DELIMITER}pass`;
    }
    case 'number': {
      const namespace: TransformFnNumberNameSpace = 'transformFnNumber';
      return `${namespace}${NAMESPACE_DELIMITER}pass`;
    }
    case 'string': {
      const namespace: TransformFnStringNameSpace = 'transformFnString';
      return `${namespace}${NAMESPACE_DELIMITER}pass`;
    }
    case 'null': {
      const namespace: TransformFnNullNameSpace = 'transformFnNull';
      return `${namespace}${NAMESPACE_DELIMITER}pass`;
    }
    case 'array': {
      const namespace: TransformFnArrayNameSpace = 'transformFnArray';
      return `${namespace}${NAMESPACE_DELIMITER}pass`;
    }
  }
}


/**
 * Phase 1: Value collection result
 */
type ValuePhaseResult = {
  readonly valueTable: Record<string, AnyValue>;
};

/**
 * Phase 2: Function processing state
 */
type FunctionPhaseState = {
  readonly valueTable: Record<string, AnyValue>;
  funcTable: BuilderState['funcTable'];
  combineFuncDefTable: BuilderState['combineFuncDefTable'];
  pipeFuncDefTable: BuilderState['pipeFuncDefTable'];
  condFuncDefTable: BuilderState['condFuncDefTable'];
  stepMetadata: BuilderState['stepMetadata'];
  returnValueMetadata: BuilderState['returnValueMetadata'];
  returnIdByFuncId: Record<string, ValueId>;
  stepOutputIdByFuncStep: Record<string, ValueId>;
  combineDefIdBySignature: Map<string, CombineDefineId>;
};

function getStepOutputLookupKey(funcId: string, stepIndex: number): string {
  return `${funcId}::${String(stepIndex)}`;
}

/**
 * Creates an ExecutionContext from a declarative specification.
 *
 * @param spec - Object mapping IDs to values or function builders
 * @returns BuildResult with execution context and typed IDs
 *
 * @example
 * ```typescript
 * const context = ctx({
 *   v1: 5,
 *   v2: 3,
 *   f1: combine('binaryFnNumber::add', { a: 'v1', b: 'v2' }),
 * });
 *
 * executeGraph(context.ids.f1, context.exec);
 * ```
 */
export function ctx<T extends ContextSpec>(spec: T): BuildResult<T> {
  // Phase 1: Collect all values
  const valuePhase = collectValues(spec);

  // Phase 2: Process all functions
  const functionPhase = processFunctions(spec, valuePhase);

  // Phase 3: Build execution context
  const exec = buildExecutionContext(functionPhase);

  // Build typed ID map
  const ids = buildIdMap(spec);

  return { exec, ids };
}

/**
 * Phase 1: Collect all literal values from the spec
 */
function collectValues(spec: ContextSpec): ValuePhaseResult {
  const valueTable: Record<string, AnyValue> = {};

  for (const [key, value] of Object.entries(spec)) {
    if (isValueLiteral(value)) {
      valueTable[key] = inferValue(value);
    }
  }

  return { valueTable };
}

/**
 * Looks up the pre-registered return ValueId for a function.
 * Used by process*Func functions after the registration pass has populated returnValueMetadata.
 */
function lookupReturnId(funcId: string, state: FunctionPhaseState): ValueId {
  const returnId = state.returnIdByFuncId[funcId];
  if (returnId !== undefined) return returnId;
  throw new Error(`No pre-registered return ID for function '${funcId}'`);
}

/**
 * Phase 2: Process all function builders
 *
 * Uses two passes to support forward references (e.g. ref.output('laterFunc')):
 *   Pass 1 – Index keys and register return value IDs for all functions so that
 *             cross-function references are order-independent.
 *   Pass 2 – Validate + process each function with the precomputed reference index.
 */
function processFunctions(
  spec: ContextSpec,
  valuePhase: ValuePhaseResult
): FunctionPhaseState {
  const state: FunctionPhaseState = {
    valueTable: valuePhase.valueTable,
    funcTable: {},
    combineFuncDefTable: {},
    pipeFuncDefTable: {},
    condFuncDefTable: {},
    stepMetadata: {},
    returnValueMetadata: {},
    returnIdByFuncId: {},
    stepOutputIdByFuncStep: {},
    combineDefIdBySignature: new Map(),
  };

  // Pass 1: build key index and register function return IDs
  const referenceIndex = buildReferenceIndexAndRegisterReturns(spec, state);

  // Pass 2: validate and process each function
  for (const [key, value] of Object.entries(spec)) {
    if (isFunctionBuilder(value)) {
      validateFunctionReference(
        key,
        value,
        referenceIndex.allKeys,
        referenceIndex.valueKeys,
        referenceIndex.functionKeys
      );
      processFunction(key, value, state);
    }
  }

  return state;
}

/**
 * Phase 3: Build the final execution context
 */
function buildExecutionContext(functionPhase: FunctionPhaseState): ExecutionContext {
  return {
    valueTable: functionPhase.valueTable,
    funcTable: functionPhase.funcTable,
    combineFuncDefTable: functionPhase.combineFuncDefTable,
    pipeFuncDefTable: functionPhase.pipeFuncDefTable,
    condFuncDefTable: functionPhase.condFuncDefTable,
  };
}

/**
 * Build typed ID map from spec
 */
function buildIdMap<T extends ContextSpec>(spec: T): BuildResult<T>['ids'] {
  const result = Object.keys(spec).reduce((acc, key) => {
    const id = isFunctionBuilder(spec[key]) ? createFuncId(key) : createValueId(key);
    acc[key as keyof T] = id;
    return acc;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  }, {} as Record<keyof T, ValueId | FuncId>);

  // The result shape matches BuildResult<T>['ids'] by construction
  // We validate each ID during creation, so this assertion is safe
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return result as BuildResult<T>['ids'];
}

/**
 * Reference index used during function validation/processing.
 */
type ReferenceIndex = {
  readonly allKeys: Set<string>;
  readonly valueKeys: Set<string>;
  readonly functionKeys: Set<string>;
};

/**
 * First pass over spec:
 * - categorizes keys (all/value/function)
 * - registers return IDs for functions
 */
function buildReferenceIndexAndRegisterReturns(
  spec: ContextSpec,
  state: FunctionPhaseState
): ReferenceIndex {
  const allKeys = new Set<string>();
  const valueKeys = new Set<string>();
  const functionKeys = new Set<string>();

  for (const [key, value] of Object.entries(spec)) {
    allKeys.add(key);
    if (isFunctionBuilder(value)) {
      functionKeys.add(key);
      const returnId = IdFactory.createReturnValue(createFuncId(key), state);
      state.returnIdByFuncId[key] = returnId;
    } else {
      valueKeys.add(key);
    }
  }

  return { allKeys, valueKeys, functionKeys };
}

/**
 * Validates a single function builder against the precomputed reference index.
 */
function validateFunctionReference(
  funcId: string,
  builder: FunctionBuilder,
  allKeys: Set<string>,
  valueKeys: Set<string>,
  functionKeys: Set<string>
): void {
  switch (builder.__type) {
    case 'cond':
      validateCondReferences(funcId, builder, allKeys, functionKeys);
      break;
    case 'combine':
      validateCombineReferences(funcId, builder, valueKeys, functionKeys);
      break;
    case 'pipe':
      validatePipeReferences(funcId, builder, valueKeys, functionKeys);
      break;
    default: {
      const _exhaustive: never = builder;
      throw new Error(`Unknown function type: ${(_exhaustive as FunctionBuilder).__type}`);
    }
  }
}

/**
 * Validates conditional function references
 */
function validateCondReferences(
  funcId: string,
  cond: CondBuilder,
  allKeys: Set<string>,
  functionKeys: Set<string>
): void {
  // Condition must reference a value or function
  if (!allKeys.has(cond.condition)) {
    throw createUndefinedConditionError(funcId, cond.condition);
  }

  // Branches must be functions
  if (!functionKeys.has(cond.then)) {
    throw createUndefinedBranchError(funcId, 'then', cond.then);
  }
  if (!functionKeys.has(cond.else)) {
    throw createUndefinedBranchError(funcId, 'else', cond.else);
  }
}

/**
 * Validates combine function references
 */
function validateCombineReferences(
  funcId: string,
  combine: CombineBuilder,
  valueKeys: Set<string>,
  functionKeys: Set<string>
): void {
  for (const [argName, ref] of Object.entries(combine.args)) {
    // Handle different reference types
    if (typeof ref === 'string') {
      // Direct value reference
      if (!valueKeys.has(ref)) {
        throw createUndefinedValueReferenceError(funcId, argName, ref);
      }
    } else if (ref.__type === 'value') {
      if (!valueKeys.has(ref.id)) {
        throw createUndefinedValueReferenceError(funcId, argName, ref.id);
      }
    } else if (ref.__type === 'funcOutput') {
      // Function output reference
      if (!functionKeys.has(ref.funcId)) {
        throw createUndefinedValueReferenceError(funcId, argName, ref.funcId);
      }
    } else if (ref.__type === 'stepOutput') {
      // Step output reference - validate the pipe function exists
      if (!functionKeys.has(ref.pipeFuncId)) {
        throw createUndefinedValueReferenceError(funcId, argName, ref.pipeFuncId);
      }
      // Note: We can't validate stepIndex here as we don't know how many steps the pipe has yet
    } else if (ref.__type === 'transform') {
      const valueRef = ref.valueRef;
      if (valueRef.__type === 'value') {
        if (!valueKeys.has(valueRef.id)) {
          throw createUndefinedValueReferenceError(funcId, argName, valueRef.id);
        }
      } else if (valueRef.__type === 'funcOutput') {
        if (!functionKeys.has(valueRef.funcId)) {
          throw createUndefinedValueReferenceError(funcId, argName, valueRef.funcId);
        }
      } else if (!functionKeys.has(valueRef.pipeFuncId)) {
        throw createUndefinedValueReferenceError(funcId, argName, valueRef.pipeFuncId);
      }
    }
  }
}

/**
 * Validates pipe function references
 */
function validatePipeReferences(
  funcId: string,
  pipe: PipeBuilder,
  valueKeys: Set<string>,
  functionKeys: Set<string>
): void {
  const pipeArgNames = new Set(Object.keys(pipe.argBindings));

  // Validate argument bindings
  for (const [argName, binding] of Object.entries(pipe.argBindings)) {
    if (!valueKeys.has(binding)) {
      throw createUndefinedPipeArgumentError(funcId, argName, binding);
    }
  }

  // Validate steps
  for (let i = 0; i < pipe.steps.length; i++) {
    const step = pipe.steps[i];
    if (step.__type === 'combine') {
      for (const [argName, ref] of Object.entries(step.args)) {
        // Handle different reference types
        if (typeof ref === 'string') {
          // Step arguments can reference:
          // 1. Pipe function arguments
          // 2. Values from the context
          const isPipeArg = pipeArgNames.has(ref);
          const isContextValue = valueKeys.has(ref);

          if (!isPipeArg && !isContextValue) {
            throw createUndefinedPipeStepReferenceError(funcId, i, argName, ref);
          }
        } else if (ref.__type === 'value') {
          const isPipeArg = pipeArgNames.has(ref.id);
          const isContextValue = valueKeys.has(ref.id);
          if (!isPipeArg && !isContextValue) {
            throw createUndefinedPipeStepReferenceError(funcId, i, argName, ref.id);
          }
        } else if (ref.__type === 'funcOutput') {
          if (!functionKeys.has(ref.funcId)) {
            throw createUndefinedPipeStepReferenceError(funcId, i, argName, ref.funcId);
          }
        } else if (ref.__type === 'stepOutput') {
          // Step output references are allowed within the same pipe function
          // Validate that it references this pipe function and a previous step
          if (ref.pipeFuncId !== funcId) {
            throw new Error(`Step ${i} of pipe function '${funcId}' references step from different pipe function '${ref.pipeFuncId}'`);
          }
          if (ref.stepIndex >= i) {
            throw new Error(`Step ${i} of pipe function '${funcId}' references step ${ref.stepIndex} which is not a previous step`);
          }
        } else if (ref.__type === 'transform') {
          // Transform reference - validate the inner value
          if (ref.valueRef.__type === 'value') {
            const isPipeArg = pipeArgNames.has(ref.valueRef.id);
            const isContextValue = valueKeys.has(ref.valueRef.id);

            if (!isPipeArg && !isContextValue) {
              throw createUndefinedPipeStepReferenceError(funcId, i, argName, ref.valueRef.id);
            }
          } else if (ref.valueRef.__type === 'funcOutput') {
            if (!functionKeys.has(ref.valueRef.funcId)) {
              throw createUndefinedPipeStepReferenceError(funcId, i, argName, ref.valueRef.funcId);
            }
          } else if (ref.valueRef.__type === 'stepOutput') {
            // Validate step output in transform
            if (ref.valueRef.pipeFuncId !== funcId) {
              throw new Error(`Step ${i} of pipe function '${funcId}' references step from different pipe function '${ref.valueRef.pipeFuncId}'`);
            }
            if (ref.valueRef.stepIndex >= i) {
              throw new Error(`Step ${i} of pipe function '${funcId}' references step ${ref.valueRef.stepIndex} which is not a previous step`);
            }
          }
        }
      }
    }
  }
}

/**
 * Checks if a value is a literal (number, string, boolean, null, or AnyValue).
 */
function isValueLiteral(value: unknown): value is ValueLiteral {
  if (typeof value === 'number') return true;
  if (typeof value === 'string') return true;
  if (typeof value === 'boolean') return true;
  if (value === null) return true;
  if (Array.isArray(value)) return true;
  if (
    typeof value === 'object' &&
    value !== null &&
    'symbol' in value &&
    'value' in value
  ) {
    return true;
  }
  return false;
}

/**
 * Checks if a value is a function builder.
 */
function isFunctionBuilder(value: unknown): value is FunctionBuilder {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__type' in value &&
    (value.__type === 'combine' || value.__type === 'pipe' || value.__type === 'cond')
  );
}

/**
 * Type guard to check if a value is already an AnyValue.
 * Uses the existing isValidValue function for consistent validation.
 */
function isAnyValue(value: unknown): value is AnyValue {
  return isValidValue<AnyValue>(value);
}

/**
 * Infers AnyValue from JavaScript literal.
 */
function inferValue(literal: ValueLiteral): AnyValue {
  if (typeof literal === 'number') {
    return buildNumber(literal);
  }
  if (typeof literal === 'string') {
    return buildString(literal);
  }
  if (typeof literal === 'boolean') {
    return buildBoolean(literal);
  }
  if (literal === null) {
    return buildNull('unknown');
  }
  // Check if it's a JavaScript array that needs to be wrapped
  if (Array.isArray(literal)) {
    return buildArray(literal);
  }
  // Already an AnyValue - use type guard to narrow
  if (isAnyValue(literal)) {
    return literal;
  }
  // This should never happen given ValueLiteral type constraints
  throw new Error(`Unexpected literal type: ${typeof literal}`);
}

/**
 * Processes a function builder and adds it to the context.
 * Uses discriminated union for type-safe dispatch.
 */
function processFunction(
  id: string,
  builder: FunctionBuilder,
  state: FunctionPhaseState
): void {
  switch (builder.__type) {
    case 'combine':
      processCombineFunc(id, builder, state);
      break;
    case 'pipe':
      processPipeFunc(id, builder, state);
      break;
    case 'cond':
      processCondFunc(id, builder, state);
      break;
    default: {
      // Exhaustiveness check - ensures all cases are handled
      const _exhaustive: never = builder;
      throw new Error(`Unknown function type: ${(_exhaustive as FunctionBuilder).__type}`);
    }
  }
}


/**
 * Processes a CombineFunc builder.
 */
function processCombineFunc(
  funcId: string,
  builder: CombineBuilder,
  state: FunctionPhaseState
): void {
  const returnId = lookupReturnId(funcId, state);

  // Build argMap and transformFn from args
  const { argMap, transformFnMap } = buildCombineArguments(builder, state);
  const defId = getOrCreateCombineDefinitionId(builder.name, transformFnMap, state);

  // Add to function table (Fix 2: include kind discriminant)
  state.funcTable[funcId] = {
    kind: 'combine',
    defId,
    argMap,
    returnId,
  };
}

/**
 * Type guard to check if a reference is a FuncOutputRef.
 */
function isFuncOutputRef(ref: ValueInputRef | TransformRef): ref is FuncOutputRef {
  return typeof ref === 'object' && ref.__type === 'funcOutput';
}

/**
 * Type guard to check if a reference is a StepOutputRef.
 */
function isStepOutputRef(ref: ValueInputRef | TransformRef): ref is StepOutputRef {
  return typeof ref === 'object' && ref.__type === 'stepOutput';
}

/**
 * Resolves a FuncOutputRef to the actual return ValueId.
 * Looks up the return ID from the metadata table.
 */
function resolveFuncOutputRef(ref: FuncOutputRef, state: FunctionPhaseState): ValueId {
  const returnId = state.returnIdByFuncId[ref.funcId];
  if (returnId !== undefined) return returnId;
  throw new Error(`Cannot resolve function output reference: function '${ref.funcId}' has no return value`);
}

/**
 * Resolves a StepOutputRef to the actual step output ValueId.
 * Looks up the step output ID from the metadata table.
 */
function resolveStepOutputRef(ref: StepOutputRef, state: FunctionPhaseState): ValueId {
  const lookupKey = getStepOutputLookupKey(ref.pipeFuncId, ref.stepIndex);
  const stepOutputId = state.stepOutputIdByFuncStep[lookupKey];
  if (stepOutputId !== undefined) return stepOutputId;
  throw new Error(`Cannot resolve step output reference: pipe function '${ref.pipeFuncId}' step ${ref.stepIndex} has no output value`);
}

/**
 * Resolves any value reference (ValueRef, FuncOutputRef, StepOutputRef, or TransformRef) to a ValueId.
 */
function resolveValueReference(
  ref: ValueInputRef | TransformRef,
  state: FunctionPhaseState
): ValueId {
  if (isTransformRef(ref)) {
    const valueRef = ref.valueRef;
    if (valueRef.__type === 'value') {
      return createValueId(valueRef.id);
    }
    if (valueRef.__type === 'funcOutput') {
      return resolveFuncOutputRef(valueRef, state);
    }
    return resolveStepOutputRef(valueRef, state);
  }

  if (isFuncOutputRef(ref)) {
    return resolveFuncOutputRef(ref, state);
  }

  if (isStepOutputRef(ref)) {
    return resolveStepOutputRef(ref, state);
  }

  if (typeof ref === 'object' && ref.__type === 'value') {
    return createValueId(ref.id);
  }

  // Direct ValueRef string
  return createValueId(ref);
}

/**
 * Builds argument mappings and transform functions for a combine function
 */
function buildCombineArguments(
  builder: CombineBuilder,
  state: FunctionPhaseState
): {
  argMap: Record<string, ValueId>;
  transformFnMap: Record<string, TransformFnNames>;
} {
  const argMap: Record<string, ValueId> = {};
  // Fix 4: flatten to TransformFnNames directly (no { name } wrapper)
  const transformFnMap: Record<string, TransformFnNames> = {};

  for (const [key, ref] of Object.entries(builder.args)) {
    if (isTransformRef(ref)) {
      argMap[key] = resolveValueReference(ref, state);
      transformFnMap[key] = ref.transformFn;
    } else {
      argMap[key] = resolveValueReference(ref, state);
      transformFnMap[key] = inferPassTransform(ref, state);
    }
  }

  return { argMap, transformFnMap };
}

/**
 * Builds a combine function definition with configurable argument structure
 */
function buildCombineDefinition(
  name: CombineBuilder['name'],
  transformFnMap: Record<string, TransformFnNames>
): {
  name: CombineBuilder['name'];
  // Fix 4: transformFn values are TransformFnNames directly (no { name } wrapper)
  transformFn: { a: TransformFnNames; b: TransformFnNames };
  args: { a: true; b: true };
} {
  return {
    name,
    transformFn: {
      a: transformFnMap['a'],
      b: transformFnMap['b'],
    },
    args: {
      a: true,
      b: true,
    },
  };
}

/**
 * Processes a PipeFunc builder.
 */
function processPipeFunc(
  funcId: string,
  builder: PipeBuilder,
  state: FunctionPhaseState
): void {
  const defId = IdGenerator.generatePipeDefineId();
  const returnId = lookupReturnId(funcId, state);

  // Build argument map from the bindings provided in the builder
  const { argMap, pipeDefArgs } = buildPipeArguments(builder);

  // Process each step in the sequence
  const sequence = buildPipeSequence(funcId, builder, state);

  state.funcTable[funcId] = {
    kind: 'pipe',
    defId,
    argMap,
    returnId,
  };

  state.pipeFuncDefTable[defId] = {
    args: pipeDefArgs,
    sequence,
  };
}

/**
 * Builds argument mappings for a pipe function
 */
function buildPipeArguments(
  builder: PipeBuilder
): { argMap: Record<string, ValueId>; pipeDefArgs: Record<string, true> } {
  const argMap: Record<string, ValueId> = {};
  const pipeDefArgs: Record<string, true> = {};

  for (const [argName, valueRef] of Object.entries(builder.argBindings)) {
    argMap[argName] = createValueId(valueRef);
    pipeDefArgs[argName] = true;
  }

  return { argMap, pipeDefArgs };
}

/**
 * Builds the sequence of steps for a pipe function
 */
function buildPipeSequence(
  funcId: string,
  builder: PipeBuilder,
  state: FunctionPhaseState
): PipeStepBinding[] {
  const sequence: PipeStepBinding[] = [];

  for (let i = 0; i < builder.steps.length; i++) {
    const step = builder.steps[i];

    if (step.__type === 'combine') {
      // Create step output ID and track in metadata
      const stepOutputId = IdFactory.createStepOutput(funcId as FuncId, i, state);
      state.stepOutputIdByFuncStep[getStepOutputLookupKey(funcId, i)] = stepOutputId;

      // Store the step's return type so inferPassTransform can resolve StepOutputRefs
      const stepReturnType = getBinaryFnReturnType(step.name);
      if (stepReturnType !== null) {
        state.stepMetadata[stepOutputId].returnType = stepReturnType;
      }

      const stepBinding = buildPipeStepBinding(step, builder, state);
      sequence.push(stepBinding);
    }
  }

  return sequence;
}

/**
 * Builds a single step binding for a pipe function
 */
function buildPipeStepBinding(
  step: CombineBuilder,
  pipeBuilder: PipeBuilder,
  state: FunctionPhaseState
): PipeStepBinding {
  // Build argument bindings for this step
  const argBindings = buildStepArgBindings(step, pipeBuilder, state);

  // Infer transform functions for each argument
  const transformFnMap = buildStepTransformMap(step, pipeBuilder);
  const stepDefId = getOrCreateCombineDefinitionId(step.name, transformFnMap, state);

  return {
    defId: stepDefId,
    argBindings,
  };
}

/**
 * Builds argument bindings for a single pipe step
 */
function buildStepArgBindings(
  step: CombineBuilder,
  pipeBuilder: PipeBuilder,
  state: FunctionPhaseState
): Record<string, PipeArgBinding> {
  const argBindings: Record<string, PipeArgBinding> = {};

  for (const [argName, ref] of Object.entries(step.args)) {
    // Handle StepOutputRef - use step binding
    if (typeof ref === 'object' && ref.__type === 'stepOutput') {
      // Step outputs are referenced by step index, not ValueId
      // The actual ValueId will be created at runtime
      argBindings[argName] = {
        source: 'step',
        stepIndex: ref.stepIndex,
      };
      continue;
    }

    // Handle FuncOutputRef - resolve to actual ValueId
    if (typeof ref === 'object' && ref.__type === 'funcOutput') {
      const id = resolveFuncOutputRef(ref, state);
      argBindings[argName] = {
        source: 'value',
        id,
      };
      continue;
    }

    if (typeof ref === 'object' && ref.__type === 'value') {
      argBindings[argName] = resolveArgBinding(ref.id, pipeBuilder);
      continue;
    }

    // Handle TransformRef
    if (typeof ref === 'object' && ref.__type === 'transform') {
      let id: ValueId;
      if (ref.valueRef.__type === 'value') {
        // Simple string reference - resolve through normal path
        const binding = resolveArgBinding(ref.valueRef.id, pipeBuilder);
        argBindings[argName] = binding;
        continue;
      } else if (ref.valueRef.__type === 'funcOutput') {
        id = resolveFuncOutputRef(ref.valueRef, state);
      } else {
        // StepOutputRef in TransformRef
        id = resolveStepOutputRef(ref.valueRef, state);
      }
      argBindings[argName] = {
        source: 'value',
        id,
      };
      continue;
    }

    // Plain string reference - pipe arg or context value
    argBindings[argName] = resolveArgBinding(ref, pipeBuilder);
  }

  return argBindings;
}

/**
 * Resolves how a step argument should be bound to its value source.
 * Note: StepOutputRef is handled directly in buildStepArgBindings, so this
 * only processes plain string references (pipe args or context values).
 */
function resolveArgBinding(
  refStr: string,
  pipeBuilder: PipeBuilder
): PipeArgBinding {
  // Check if it's an argument to the pipe function
  if (Object.prototype.hasOwnProperty.call(pipeBuilder.argBindings, refStr)) {
    return {
      source: 'input',
      argName: createPipeArgName(refStr),
    };
  }

  // Otherwise it's a value reference from the context
  return {
    source: 'value',
    id: createValueId(refStr),
  };
}

/**
 * Builds transform function map for a step
 */
function buildStepTransformMap(
  step: CombineBuilder,
  pipeBuilder: PipeBuilder
): Record<string, TransformFnNames> {
  const transformFnMap: Record<string, TransformFnNames> = {};

  for (const [argName, ref] of Object.entries(step.args)) {
    if (isTransformRef(ref)) {
      transformFnMap[argName] = ref.transformFn;
    } else if (isStepOutputRef(ref)) {
      // Infer transform from the referenced step's return type, not the current step's namespace
      const referencedStep = pipeBuilder.steps[ref.stepIndex];
      transformFnMap[argName] =
        referencedStep?.__type === 'combine'
          ? inferTransformForBinaryFn(referencedStep.name)
          : getPassTransformFn('number'); // fallback: nested pipe steps not yet typed
    } else {
      transformFnMap[argName] = inferTransformForBinaryFn(step.name);
    }
  }

  return transformFnMap;
}

/**
 * Processes a CondFunc builder.
 */
function processCondFunc(
  funcId: string,
  builder: CondBuilder,
  state: FunctionPhaseState
): void {
  const defId = IdGenerator.generateCondDefineId();
  const returnId = lookupReturnId(funcId, state);

  state.funcTable[funcId] = {
    kind: 'cond',
    defId,
    returnId,
  };

  // Condition can be either a FuncId or ValueId — discriminate at build time
  const conditionId = builder.condition in state.funcTable
    ? { source: 'func' as const, id: createFuncId(builder.condition) }
    : { source: 'value' as const, id: createValueId(builder.condition) };

  state.condFuncDefTable[defId] = {
    conditionId,
    trueBranchId: createFuncId(builder.then),
    falseBranchId: createFuncId(builder.else),
  };
}

/**
 * Checks if reference is a transform reference.
 */
function isTransformRef(ref: ValueInputRef | TransformRef): ref is TransformRef {
  return typeof ref === 'object' && ref.__type === 'transform';
}

/**
 * Infers the appropriate "pass" transform for a value reference using lookup table.
 */
function inferPassTransform(
  ref: ValueInputRef,
  state: FunctionPhaseState
): TransformFnNames {
  // Handle FuncOutputRef
  if (typeof ref === 'object' && ref.__type === 'funcOutput') {
    const funcEntry = getFuncFromTable(ref.funcId, state.funcTable);

    if (funcEntry) {
      // Get the definition to infer the return type
      const def = getCombineFuncDefFromTable(funcEntry.defId, state.combineFuncDefTable);
      if (def) {
        // Infer transform from the binary function's return type
        return inferTransformForBinaryFn(def.name);
      }
    }

    throw new Error(`Function ${ref.funcId} not found or has no definition`);
  }

  // Handle StepOutputRef
  if (typeof ref === 'object' && ref.__type === 'stepOutput') {
    const stepOutputId = state.stepOutputIdByFuncStep[
      getStepOutputLookupKey(ref.pipeFuncId, ref.stepIndex)
    ];
    if (stepOutputId !== undefined) {
      const metadata = state.stepMetadata[stepOutputId];
      if (metadata?.returnType !== undefined) {
        return getPassTransformFn(metadata.returnType);
      }
    }
    throw new Error(`Cannot infer transform: no return type recorded for step output (pipe '${ref.pipeFuncId}', step ${String(ref.stepIndex)})`);
  }

  if (typeof ref === 'object' && ref.__type === 'value') {
    const value = getValueFromTable(ref.id, state.valueTable);
    if (value) {
      return getPassTransformFn(value.symbol);
    }
    throw new Error(`Value ${ref.id} not found in valueTable`);
  }

  // Handle ValueRef (string)
  const value = getValueFromTable(ref, state.valueTable);

  // If value exists in valueTable, use its type
  if (value) {
    return getPassTransformFn(value.symbol);
  }

  // Value should exist in table by this point in processing
  throw new Error(`Value ${ref} not found in valueTable`);
}

/**
 * Infers the appropriate transform function based on the binary function name.
 * Uses getBinaryFnReturnType for accurate type resolution (handles generic functions correctly).
 */
function inferTransformForBinaryFn(binaryFnName: BinaryFnNames): TransformFnNames {
  const returnType = getBinaryFnReturnType(binaryFnName);
  if (returnType === null) {
    throw new Error(`Cannot infer transform: unknown return type for binary function '${binaryFnName}'`);
  }
  return getPassTransformFn(returnType);
}

function createCombineDefSignature(
  name: CombineBuilder['name'],
  transformFnMap: Record<string, TransformFnNames>
): string {
  const transformA = transformFnMap['a'];
  const transformB = transformFnMap['b'];
  return `${name}|a:${transformA}|b:${transformB}`;
}

function getOrCreateCombineDefinitionId(
  name: CombineBuilder['name'],
  transformFnMap: Record<string, TransformFnNames>,
  state: FunctionPhaseState
): CombineDefineId {
  const signature = createCombineDefSignature(name, transformFnMap);
  const existing = state.combineDefIdBySignature.get(signature);
  if (existing !== undefined) return existing;

  const defId = IdGenerator.generateCombineDefineId();
  state.combineFuncDefTable[defId] = buildCombineDefinition(name, transformFnMap);
  state.combineDefIdBySignature.set(signature, defId);
  return defId;
}

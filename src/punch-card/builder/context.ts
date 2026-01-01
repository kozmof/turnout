import type {
  ExecutionContext,
  ValueId,
  FuncId,
  PlugDefineId,
  TapDefineId,
  CondDefineId,
  InterfaceArgId,
  TapStepBinding,
  TapArgBinding,
  TransformFnNames,
  BinaryFnNames,
  BinaryFnNamespaces,
} from '../types';
import type {
  ContextSpec,
  BuildResult,
  ValueLiteral,
  FunctionBuilder,
  PlugBuilder,
  TapBuilder,
  CondBuilder,
  ContextBuilder as BuilderState,
  ValueRef,
  TransformRef,
} from './types';
import { buildNumber, buildString, buildBoolean, buildArray } from '../../state-control/value-builders';
import type { AnyValue, BaseTypeSymbol } from '../../state-control/value';
import { isValidValue } from '../../state-control/value';
import { buildReturnIdToFuncIdMap } from '../runtime/buildExecutionTree';
import {
  createUndefinedConditionError,
  createUndefinedBranchError,
  createUndefinedValueReferenceError,
  createUndefinedTapArgumentError,
  createUndefinedTapStepReferenceError,
} from './errors';
import type {
  TransformFnNumberNameSpace,
} from '../../state-control/preset-funcs/number/transformFn';
import type {
  TransformFnStringNameSpace,
} from '../../state-control/preset-funcs/string/transformFn';
import type {
  TransformFnArrayNameSpace,
} from '../../state-control/preset-funcs/array/transformFn';
import { splitPairBinaryFnNames } from '../../util/splitPair';

/**
 * Type assertions for creating branded ID types at entry points.
 * These validate and assert the type for entry point creation.
 * For internal conversions where we know the type is correct, we just assert.
 */
const createValueId = (id: string): ValueId => {
  // Entry point: validate that id is a valid string
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`Invalid ValueId: ${id}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return id as ValueId;
};

const createFuncId = (id: string): FuncId => {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`Invalid FuncId: ${id}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return id as FuncId;
};

// TODO check an id pattern
const createPlugDefineId = (id: string): PlugDefineId => {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`Invalid PlugDefineId: ${id}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return id as PlugDefineId;
};

// TODO check an id pattern
const createTapDefineId = (id: string): TapDefineId => {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`Invalid TapDefineId: ${id}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return id as TapDefineId;
};

// TODO check an id pattern
const createCondDefineId = (id: string): CondDefineId => {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`Invalid CondDefineId: ${id}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return id as CondDefineId;
};

// TODO check an id pattern
const createInterfaceArgId = (id: string): InterfaceArgId => {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`Invalid InterfaceArgId: ${id}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return id as InterfaceArgId;
};

/**
 * ID Schema - Centralized ID generation patterns
 */
const IdSchema = {
  plugDefine: (counter: number): PlugDefineId => createPlugDefineId(`pd${String(counter)}`),
  tapDefine: (counter: number): TapDefineId => createTapDefineId(`td${String(counter)}`),
  condDefine: (counter: number): CondDefineId => createCondDefineId(`cd${String(counter)}`),
  returnValue: (funcId: string): ValueId => createValueId(`${funcId}__out`),
  stepOutput: (funcId: string, stepIndex: number): ValueId =>
    createValueId(`${funcId}__step${String(stepIndex)}__out`),
  interfaceArg: (funcId: string, argName: string): InterfaceArgId =>
    createInterfaceArgId(`${funcId}__ia_${argName}`),
  parseStepOutput: (id: string): { funcId: string; stepIndex: number } | null => {
    const match = id.match(/^(.+)__step(\d+)__out$/);
    return match ? { funcId: match[1], stepIndex: parseInt(match[2]) } : null;
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

/**
 * Gets the "pass" transform function name for a given base type symbol.
 * Pass transforms pass values through unchanged without modification.
 *
 * Constructs the name using the standard pattern from state-control/preset-funcs.
 */
function getPassTransformFn(typeSymbol: BaseTypeSymbol): TransformFnNames {
  // Boolean values use number transforms since they don't have their own transform namespace
  if (typeSymbol === 'boolean') {
    const namespace: TransformFnNumberNameSpace = 'transformFnNumber';
    return `${namespace}::pass`;
  }

  switch (typeSymbol) {
    case 'number': {
      const namespace: TransformFnNumberNameSpace = 'transformFnNumber';
      return `${namespace}::pass`;
    }
    case 'string': {
      const namespace: TransformFnStringNameSpace = 'transformFnString';
      return `${namespace}::pass`;
    }
    case 'array': {
      const namespace: TransformFnArrayNameSpace = 'transformFnArray';
      return `${namespace}::pass`;
    }
  }
}

/**
 * Maps binary function namespaces to their corresponding base type symbols.
 * Used to infer the correct pass transform from function names.
 */
const BinaryFnNamespaceToType: Record<BinaryFnNamespaces, BaseTypeSymbol> = {
  binaryFnNumber: 'number',
  binaryFnString: 'string',
  binaryFnArray: 'array',
  binaryFnGeneric: 'number', // default to number for generic
} as const;

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
  plugFuncDefTable: BuilderState['plugFuncDefTable'];
  tapFuncDefTable: BuilderState['tapFuncDefTable'];
  condFuncDefTable: BuilderState['condFuncDefTable'];
  nextDefId: number;
};

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
 *   f1: plug('binaryFnNumber::add', { a: 'v1', b: 'v2' }),
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
 * Phase 2: Process all function builders
 */
function processFunctions(
  spec: ContextSpec,
  valuePhase: ValuePhaseResult
): FunctionPhaseState {
  const state: FunctionPhaseState = {
    valueTable: valuePhase.valueTable,
    funcTable: {},
    plugFuncDefTable: {},
    tapFuncDefTable: {},
    condFuncDefTable: {},
    nextDefId: 0,
  };

  // Validate function references before processing
  validateFunctionReferences(spec);

  for (const [key, value] of Object.entries(spec)) {
    if (isFunctionBuilder(value)) {
      processFunction(key, value, state);
    }
  }

  return state;
}

/**
 * Phase 3: Build the final execution context
 */
function buildExecutionContext(functionPhase: FunctionPhaseState): ExecutionContext {
  const exec: ExecutionContext = {
    valueTable: functionPhase.valueTable,
    funcTable: functionPhase.funcTable,
    plugFuncDefTable: functionPhase.plugFuncDefTable,
    tapFuncDefTable: functionPhase.tapFuncDefTable,
    condFuncDefTable: functionPhase.condFuncDefTable,
    returnIdToFuncId: new Map(),
  };

  if (Object.keys(functionPhase.funcTable).length > 0) {
    exec.returnIdToFuncId = buildReturnIdToFuncIdMap(exec);
  }

  return exec;
}

/**
 * Build typed ID map from spec
 */
function buildIdMap<T extends ContextSpec>(spec: T): BuildResult<T>['ids'] {
  const result = Object.keys(spec).reduce((acc, key) => {
    const id = isFunctionBuilder(spec[key]) ? createFuncId(key) : createValueId(key);
    acc[key as keyof T] = id;
    return acc;
  }, {} as Record<keyof T, ValueId | FuncId>);

  // The result shape matches BuildResult<T>['ids'] by construction
  // We validate each ID during creation, so this assertion is safe
  return result as BuildResult<T>['ids'];
}

/**
 * Validates that all function references are valid and resolved in correct order
 */
function validateFunctionReferences(spec: ContextSpec): void {
  const allKeys = new Set(Object.keys(spec));
  const valueKeys = new Set<string>();
  const functionKeys = new Set<string>();

  // First pass: categorize keys
  for (const [key, value] of Object.entries(spec)) {
    if (isFunctionBuilder(value)) {
      functionKeys.add(key);
    } else {
      valueKeys.add(key);
    }
  }

  // Second pass: validate references
  for (const [key, value] of Object.entries(spec)) {
    if (isFunctionBuilder(value)) {
      switch (value.__type) {
        case 'cond':
          validateCondReferences(key, value, allKeys, functionKeys);
          break;
        case 'plug':
          validatePlugReferences(key, value, valueKeys);
          break;
        case 'tap':
          validateTapReferences(key, value, valueKeys);
          break;
      }
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
 * Validates plug function references
 */
function validatePlugReferences(
  funcId: string,
  plug: PlugBuilder,
  valueKeys: Set<string>
): void {
  for (const [argName, ref] of Object.entries(plug.args)) {
    const refStr = typeof ref === 'string' ? ref : ref.valueId;

    // Each argument must reference a value
    // This includes:
    // 1. Direct values in valueKeys
    // 2. Function return values (pattern: functionId__out)
    const isDirectValue = valueKeys.has(refStr);
    const isFunctionOutput = refStr.endsWith('__out');

    if (!isDirectValue && !isFunctionOutput) {
      throw createUndefinedValueReferenceError(funcId, argName, refStr);
    }
  }
}

/**
 * Validates tap function references
 */
function validateTapReferences(
  funcId: string,
  tap: TapBuilder,
  valueKeys: Set<string>
): void {
  // Validate argument bindings
  for (const [argName, binding] of Object.entries(tap.argBindings)) {
    if (!valueKeys.has(binding)) {
      throw createUndefinedTapArgumentError(funcId, argName, binding);
    }
  }

  // Validate steps
  for (let i = 0; i < tap.steps.length; i++) {
    const step = tap.steps[i];
    if (step.__type === 'plug') {
      for (const [argName, ref] of Object.entries(step.args)) {
        const refStr = typeof ref === 'string' ? ref : ref.valueId;

        // Step arguments can reference:
        // 1. Tap function arguments
        // 2. Previous step outputs (special naming pattern)
        // 3. Values from the context
        const isTapArg = tap.args.some(arg => arg.name === refStr);
        const isStepOutput = IdSchema.parseStepOutput(refStr) !== null;
        const isContextValue = valueKeys.has(refStr);

        if (!isTapArg && !isStepOutput && !isContextValue) {
          throw createUndefinedTapStepReferenceError(funcId, i, argName, refStr);
        }
      }
    }
  }
}

/**
 * Checks if a value is a literal (number, string, boolean, or AnyValue).
 */
function isValueLiteral(value: unknown): value is ValueLiteral {
  if (typeof value === 'number') return true;
  if (typeof value === 'string') return true;
  if (typeof value === 'boolean') return true;
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
    (value.__type === 'plug' || value.__type === 'tap' || value.__type === 'cond')
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
    case 'plug':
      processPlugFunc(id, builder, state);
      break;
    case 'tap':
      processTapFunc(id, builder, state);
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
 * Standard argument structure for binary plug functions
 */
const BINARY_INTERFACE_ARG_IDS = {
  a: createInterfaceArgId('ia1'),
  b: createInterfaceArgId('ia2'),
} as const;

/**
 * Processes a PlugFunc builder.
 */
function processPlugFunc(
  funcId: string,
  builder: PlugBuilder,
  state: FunctionPhaseState
): void {
  const defId = IdSchema.plugDefine(state.nextDefId++);
  const returnId = IdSchema.returnValue(funcId);

  // Build argMap and transformFn from args
  const { argMap, transformFnMap } = buildPlugArguments(builder, state);

  // Add to function table
  state.funcTable[funcId] = {
    defId,
    argMap,
    returnId,
  };

  // Add to definition table
  state.plugFuncDefTable[defId] = buildPlugDefinition(builder.name, transformFnMap);
}

/**
 * Builds argument mappings and transform functions for a plug function
 */
function buildPlugArguments(
  builder: PlugBuilder,
  state: FunctionPhaseState
): {
  argMap: Record<string, ValueId>;
  transformFnMap: Record<string, { name: TransformFnNames }>;
} {
  const argMap: Record<string, ValueId> = {};
  const transformFnMap: Record<string, { name: TransformFnNames }> = {};

  for (const [key, ref] of Object.entries(builder.args)) {
    if (isTransformRef(ref)) {
      argMap[key] = createValueId(ref.valueId);
      transformFnMap[key] = { name: ref.transformFn };
    } else {
      argMap[key] = createValueId(ref);
      transformFnMap[key] = { name: inferPassTransform(ref, state) };
    }
  }

  return { argMap, transformFnMap };
}

/**
 * Builds a plug function definition with configurable argument structure
 */
function buildPlugDefinition(
  name: PlugBuilder['name'],
  transformFnMap: Record<string, { name: TransformFnNames }>
): {
  name: PlugBuilder['name'];
  transformFn: { a: { name: TransformFnNames }; b: { name: TransformFnNames } };
  args: { a: InterfaceArgId; b: InterfaceArgId };
} {
  // Currently supports binary functions (a, b)
  // Future: Could be extended to support n-ary functions
  return {
    name,
    transformFn: {
      a: transformFnMap['a'],
      b: transformFnMap['b'],
    },
    args: BINARY_INTERFACE_ARG_IDS,
  };
}

/**
 * Processes a TapFunc builder.
 */
function processTapFunc(
  funcId: string,
  builder: TapBuilder,
  state: FunctionPhaseState
): void {
  const defId = IdSchema.tapDefine(state.nextDefId++);
  const returnId = IdSchema.returnValue(funcId);

  // Build argument map from the bindings provided in the builder
  const { argMap, tapDefArgs } = buildTapArguments(funcId, builder);

  // Process each step in the sequence
  const sequence = buildTapSequence(funcId, builder, state);

  state.funcTable[funcId] = {
    defId,
    argMap,
    returnId,
  };

  state.tapFuncDefTable[defId] = {
    args: tapDefArgs,
    sequence,
  };
}

/**
 * Builds argument mappings for a tap function
 */
function buildTapArguments(
  funcId: string,
  builder: TapBuilder
): { argMap: Record<string, ValueId>; tapDefArgs: Record<string, InterfaceArgId> } {
  const argMap: Record<string, ValueId> = {};
  const tapDefArgs: Record<string, InterfaceArgId> = {};

  for (const arg of builder.args) {
    const interfaceArgId = IdSchema.interfaceArg(funcId, arg.name);
    argMap[arg.name] = createValueId(builder.argBindings[arg.name]);
    tapDefArgs[arg.name] = interfaceArgId;
  }

  return { argMap, tapDefArgs };
}

/**
 * Builds the sequence of steps for a tap function
 */
function buildTapSequence(
  funcId: string,
  builder: TapBuilder,
  state: FunctionPhaseState
): TapStepBinding[] {
  const sequence: TapStepBinding[] = [];

  for (let i = 0; i < builder.steps.length; i++) {
    const step = builder.steps[i];

    if (step.__type === 'plug') {
      const stepBinding = buildTapStepBinding(funcId, step, builder, state);
      sequence.push(stepBinding);
    }
  }

  return sequence;
}

/**
 * Builds a single step binding for a tap function
 */
function buildTapStepBinding(
  funcId: string,
  step: PlugBuilder,
  tapBuilder: TapBuilder,
  state: FunctionPhaseState
): TapStepBinding {
  const stepDefId = IdSchema.plugDefine(state.nextDefId++);

  // Build argument bindings for this step
  const argBindings = buildStepArgBindings(funcId, step, tapBuilder);

  // Infer transform functions for each argument
  const transformFnMap = buildStepTransformMap(step);

  // Add plug definition to table (reuse buildPlugDefinition for consistency)
  state.plugFuncDefTable[stepDefId] = buildPlugDefinition(step.name, transformFnMap);

  return {
    defId: stepDefId,
    argBindings,
  };
}

/**
 * Builds argument bindings for a single tap step
 */
function buildStepArgBindings(
  funcId: string,
  step: PlugBuilder,
  tapBuilder: TapBuilder
): Record<string, TapArgBinding> {
  const argBindings: Record<string, TapArgBinding> = {};

  for (const [argName, ref] of Object.entries(step.args)) {
    const refStr = typeof ref === 'string' ? ref : ref.valueId;
    argBindings[argName] = resolveArgBinding(funcId, refStr, tapBuilder);
  }

  return argBindings;
}

/**
 * Resolves how a step argument should be bound to its value source
 */
function resolveArgBinding(
  funcId: string,
  refStr: string,
  tapBuilder: TapBuilder
): TapArgBinding {
  // Check if it's an argument to the tap function
  if (tapBuilder.args.some(arg => arg.name === refStr)) {
    return {
      source: 'input',
      argName: refStr,
    };
  }

  // Check if it's a reference to a previous step output
  const stepOutput = IdSchema.parseStepOutput(refStr);
  if (stepOutput && stepOutput.funcId === funcId) {
    return {
      source: 'step',
      stepIndex: stepOutput.stepIndex,
    };
  }

  // Otherwise it's a value reference
  return {
    source: 'value',
    valueId: createValueId(refStr),
  };
}

/**
 * Builds transform function map for a step
 */
function buildStepTransformMap(step: PlugBuilder): Record<string, { name: TransformFnNames }> {
  const transformFnMap: Record<string, { name: TransformFnNames }> = {};

  for (const [argName, ref] of Object.entries(step.args)) {
    if (isTransformRef(ref)) {
      transformFnMap[argName] = { name: ref.transformFn };
    } else {
      const inferredTransform = inferTransformForBinaryFn(step.name);
      transformFnMap[argName] = { name: inferredTransform };
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
  const defId = IdSchema.condDefine(state.nextDefId++);
  const returnId = IdSchema.returnValue(funcId);

  state.funcTable[funcId] = {
    defId,
    argMap: {},
    returnId,
  };

  // Condition can be either a ValueId or FuncId
  // Check if it exists in funcTable to determine which type to use
  const conditionId = builder.condition in state.funcTable
    ? createFuncId(builder.condition)
    : createValueId(builder.condition);

  state.condFuncDefTable[defId] = {
    conditionId,
    trueBranchId: createFuncId(builder.then),
    falseBranchId: createFuncId(builder.else),
  };
}

/**
 * Checks if reference is a transform reference.
 */
function isTransformRef(ref: ValueRef | TransformRef): ref is TransformRef {
  return typeof ref === 'object' && '__type' in ref;
}

/**
 * Infers the appropriate "pass" transform for a value reference using lookup table.
 */
function inferPassTransform(valueRef: ValueRef, state: FunctionPhaseState): TransformFnNames {
  const value = getValueFromTable(valueRef, state.valueTable);

  // If value exists in valueTable, use its type
  if (value) {
    return getPassTransformFn(value.symbol);
  }

  // TODO
  // If value doesn't exist, check if it's a function output reference
  if (valueRef.endsWith('__out')) {
    // Extract function ID from the output reference (e.g., "sum__out" -> "sum")
    const funcId = valueRef.slice(0, -5); // Remove "__out"
    const funcEntry = state.funcTable[funcId];

    if (funcEntry) {
      // Get the definition to infer the return type
      const def = state.plugFuncDefTable[funcEntry.defId];
      if (def) {
        // Infer transform from the binary function's return type
        return inferTransformForBinaryFn(def.name);
      }
    }
  }

  // Value should exist in table by this point in processing
  throw new Error(`Value ${valueRef} not found in valueTable`);
}

/**
 * Infers the appropriate transform function based on the binary function name using lookup table.
 */
function inferTransformForBinaryFn(binaryFnName: BinaryFnNames): TransformFnNames {
  // Extract namespace from the function name (e.g., 'binaryFnNumber::add' -> 'binaryFnNumber')
  const maySplit = splitPairBinaryFnNames(binaryFnName);
  if (maySplit === null) throw new Error();
  const namespace = maySplit[0]
  const typeSymbol = BinaryFnNamespaceToType[namespace];

  // Namespace should be defined for all valid binary functions
  return getPassTransformFn(typeSymbol);
}

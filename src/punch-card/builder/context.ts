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
import type { AnyValue } from '../../state-control/value';
import { isValidValue } from '../../state-control/value';
import { buildReturnIdToFuncIdMap } from '../runtime/buildExecutionTree';

/**
 * Factory functions for creating branded ID types.
 * These encapsulate the type assertions required for branded types.
 */
const createValueId = (id: string): ValueId => id as ValueId;
const createFuncId = (id: string): FuncId => id as FuncId;
const createPlugDefineId = (id: string): PlugDefineId => id as PlugDefineId;
const createTapDefineId = (id: string): TapDefineId => id as TapDefineId;
const createCondDefineId = (id: string): CondDefineId => id as CondDefineId;
const createInterfaceArgId = (id: string): InterfaceArgId => id as InterfaceArgId;

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
  const builder: BuilderState = {
    valueTable: {},
    funcTable: {},
    plugFuncDefTable: {},
    tapFuncDefTable: {},
    condFuncDefTable: {},
    nextDefId: 0,
  };

  // First pass: Process all values
  for (const [key, value] of Object.entries(spec)) {
    if (isValueLiteral(value)) {
      builder.valueTable[key] = inferValue(value);
    }
  }

  // Second pass: Process all functions
  for (const [key, value] of Object.entries(spec)) {
    if (isFunctionBuilder(value)) {
      processFunction(key, value, builder);
    }
  }

  // Build execution context
  const exec: ExecutionContext = {
    valueTable: builder.valueTable,
    funcTable: builder.funcTable,
    plugFuncDefTable: builder.plugFuncDefTable,
    tapFuncDefTable: builder.tapFuncDefTable,
    condFuncDefTable: builder.condFuncDefTable,
    returnIdToFuncId: new Map(),
  };

  // Now build the map with the full context
  if (Object.keys(builder.funcTable).length > 0) {
    exec.returnIdToFuncId = buildReturnIdToFuncIdMap(exec);
  }

  // Build typed ID map
  const ids = Object.keys(spec).reduce((acc, key) => {
    // Each key is either a ValueId or FuncId depending on what's in the spec
    const id = isFunctionBuilder(spec[key]) ? createFuncId(key) : createValueId(key);
    acc[key as keyof T] = id;
    return acc;
  }, {} as Record<keyof T, ValueId | FuncId>) as BuildResult<T>['ids'];

  return { exec, ids };
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
 */
function processFunction(
  id: string,
  builder: FunctionBuilder,
  state: BuilderState
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
  }
}

/**
 * Processes a PlugFunc builder.
 */
function processPlugFunc(
  funcId: string,
  builder: PlugBuilder,
  state: BuilderState
): void {
  const defId = createPlugDefineId(`pd${state.nextDefId++}`);
  const returnId = createValueId(`${funcId}__out`);

  // Build argMap and transformFn from args
  const argMap: Record<string, ValueId> = {};
  const transformFnMap: Record<string, { name: TransformFnNames }> = {};

  for (const [key, ref] of Object.entries(builder.args)) {
    if (isTransformRef(ref)) {
      argMap[key] = createValueId(ref.valueId);
      transformFnMap[key] = { name: ref.transformFn };
    } else {
      argMap[key] = createValueId(ref);
      transformFnMap[key] = { name: inferPassTransform(ref, state) as TransformFnNames };
    }
  }

  // Add to function table
  state.funcTable[funcId] = {
    defId,
    argMap,
    returnId,
  };

  // Add to definition table
  state.plugFuncDefTable[defId] = {
    name: builder.name,
    transformFn: {
      a: transformFnMap['a'],
      b: transformFnMap['b'],
    },
    args: {
      a: createInterfaceArgId('ia1'),
      b: createInterfaceArgId('ia2'),
    },
  };
}

/**
 * Processes a TapFunc builder.
 */
function processTapFunc(
  funcId: string,
  builder: TapBuilder,
  state: BuilderState
): void {
  const defId = createTapDefineId(`td${state.nextDefId++}`);
  const returnId = createValueId(`${funcId}__out`);

  // Build argument map from the bindings provided in the builder
  const argMap: Record<string, ValueId> = {};
  const tapDefArgs: Record<string, InterfaceArgId> = {};

  for (const arg of builder.args) {
    const interfaceArgId = createInterfaceArgId(`${funcId}__ia_${arg.name}`);

    // Use the binding from argBindings
    argMap[arg.name] = createValueId(builder.argBindings[arg.name]);
    tapDefArgs[arg.name] = interfaceArgId;
  }

  // Process each step in the sequence
  const sequence: TapStepBinding[] = [];
  for (let i = 0; i < builder.steps.length; i++) {
    const step = builder.steps[i];

    if (step.__type === 'plug') {
      // Create a unique plug definition for this step
      const stepDefId = createPlugDefineId(`pd${state.nextDefId++}`);

      // Build argBindings for this step
      const argBindings: Record<string, TapArgBinding> = {};

      for (const [argName, ref] of Object.entries(step.args)) {
        const refStr = typeof ref === 'string' ? ref : ref.valueId;

        // Check if it's an argument to the tap function
        if (builder.args.some(arg => arg.name === refStr)) {
          argBindings[argName] = {
            source: 'input',
            argName: refStr,
          };
        }
        // Check if it's a reference to a previous step output
        else if (refStr.startsWith(`${funcId}__step`)) {
          const match = refStr.match(/__step(\d+)__out$/);
          if (match) {
            argBindings[argName] = {
              source: 'step',
              stepIndex: parseInt(match[1]),
            };
          }
        }
        // Otherwise it's a value reference
        else {
          argBindings[argName] = {
            source: 'value',
            valueId: createValueId(refStr),
          };
        }
      }

      // Infer transform functions for each argument
      const transformFnMap: Record<string, { name: TransformFnNames }> = {};
      for (const [argName, ref] of Object.entries(step.args)) {
        if (isTransformRef(ref)) {
          transformFnMap[argName] = { name: ref.transformFn };
        } else {
          // Infer pass transform based on the function name
          const inferredTransform = inferTransformForBinaryFn(step.name);
          transformFnMap[argName] = { name: inferredTransform as TransformFnNames };
        }
      }

      // Add plug definition to table
      state.plugFuncDefTable[stepDefId] = {
        name: step.name,
        transformFn: {
          a: transformFnMap['a'],
          b: transformFnMap['b'],
        },
        args: {
          a: createInterfaceArgId('ia1'),
          b: createInterfaceArgId('ia2'),
        },
      };

      sequence.push({
        defId: stepDefId,
        argBindings,
      });
    }
  }

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
 * Processes a CondFunc builder.
 */
function processCondFunc(
  funcId: string,
  builder: CondBuilder,
  state: BuilderState
): void {
  const defId = createCondDefineId(`cd${state.nextDefId++}`);
  const returnId = createValueId(`${funcId}__out`);

  state.funcTable[funcId] = {
    defId,
    argMap: {},
    returnId,
  };

  // Condition can be either a ValueId or FuncId
  // Try as ValueId first, then FuncId if it exists in funcTable
  const conditionId = state.funcTable[builder.condition]
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
  return typeof ref === 'object' && '__type' in ref && ref.__type === 'transform';
}

/**
 * Infers the appropriate "pass" transform for a value reference.
 */
function inferPassTransform(valueRef: ValueRef, state: BuilderState): string {
  const value = state.valueTable[valueRef];
  if (!value) {
    // Default to number pass if value not found yet
    return 'transformFnNumber::pass';
  }

  switch (value.symbol) {
    case 'number':
      return 'transformFnNumber::pass';
    case 'string':
      return 'transformFnString::pass';
    case 'array':
      return 'transformFnArray::pass';
    default:
      return 'transformFnNumber::pass';
  }
}

/**
 * Infers the appropriate transform function based on the binary function name.
 */
function inferTransformForBinaryFn(binaryFnName: string): string {
  // Extract the type from the function name (e.g., 'binaryFnNumber::add' -> 'number')
  const match = binaryFnName.match(/^binaryFn(\w+)::/);
  if (!match) {
    return 'transformFnNumber::pass';
  }

  const type = match[1].toLowerCase();
  switch (type) {
    case 'number':
      return 'transformFnNumber::pass';
    case 'string':
      return 'transformFnString::pass';
    case 'array':
      return 'transformFnArray::pass';
    case 'generic':
      // Generic functions accept any type, default to number
      return 'transformFnNumber::pass';
    default:
      return 'transformFnNumber::pass';
  }
}

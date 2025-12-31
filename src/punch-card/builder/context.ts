import type {
  ExecutionContext,
  ValueId,
  FuncId,
  PlugDefineId,
  TapDefineId,
  CondDefineId,
  InterfaceArgId,
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
import { buildNumber, buildString, buildBoolean } from '../../state-control/value-builders';
import type { AnyValue } from '../../state-control/value';
import { buildReturnIdToFuncIdMap } from '../runtime/buildExecutionTree';

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

  // Build execution context (first without returnIdToFuncIdMap)
  const exec: ExecutionContext = {
    valueTable: builder.valueTable as any,
    funcTable: builder.funcTable as any,
    plugFuncDefTable: builder.plugFuncDefTable as any,
    tapFuncDefTable: builder.tapFuncDefTable as any,
    condFuncDefTable: builder.condFuncDefTable as any,
    returnIdToFuncId: undefined as any, // Temporary
  };

  // Now build the map with the full context
  exec.returnIdToFuncId = Object.keys(builder.funcTable).length > 0
    ? buildReturnIdToFuncIdMap(exec)
    : new Map();

  // Build typed ID map
  const ids = {} as any;
  for (const key of Object.keys(spec)) {
    ids[key] = key as any;
  }

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
  // Already an AnyValue or array
  return literal as AnyValue;
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
  const defId = `pd${state.nextDefId++}` as PlugDefineId;
  const returnId = `${funcId}__out` as ValueId;

  // Build argMap and transformFn from args
  const argMap: Record<string, ValueId> = {};
  const transformFn: Record<string, { name: string }> = {};

  for (const [key, ref] of Object.entries(builder.args)) {
    if (isTransformRef(ref)) {
      argMap[key] = ref.valueId as ValueId;
      transformFn[key] = { name: ref.transformFn };
    } else {
      argMap[key] = ref as ValueId;
      transformFn[key] = { name: inferPassTransform(ref, state) };
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
    transformFn,
    args: {
      a: 'ia1' as InterfaceArgId,
      b: 'ia2' as InterfaceArgId,
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
  const defId = `td${state.nextDefId++}` as TapDefineId;
  const returnId = `${funcId}__out` as ValueId;

  // Build argument map from the bindings provided in the builder
  const argMap: Record<string, ValueId> = {};
  const tapDefArgs: Record<string, InterfaceArgId> = {};

  for (const arg of builder.args) {
    const interfaceArgId = `${funcId}__ia_${arg.name}` as InterfaceArgId;

    // Use the binding from argBindings
    argMap[arg.name] = builder.argBindings[arg.name] as ValueId;
    tapDefArgs[arg.name] = interfaceArgId;
  }

  // Process each step in the sequence
  const sequence: any[] = [];
  for (let i = 0; i < builder.steps.length; i++) {
    const step = builder.steps[i];

    if (step.__type === 'plug') {
      // Create a unique plug definition for this step
      const stepDefId = `pd${state.nextDefId++}` as PlugDefineId;

      // Build argBindings for this step
      const argBindings: Record<string, any> = {};

      for (const [argName, ref] of Object.entries(step.args)) {
        const refStr = typeof ref === 'string' ? ref : (ref as any).valueId;

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
            valueId: refStr as ValueId,
          };
        }
      }

      // Infer transform functions for each argument
      const transformFn: Record<string, { name: string }> = {};
      for (const [argName, ref] of Object.entries(step.args)) {
        if (isTransformRef(ref)) {
          transformFn[argName] = { name: ref.transformFn };
        } else {
          // Infer pass transform based on the function name
          const inferredTransform = inferTransformForBinaryFn(step.name);
          transformFn[argName] = { name: inferredTransform };
        }
      }

      // Add plug definition to table
      state.plugFuncDefTable[stepDefId] = {
        name: step.name,
        transformFn,
        args: {
          a: 'ia1' as any,
          b: 'ia2' as any,
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
  const defId = `cd${state.nextDefId++}` as CondDefineId;
  const returnId = `${funcId}__out` as ValueId;

  state.funcTable[funcId] = {
    defId,
    argMap: {},
    returnId,
  };

  // Condition can be either a ValueId or FuncId (via ref.output())
  // CondFuncDefTable accepts FuncId | ValueId for conditionId
  state.condFuncDefTable[defId] = {
    conditionId: builder.condition as FuncId | ValueId,
    trueBranchId: builder.then as FuncId,
    falseBranchId: builder.else as FuncId,
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

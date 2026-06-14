import type {
  ExecutionContext,
  ValueId,
  FuncId,
  FuncArgMap,
  ArgName,
  TransformFnNames,
} from "../types";
import type {
  ContextSpec,
  BuildResult,
  ValueLiteral,
  FunctionBuilder,
  CombineBuilder,
} from "./types";
import {
  buildNumber,
  buildString,
  buildBoolean,
  buildArray,
} from "../../state-control/value-builders";
import type { AnyValue } from "../../state-control/value";
import { isValidValue } from "../../state-control/value";
import { getBinaryFnReturnType } from "../runtime/typeInference";
import { createArgName } from "../idValidation";
import { IdGenerator } from "../../util/idGenerator";
import { resolveValueReference, isTransformRef, lookupReturnId, type Scope } from "./id-factory";
import { inferPassTransform } from "./transform-inference";
import {
  buildReferenceIndexAndRegisterReturns,
  validateFunctionReference,
} from "./reference-validation";
import { processPipeFunc, registerCombineDefinition } from "./pipe-builder";
import { processCondFunc } from "./cond-builder";
import type { FunctionPhaseState, ValuePhaseResult } from "./phase-types";
import { createValueId, createFuncId } from "../idValidation";
import { BuilderInvariantError } from "./errors";

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

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
  const token = IdGenerator.generateContextToken();
  const scope: Scope = {
    valueId: (key) => createValueId(`${token}_${key}`),
    funcId: (key) => createFuncId(`${token}_${key}`),
  };

  const valuePhase = collectValues(spec, scope);
  const functionPhase = processFunctions(spec, valuePhase, scope);
  const exec = buildExecutionContext(functionPhase);
  const ids = buildIdMap(spec, scope);

  return { exec, ids };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1: value collection
// ─────────────────────────────────────────────────────────────────────────────

function collectValues(spec: ContextSpec, scope: Scope): ValuePhaseResult {
  const valueTable: Record<string, AnyValue> = {};

  for (const [key, value] of Object.entries(spec)) {
    if (isValueLiteral(value)) {
      valueTable[scope.valueId(key)] = inferValue(value);
    }
  }

  return { valueTable };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: function processing
// ─────────────────────────────────────────────────────────────────────────────

function processFunctions(
  spec: ContextSpec,
  valuePhase: ValuePhaseResult,
  scope: Scope,
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
    returnTypeByFuncKey: new Map(),
  };

  const referenceIndex = buildReferenceIndexAndRegisterReturns(spec, state);

  for (const [key, value] of Object.entries(spec)) {
    if (isFunctionBuilder(value)) {
      validateFunctionReference(
        key,
        value,
        referenceIndex.allKeys,
        referenceIndex.valueKeys,
        referenceIndex.functionKeys,
      );
      processFunction(key, value, state, scope, referenceIndex.functionKeys);
    }
  }

  return state;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3: build execution context
// ─────────────────────────────────────────────────────────────────────────────

function buildExecutionContext(functionPhase: FunctionPhaseState): ExecutionContext {
  return {
    valueTable: functionPhase.valueTable,
    funcTable: functionPhase.funcTable,
    combineFuncDefTable: functionPhase.combineFuncDefTable,
    pipeFuncDefTable: functionPhase.pipeFuncDefTable,
    condFuncDefTable: functionPhase.condFuncDefTable,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ID map
// ─────────────────────────────────────────────────────────────────────────────

function buildIdMap<T extends ContextSpec>(spec: T, scope: Scope): BuildResult<T>["ids"] {
  const result = Object.keys(spec).reduce(
    (acc, key) => {
      const id = isFunctionBuilder(spec[key]) ? scope.funcId(key) : scope.valueId(key);
      acc[key as keyof T] = id;
      return acc;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    },
    {} as Record<keyof T, ValueId | FuncId>,
  );

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return result as BuildResult<T>["ids"];
}

// ─────────────────────────────────────────────────────────────────────────────
// Function dispatch
// ─────────────────────────────────────────────────────────────────────────────

function processFunction(
  id: string,
  builder: FunctionBuilder,
  state: FunctionPhaseState,
  scope: Scope,
  functionKeys: Set<string>,
): void {
  switch (builder.__type) {
    case "combine":
      processCombineFunc(id, builder, state, scope);
      break;
    case "pipe":
      processPipeFunc(id, builder, state, scope);
      break;
    case "cond":
      processCondFunc(id, builder, state, scope, functionKeys);
      break;
    default: {
      const _exhaustive: never = builder;
      throw new BuilderInvariantError(
        "ExhaustivenessCheck",
        `unknown function type: ${(_exhaustive as FunctionBuilder).__type}`,
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Combine function building
// ─────────────────────────────────────────────────────────────────────────────

function processCombineFunc(
  funcId: string,
  builder: CombineBuilder,
  state: FunctionPhaseState,
  scope: Scope,
): void {
  const returnId = lookupReturnId(funcId, state);
  const { argMap, transformFnMap } = buildCombineArguments(builder, state, scope);
  const defId = getOrCreateCombineDefinitionId(builder.name, transformFnMap, state);

  state.funcTable[scope.funcId(funcId)] = {
    kind: "combine",
    defId,
    argMap,
    returnId,
  };
}

function buildCombineArguments(
  builder: CombineBuilder,
  state: FunctionPhaseState,
  scope: Scope,
): {
  argMap: FuncArgMap;
  transformFnMap: Record<string, readonly TransformFnNames[]>;
} {
  const argMap: Record<ArgName, ValueId> = {} as Record<ArgName, ValueId>;
  const transformFnMap: Record<string, readonly TransformFnNames[]> = {};

  for (const [key, ref] of Object.entries(builder.args)) {
    const argKey = createArgName(key);
    if (isTransformRef(ref)) {
      argMap[argKey] = resolveValueReference(ref, state, scope);
      transformFnMap[key] = ref.transformFn;
    } else {
      argMap[argKey] = resolveValueReference(ref, state, scope);
      transformFnMap[key] = inferPassTransform(ref, state, scope);
    }
  }

  return { argMap: argMap as FuncArgMap, transformFnMap };
}

function getOrCreateCombineDefinitionId(
  name: CombineBuilder["name"],
  transformFnMap: Record<string, readonly TransformFnNames[]>,
  state: FunctionPhaseState,
): import("../types").CombineDefineId {
  // Array binary functions are only accessible via the HCL pipe path, not the builder API.
  if (name.startsWith("binaryFnArray::")) {
    throw new BuilderInvariantError(
      "UnsupportedConstruct",
      `array binary functions (${name}) cannot be registered via combine() — use a pipe with arr_* HCL functions instead`,
    );
  }
  if (getBinaryFnReturnType(name) === null) {
    throw new BuilderInvariantError(
      "UnknownBinaryFn",
      `unknown binary function '${name}' — verify the function name and namespace prefix`,
    );
  }
  return registerCombineDefinition(name, transformFnMap, state);
}

// ─────────────────────────────────────────────────────────────────────────────
// Literal / value type helpers
// ─────────────────────────────────────────────────────────────────────────────

function isValueLiteral(value: unknown): value is ValueLiteral {
  if (typeof value === "number") return true;
  if (typeof value === "string") return true;
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return true;
  if (typeof value === "object" && value !== null && "symbol" in value && "value" in value) {
    return true;
  }
  return false;
}

function isFunctionBuilder(value: unknown): value is FunctionBuilder {
  return (
    typeof value === "object" &&
    value !== null &&
    "__type" in value &&
    (value.__type === "combine" || value.__type === "pipe" || value.__type === "cond")
  );
}

function isAnyValue(value: unknown): value is AnyValue {
  return isValidValue<AnyValue>(value);
}

function inferValue(literal: ValueLiteral): AnyValue {
  if (typeof literal === "number") return buildNumber(literal);
  if (typeof literal === "string") return buildString(literal);
  if (typeof literal === "boolean") return buildBoolean(literal);
  if (Array.isArray(literal)) return buildArray(literal);
  if (isAnyValue(literal)) return literal;
  throw new BuilderInvariantError(
    "ExhaustivenessCheck",
    `unexpected literal type: ${typeof literal}`,
  );
}

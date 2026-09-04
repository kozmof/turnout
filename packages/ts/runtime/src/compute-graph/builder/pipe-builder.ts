import type {
  FuncArgMap,
  ArgName,
  PipeStepBinding,
  PipeArgBinding,
  CombineDefineId,
  TransformFnNames,
} from "../types.js";
import { BuilderInvariantError } from "./errors.js";
import type { PipeBuilder, CombineBuilder, ValueInputRef } from "./types.js";
import { createArgName, createFuncId } from "../idValidation.js";
import { IdGenerator } from "../../util/idGenerator.js";
import { getCombineFnReturnType } from "../runtime/typeInference.js";
import { getCombineArgNames } from "../../zig-runtime/preset-metadata.js";
import {
  IdFactory,
  getStepOutputLookupKey,
  resolveFuncOutputRef,
  resolveStepOutputRef,
  isTransformRef,
  lookupReturnId,
  type Scope,
} from "./id-factory.js";
import { inferPassTransform } from "./transform-inference.js";
import type { FunctionPhaseState } from "./phase-types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared combine-definition helpers (also used by context.ts for combine funcs)
// ─────────────────────────────────────────────────────────────────────────────

export function createCombineDefSignature(
  name: CombineBuilder["name"],
  transformFnMap: Record<string, readonly TransformFnNames[]>,
): string {
  // Cover every argument the function actually takes, so two definitions that
  // differ only in a later argument's transforms do not share an id.
  const argNames = getCombineArgNames(name);
  return JSON.stringify([name, ...argNames.map((argName) => transformFnMap[argName])]);
}

export function buildCombineDefinition(
  name: CombineBuilder["name"],
  transformFnMap: Record<string, readonly TransformFnNames[]>,
): {
  name: CombineBuilder["name"];
  transformFn: {
    a: readonly TransformFnNames[];
    b: readonly TransformFnNames[];
    c?: readonly TransformFnNames[];
  };
} {
  const argNames = getCombineArgNames(name);
  const transformFn: {
    a: readonly TransformFnNames[];
    b: readonly TransformFnNames[];
    c?: readonly TransformFnNames[];
  } = {
    a: transformFnMap["a"] ?? [],
    b: transformFnMap["b"] ?? [],
  };
  if (argNames.includes("c")) transformFn.c = transformFnMap["c"] ?? [];
  return { name, transformFn };
}

/** Register (or reuse) a combine function definition in the shared def table. No validation. */
export function registerCombineDefinition(
  name: CombineBuilder["name"],
  transformFnMap: Record<string, readonly TransformFnNames[]>,
  state: FunctionPhaseState,
): CombineDefineId {
  const signature = createCombineDefSignature(name, transformFnMap);
  const existing = state.combineDefIdBySignature.get(signature);
  if (existing !== undefined) return existing;

  const defId = IdGenerator.generateCombineDefineId();
  state.combineFuncDefTable[defId] = buildCombineDefinition(name, transformFnMap);
  state.combineDefIdBySignature.set(signature, defId);
  return defId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipe function building
// ─────────────────────────────────────────────────────────────────────────────

export function processPipeFunc(
  funcId: string,
  builder: PipeBuilder,
  state: FunctionPhaseState,
  scope: Scope,
): void {
  const defId = IdGenerator.generatePipeDefineId();
  const returnId = lookupReturnId(funcId, state);

  const { argMap, pipeDefArgs } = buildPipeArguments(builder, scope);
  const sequence = buildPipeSequence(funcId, builder, state, scope);

  state.funcTable[scope.funcId(funcId)] = {
    kind: "pipe",
    defId,
    argMap,
    returnId,
  };

  state.pipeFuncDefTable[defId] = {
    args: pipeDefArgs,
    sequence,
  };
}

function buildPipeArguments(
  builder: PipeBuilder,
  scope: Scope,
): { argMap: FuncArgMap; pipeDefArgs: string[] } {
  const argMap = {} as Record<ArgName, ReturnType<Scope["valueId"]>>;
  const pipeDefArgs: string[] = [];

  for (const [argName, valueRef] of Object.entries(builder.argBindings)) {
    argMap[createArgName(argName)] = scope.valueId(valueRef);
    pipeDefArgs.push(argName);
  }

  return { argMap: argMap as FuncArgMap, pipeDefArgs };
}

function buildPipeSequence(
  funcId: string,
  builder: PipeBuilder,
  state: FunctionPhaseState,
  scope: Scope,
): PipeStepBinding[] {
  // Pass 1: register all step output IDs and return types
  for (let i = 0; i < builder.steps.length; i++) {
    const step = builder.steps[i];
    if (step === undefined || step.__type !== "combine") {
      throw new BuilderInvariantError(
        "UnsupportedConstruct",
        `pipe function '${funcId}' step ${String(i)}: nested pipe steps are not yet supported — only combine steps are allowed inside a pipe`,
      );
    }
    const stepOutputId = IdFactory.createStepOutput(createFuncId(funcId), i, state);
    state.stepOutputIdByFuncStep[getStepOutputLookupKey(funcId, i)] = stepOutputId;
    const stepReturnType = getCombineFnReturnType(step.name);
    if (stepReturnType !== null) {
      const meta = state.stepMetadata[stepOutputId];
      if (meta !== undefined) meta.returnType = stepReturnType;
    }
  }

  // Pass 2: build each step binding with all metadata available
  const sequence: PipeStepBinding[] = [];
  for (let i = 0; i < builder.steps.length; i++) {
    const step = builder.steps[i];
    if (step === undefined || step.__type !== "combine") {
      throw new BuilderInvariantError(
        "UnsupportedConstruct",
        `pipe function '${funcId}' step ${String(i)}: nested pipe steps are not yet supported — only combine steps are allowed inside a pipe`,
      );
    }
    sequence.push(buildPipeStepBinding(step, builder, state, scope));
  }
  return sequence;
}

function buildPipeStepBinding(
  step: CombineBuilder,
  pipeBuilder: PipeBuilder,
  state: FunctionPhaseState,
  scope: Scope,
): PipeStepBinding {
  const argBindings = buildStepArgBindings(step, pipeBuilder, state, scope);
  const transformFnMap = buildStepTransformMap(step, pipeBuilder, state, scope);
  const stepDefId = registerCombineDefinition(step.name, transformFnMap, state);

  return { defId: stepDefId, argBindings };
}

function buildStepArgBindings(
  step: CombineBuilder,
  pipeBuilder: PipeBuilder,
  state: FunctionPhaseState,
  scope: Scope,
): Record<ArgName, PipeArgBinding> {
  const argBindings = {} as Record<ArgName, PipeArgBinding>;

  for (const [argName, ref] of Object.entries(step.args)) {
    const key = createArgName(argName);

    if (typeof ref === "object" && ref.__type === "stepOutput") {
      argBindings[key] = { source: "step", stepIndex: ref.stepIndex };
      continue;
    }

    if (typeof ref === "object" && ref.__type === "funcOutput") {
      const id = resolveFuncOutputRef(ref, state);
      argBindings[key] = { source: "value", id };
      continue;
    }

    if (typeof ref === "object" && ref.__type === "value") {
      argBindings[key] = resolveArgBinding(ref.id, pipeBuilder, scope);
      continue;
    }

    if (isTransformRef(ref)) {
      if (ref.valueRef.__type === "value") {
        argBindings[key] = resolveArgBinding(ref.valueRef.id, pipeBuilder, scope);
      } else if (ref.valueRef.__type === "funcOutput") {
        argBindings[key] = { source: "value", id: resolveFuncOutputRef(ref.valueRef, state) };
      } else {
        argBindings[key] = { source: "value", id: resolveStepOutputRef(ref.valueRef, state) };
      }
      continue;
    }

    argBindings[key] = resolveArgBinding(ref, pipeBuilder, scope);
  }

  return argBindings;
}

function resolveArgBinding(refStr: string, pipeBuilder: PipeBuilder, scope: Scope): PipeArgBinding {
  if (Object.prototype.hasOwnProperty.call(pipeBuilder.argBindings, refStr)) {
    return { source: "input", argName: createArgName(refStr) };
  }
  return { source: "value", id: scope.valueId(refStr) };
}

function buildStepTransformMap(
  step: CombineBuilder,
  pipeBuilder: PipeBuilder,
  state: FunctionPhaseState,
  scope: Scope,
): Record<string, readonly TransformFnNames[]> {
  const transformFnMap: Record<string, readonly TransformFnNames[]> = {};

  for (const [argName, ref] of Object.entries(step.args)) {
    // A pass transform must match the type of the argument it is applied to,
    // not the type the step returns.
    transformFnMap[argName] = isTransformRef(ref)
      ? ref.transformFn
      : inferPassTransform(resolveStepArgRef(ref, pipeBuilder), state, scope);
  }

  return transformFnMap;
}

/**
 * Rewrites a reference to a pipe input into the context value that input is
 * bound to, so its type can be looked up in the shared value table. Every other
 * reference kind already resolves against the shared tables as-is.
 */
function resolveStepArgRef(ref: ValueInputRef, pipeBuilder: PipeBuilder): ValueInputRef {
  if (typeof ref === "object" && ref.__type !== "value") return ref;
  const id = typeof ref === "string" ? ref : ref.id;
  if (!Object.prototype.hasOwnProperty.call(pipeBuilder.argBindings, id)) return id;
  return pipeBuilder.argBindings[id] ?? id;
}

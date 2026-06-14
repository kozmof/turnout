import type {
  FuncArgMap,
  ArgName,
  PipeStepBinding,
  PipeArgBinding,
  CombineDefineId,
  TransformFnNames,
} from "../types";
import { BuilderInvariantError } from "./errors";
import type { PipeBuilder, CombineBuilder } from "./types";
import { createArgName, createFuncId } from "../idValidation";
import { IdGenerator } from "../../util/idGenerator";
import { getBinaryFnReturnType } from "../runtime/typeInference";
import {
  IdFactory,
  getStepOutputLookupKey,
  resolveFuncOutputRef,
  resolveStepOutputRef,
  isTransformRef,
  isStepOutputRef,
  lookupReturnId,
  type Scope,
} from "./id-factory";
import { inferTransformForBinaryFn } from "./transform-inference";
import type { FunctionPhaseState } from "./phase-types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared combine-definition helpers (also used by context.ts for combine funcs)
// ─────────────────────────────────────────────────────────────────────────────

export function createCombineDefSignature(
  name: CombineBuilder["name"],
  transformFnMap: Record<string, readonly TransformFnNames[]>,
): string {
  return JSON.stringify([name, transformFnMap["a"], transformFnMap["b"]]);
}

export function buildCombineDefinition(
  name: CombineBuilder["name"],
  transformFnMap: Record<string, readonly TransformFnNames[]>,
): {
  name: CombineBuilder["name"];
  transformFn: { a: readonly TransformFnNames[]; b: readonly TransformFnNames[] };
} {
  return {
    name,
    transformFn: {
      a: transformFnMap["a"] ?? [],
      b: transformFnMap["b"] ?? [],
    },
  };
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
    if (step.__type !== "combine") {
      throw new BuilderInvariantError(
        "UnsupportedConstruct",
        `pipe function '${funcId}' step ${String(i)}: nested pipe steps are not yet supported — only combine steps are allowed inside a pipe`,
      );
    }
    const stepOutputId = IdFactory.createStepOutput(createFuncId(funcId), i, state);
    state.stepOutputIdByFuncStep[getStepOutputLookupKey(funcId, i)] = stepOutputId;
    const stepReturnType = getBinaryFnReturnType(step.name);
    if (stepReturnType !== null) {
      state.stepMetadata[stepOutputId].returnType = stepReturnType;
    }
  }

  // Pass 2: build each step binding with all metadata available
  const sequence: PipeStepBinding[] = [];
  for (let i = 0; i < builder.steps.length; i++) {
    const step = builder.steps[i];
    if (step.__type !== "combine") {
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
  const transformFnMap = buildStepTransformMap(step, pipeBuilder);
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
): Record<string, readonly TransformFnNames[]> {
  const transformFnMap: Record<string, readonly TransformFnNames[]> = {};

  for (const [argName, ref] of Object.entries(step.args)) {
    if (isTransformRef(ref)) {
      transformFnMap[argName] = ref.transformFn;
    } else if (isStepOutputRef(ref)) {
      const referencedStep = pipeBuilder.steps[ref.stepIndex];
      if (referencedStep.__type !== "combine") {
        throw new BuilderInvariantError(
          "UnsupportedConstruct",
          `buildStepTransformMap: step ${String(ref.stepIndex)} is not a combine step — nested pipe steps are not supported`,
        );
      }
      transformFnMap[argName] = [inferTransformForBinaryFn(referencedStep.name)];
    } else {
      transformFnMap[argName] = [inferTransformForBinaryFn(step.name)];
    }
  }

  return transformFnMap;
}

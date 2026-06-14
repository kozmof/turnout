import type {
  ContextSpec,
  FunctionBuilder,
  CombineBuilder,
  CondBuilder,
  PipeBuilder,
} from "./types.js";
import { BuilderInvariantError } from "./errors.js";
import {
  createUndefinedConditionError,
  createUndefinedBranchError,
  createUndefinedValueReferenceError,
  createUndefinedPipeArgumentError,
  createUndefinedPipeStepReferenceError,
} from "./errors.js";
import { getBinaryFnReturnType } from "../runtime/typeInference.js";
import { createFuncId } from "../idValidation.js";
import { IdFactory, normalizeValueRef, isTransformRef } from "./id-factory.js";
import type { FunctionPhaseState, ReferenceIndex } from "./phase-types.js";

export function buildReferenceIndexAndRegisterReturns(
  spec: ContextSpec,
  state: FunctionPhaseState,
): ReferenceIndex {
  const allKeys = new Set<string>();
  const valueKeys = new Set<string>();
  const functionKeys = new Set<string>();

  for (const [key, value] of Object.entries(spec)) {
    allKeys.add(key);
    if (isFunctionBuilderLocal(value)) {
      functionKeys.add(key);
      const returnId = IdFactory.createReturnValue(createFuncId(key), state);
      state.returnIdByFuncId[key] = returnId;
      if (value.__type === "combine") {
        const rt = getBinaryFnReturnType(value.name);
        if (rt !== null) state.returnTypeByFuncKey.set(key, rt);
      } else if (value.__type === "pipe" && value.steps.length > 0) {
        const lastStep = value.steps[value.steps.length - 1];
        if (lastStep.__type === "combine") {
          const rt = getBinaryFnReturnType(lastStep.name);
          if (rt !== null) state.returnTypeByFuncKey.set(key, rt);
        }
      }
    } else {
      valueKeys.add(key);
    }
  }

  // Second mini-pass: pre-compute cond return types from their then-branch.
  let madeProgress = true;
  while (madeProgress) {
    madeProgress = false;
    for (const [key, value] of Object.entries(spec)) {
      if (!isFunctionBuilderLocal(value) || value.__type !== "cond") continue;
      if (state.returnTypeByFuncKey.has(key)) continue;
      const thenType = state.returnTypeByFuncKey.get(value.then);
      if (thenType !== undefined) {
        state.returnTypeByFuncKey.set(key, thenType);
        madeProgress = true;
      }
    }
  }

  return { allKeys, valueKeys, functionKeys };
}

export function validateFunctionReference(
  funcId: string,
  builder: FunctionBuilder,
  allKeys: Set<string>,
  valueKeys: Set<string>,
  functionKeys: Set<string>,
): void {
  switch (builder.__type) {
    case "cond":
      validateCondReferences(funcId, builder, allKeys, functionKeys);
      break;
    case "combine":
      validateCombineReferences(funcId, builder, valueKeys, functionKeys);
      break;
    case "pipe":
      validatePipeReferences(funcId, builder, valueKeys, functionKeys);
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

function validateCondReferences(
  funcId: string,
  cond: CondBuilder,
  allKeys: Set<string>,
  functionKeys: Set<string>,
): void {
  if (!allKeys.has(cond.condition)) {
    throw createUndefinedConditionError(funcId, cond.condition);
  }
  if (!functionKeys.has(cond.then)) {
    throw createUndefinedBranchError(funcId, "then", cond.then);
  }
  if (!functionKeys.has(cond.else)) {
    throw createUndefinedBranchError(funcId, "else", cond.else);
  }
}

function validateCombineReferences(
  funcId: string,
  combine: CombineBuilder,
  valueKeys: Set<string>,
  functionKeys: Set<string>,
): void {
  for (const [argName, ref] of Object.entries(combine.args)) {
    if (isTransformRef(ref)) {
      const valueRef = ref.valueRef;
      if (valueRef.__type === "value") {
        if (!valueKeys.has(valueRef.id)) {
          throw createUndefinedValueReferenceError(funcId, argName, valueRef.id);
        }
      } else if (valueRef.__type === "funcOutput") {
        if (!functionKeys.has(valueRef.funcId)) {
          throw createUndefinedValueReferenceError(funcId, argName, valueRef.funcId);
        }
      } else if (!functionKeys.has(valueRef.pipeFuncId)) {
        throw createUndefinedValueReferenceError(funcId, argName, valueRef.pipeFuncId);
      }
    } else {
      const normalized = normalizeValueRef(ref);
      if (normalized.__type === "value") {
        if (!valueKeys.has(normalized.id)) {
          throw createUndefinedValueReferenceError(funcId, argName, normalized.id);
        }
      } else if (normalized.__type === "funcOutput") {
        if (!functionKeys.has(normalized.funcId)) {
          throw createUndefinedValueReferenceError(funcId, argName, normalized.funcId);
        }
      } else {
        if (!functionKeys.has(normalized.pipeFuncId)) {
          throw createUndefinedValueReferenceError(funcId, argName, normalized.pipeFuncId);
        }
      }
    }
  }
}

function validatePipeReferences(
  funcId: string,
  pipe: PipeBuilder,
  valueKeys: Set<string>,
  functionKeys: Set<string>,
): void {
  const pipeArgNames = new Set(Object.keys(pipe.argBindings));

  for (const [argName, binding] of Object.entries(pipe.argBindings)) {
    if (!valueKeys.has(binding)) {
      throw createUndefinedPipeArgumentError(funcId, argName, binding);
    }
  }

  for (let i = 0; i < pipe.steps.length; i++) {
    const step = pipe.steps[i];
    if (step.__type === "combine") {
      for (const [argName, ref] of Object.entries(step.args)) {
        if (isTransformRef(ref)) {
          if (ref.valueRef.__type === "value") {
            const isPipeArg = pipeArgNames.has(ref.valueRef.id);
            const isContextValue = valueKeys.has(ref.valueRef.id);
            if (!isPipeArg && !isContextValue) {
              throw createUndefinedPipeStepReferenceError(funcId, i, argName, ref.valueRef.id);
            }
          } else if (ref.valueRef.__type === "funcOutput") {
            if (!functionKeys.has(ref.valueRef.funcId)) {
              throw createUndefinedPipeStepReferenceError(funcId, i, argName, ref.valueRef.funcId);
            }
          } else {
            if (ref.valueRef.pipeFuncId !== funcId) {
              throw new BuilderInvariantError(
                "MissingTableEntry",
                `step ${String(i)} of pipe function '${funcId}' references step from different pipe function '${ref.valueRef.pipeFuncId}'`,
              );
            }
            if (ref.valueRef.stepIndex >= i) {
              throw new BuilderInvariantError(
                "MissingTableEntry",
                `step ${String(i)} of pipe function '${funcId}' references step ${String(ref.valueRef.stepIndex)} which is not a previous step`,
              );
            }
          }
        } else {
          const normalized = normalizeValueRef(ref);
          if (normalized.__type === "value") {
            const isPipeArg = pipeArgNames.has(normalized.id);
            const isContextValue = valueKeys.has(normalized.id);
            if (!isPipeArg && !isContextValue) {
              throw createUndefinedPipeStepReferenceError(funcId, i, argName, normalized.id);
            }
          } else if (normalized.__type === "funcOutput") {
            if (!functionKeys.has(normalized.funcId)) {
              throw createUndefinedPipeStepReferenceError(funcId, i, argName, normalized.funcId);
            }
          } else {
            if (normalized.pipeFuncId !== funcId) {
              throw new BuilderInvariantError(
                "MissingTableEntry",
                `step ${String(i)} of pipe function '${funcId}' references step from different pipe function '${normalized.pipeFuncId}'`,
              );
            }
            if (normalized.stepIndex >= i) {
              throw new BuilderInvariantError(
                "MissingTableEntry",
                `step ${String(i)} of pipe function '${funcId}' references step ${String(normalized.stepIndex)} which is not a previous step`,
              );
            }
          }
        }
      }
    }
  }
}

function isFunctionBuilderLocal(value: unknown): value is FunctionBuilder {
  return (
    typeof value === "object" &&
    value !== null &&
    "__type" in value &&
    (value.__type === "combine" || value.__type === "pipe" || value.__type === "cond")
  );
}

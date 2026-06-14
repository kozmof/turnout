import type { combine, FuncId, ValueId } from "runtime";
import type { BindingModel, ArgModel } from "../types/turnout-model_pb.js";
import { SceneRuntimeError } from "./errors.js";

export type LocalFuncOutputRef = { readonly __type: "funcOutput"; readonly funcId: string };
export type LocalStepOutputRef = {
  readonly __type: "stepOutput";
  readonly pipeFuncId: string;
  readonly stepIndex: number;
};
export type LocalTransformRef = {
  readonly __type: "transform";
  readonly valueRef: { readonly __type: "value"; readonly id: string };
  readonly transformFn: readonly string[];
};

export type CombineArgRef = Parameters<typeof combine>[1]["a"];

// ─────────────────────────────────────────────────────────────────────────────
// Branded casts — these are the only intentional `as` casts for runtime IDs.
// Keep them here so the dynamic-boundary surface stays in one place.
// ─────────────────────────────────────────────────────────────────────────────

export function toFuncId(value: string): FuncId {
  return value as FuncId;
}

export function toValueId(value: string): ValueId {
  return value as ValueId;
}

export function toCombineArgRef(value: unknown): CombineArgRef {
  return value as CombineArgRef;
}

// ─────────────────────────────────────────────────────────────────────────────
// Model fragment guards — validate well-formedness before entering context builder
// ─────────────────────────────────────────────────────────────────────────────

/** Asserts a value BindingModel has at least one of value or expr set. */
export function assertBindingHasValue(b: BindingModel, contextId: string): void {
  if (b.value === undefined && b.expr === undefined) {
    throw new SceneRuntimeError(
      "CompilerBug",
      contextId,
      `binding "${b.name}": value binding has neither value nor expr — compiler bug or malformed JSON`,
    );
  }
}

/** Asserts an ArgModel has exactly one variant set. */
export function assertArgModelVariant(arg: ArgModel, contextId: string, label: string): void {
  const setCount = [arg.ref, arg.funcRef, arg.lit, arg.stepRef, arg.transform].filter(
    (v) => v !== undefined,
  ).length;
  if (setCount !== 1) {
    throw new SceneRuntimeError(
      "UnknownArgModel",
      contextId,
      `${label}: ArgModel must have exactly 1 variant set, found ${setCount}`,
    );
  }
}

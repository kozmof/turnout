import type { ValueId, FuncId, CombineDefineId, PipeDefineId, CondDefineId } from "../types.js";
import type {
  ContextBuilder as BuilderState,
  ValueInputRef,
  ValueSourceRef,
  FuncOutputRef,
  StepOutputRef,
  TransformRef,
} from "./types.js";
import type { AnyValue } from "../../state-control/value.js";
import { IdGenerator } from "../../util/idGenerator.js";
import { createFuncId } from "../idValidation.js";
import type { FunctionPhaseState } from "./phase-types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Scope
// ─────────────────────────────────────────────────────────────────────────────

export type Scope = {
  readonly valueId: (key: string) => ValueId;
  readonly funcId: (key: string) => FuncId;
};

// ─────────────────────────────────────────────────────────────────────────────
// ID factory
// ─────────────────────────────────────────────────────────────────────────────

export const IdFactory = {
  createStepOutput(parentFuncId: FuncId, stepIndex: number, state: FunctionPhaseState): ValueId {
    const stepOutputId = IdGenerator.generateValueId();
    state.stepMetadata[stepOutputId] = { parentFuncId, stepIndex };
    return stepOutputId;
  },

  createReturnValue(sourceFuncId: FuncId, state: FunctionPhaseState): ValueId {
    const returnValueId = IdGenerator.generateValueId();
    state.returnValueMetadata[returnValueId] = { sourceFuncId };
    return returnValueId;
  },
} as const;

export function getStepOutputLookupKey(funcId: string, stepIndex: number): string {
  return `${funcId}::${String(stepIndex)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Table lookup helpers
// ─────────────────────────────────────────────────────────────────────────────

export function getValueFromTable(
  valueRef: string,
  valueTable: Record<string, AnyValue>,
): AnyValue | undefined {
  return valueTable[valueRef];
}

export function getFuncFromTable(
  funcId: string,
  funcTable: BuilderState["funcTable"],
): BuilderState["funcTable"][string] | undefined {
  return funcTable[funcId];
}

export function getCombineFuncDefFromTable(
  defId: CombineDefineId | PipeDefineId | CondDefineId,
  combineFuncDefTable: BuilderState["combineFuncDefTable"],
): BuilderState["combineFuncDefTable"][CombineDefineId] | undefined {
  return combineFuncDefTable[defId];
}

// ─────────────────────────────────────────────────────────────────────────────
// Value reference helpers
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeValueRef(ref: ValueInputRef): ValueSourceRef {
  if (typeof ref === "string") return { __type: "value", id: ref };
  return ref;
}

export function isTransformRef(ref: ValueInputRef | TransformRef): ref is TransformRef {
  return typeof ref === "object" && ref.__type === "transform";
}

export function isStepOutputRef(ref: ValueInputRef | TransformRef): ref is StepOutputRef {
  return typeof ref === "object" && ref.__type === "stepOutput";
}

export function resolveFuncOutputRef(ref: FuncOutputRef, state: FunctionPhaseState): ValueId {
  return state.returnIdByFuncId[ref.funcId];
}

export function resolveStepOutputRef(ref: StepOutputRef, state: FunctionPhaseState): ValueId {
  return state.stepOutputIdByFuncStep[getStepOutputLookupKey(ref.pipeFuncId, ref.stepIndex)];
}

export function resolveValueReference(
  ref: ValueInputRef | TransformRef,
  state: FunctionPhaseState,
  scope: Scope,
): ValueId {
  if (isTransformRef(ref)) {
    const valueRef = ref.valueRef;
    if (valueRef.__type === "value") return scope.valueId(valueRef.id);
    if (valueRef.__type === "funcOutput") return resolveFuncOutputRef(valueRef, state);
    return resolveStepOutputRef(valueRef, state);
  }

  const normalized = normalizeValueRef(ref);
  if (normalized.__type === "funcOutput") return resolveFuncOutputRef(normalized, state);
  if (normalized.__type === "stepOutput") return resolveStepOutputRef(normalized, state);
  return scope.valueId(normalized.id);
}

export function lookupReturnId(funcId: string, state: FunctionPhaseState): ValueId {
  return state.returnIdByFuncId[funcId];
}

// Re-export createFuncId so callers that import from id-factory can get it.
export { createFuncId };

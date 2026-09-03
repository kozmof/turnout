import type { CombineFnNames, TransformFnNames } from "../types.js";
import { BuilderInvariantError } from "./errors.js";
import type { ValueInputRef } from "./types.js";
import type { BaseTypeSymbol } from "../../state-control/value.js";
import { getCombineFnReturnType } from "../runtime/typeInference.js";
import { getPassTransformName } from "../../zig-runtime/preset-metadata.js";
import {
  getValueFromTable,
  getFuncFromTable,
  getCombineFuncDefFromTable,
  getStepOutputLookupKey,
  type Scope,
} from "./id-factory.js";
import type { FunctionPhaseState } from "./phase-types.js";

export function getPassTransformFn(typeSymbol: BaseTypeSymbol): TransformFnNames {
  const name = getPassTransformName(typeSymbol);
  if (name === null) {
    throw new BuilderInvariantError(
      "ExhaustivenessCheck",
      `cannot infer pass transform for '${typeSymbol}'`,
    );
  }
  return name as TransformFnNames;
}

export function inferTransformForCombineFn(combineFnName: CombineFnNames): TransformFnNames {
  const returnType = getCombineFnReturnType(combineFnName);
  if (returnType === null) {
    throw new BuilderInvariantError(
      "UnknownCombineFn",
      `cannot infer transform: unknown return type for combine function '${combineFnName}'`,
    );
  }
  return getPassTransformFn(returnType);
}

export function inferPassTransform(
  ref: ValueInputRef,
  state: FunctionPhaseState,
  scope: Scope,
): readonly TransformFnNames[] {
  if (typeof ref === "object" && ref.__type === "funcOutput") {
    const funcEntry = getFuncFromTable(scope.funcId(ref.funcId), state.funcTable);
    if (funcEntry) {
      const def = getCombineFuncDefFromTable(funcEntry.defId, state.combineFuncDefTable);
      if (def) return [inferTransformForCombineFn(def.name)];
    }

    const precomputedType = state.returnTypeByFuncKey.get(ref.funcId);
    if (precomputedType !== undefined) return [getPassTransformFn(precomputedType)];

    throw new BuilderInvariantError(
      "MissingTableEntry",
      `function "${ref.funcId}" not found — ensure all referenced functions are declared in the same ctx() spec`,
    );
  }

  if (typeof ref === "object" && ref.__type === "stepOutput") {
    const stepOutputId =
      state.stepOutputIdByFuncStep[getStepOutputLookupKey(ref.pipeFuncId, ref.stepIndex)];
    const metadata = stepOutputId === undefined ? undefined : state.stepMetadata[stepOutputId];
    if (metadata?.returnType !== undefined) {
      return [getPassTransformFn(metadata.returnType)];
    }
    throw new BuilderInvariantError(
      "MissingTableEntry",
      `no return type recorded for step output (pipe '${ref.pipeFuncId}', step ${String(ref.stepIndex)})`,
    );
  }

  const normalized = typeof ref === "string" ? { __type: "value" as const, id: ref } : ref;
  const valueId = scope.valueId(normalized.id);
  const value = getValueFromTable(valueId, state.valueTable);
  if (value) return [getPassTransformFn(value.symbol)];
  throw new BuilderInvariantError(
    "MissingTableEntry",
    `value '${normalized.id}' not found in valueTable`,
  );
}

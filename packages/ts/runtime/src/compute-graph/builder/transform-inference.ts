import type { TransformFnNames } from "../types.js";
import { BuilderInvariantError } from "./errors.js";
import type { ValueInputRef } from "./types.js";
import type { BaseTypeSymbol } from "../../state-control/value.js";
import { getPassTransformName } from "../../zig-runtime/preset-metadata.js";
import { getValueFromTable, getStepOutputLookupKey, type Scope } from "./id-factory.js";
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

export function inferPassTransform(
  ref: ValueInputRef,
  state: FunctionPhaseState,
  scope: Scope,
): readonly TransformFnNames[] {
  if (typeof ref === "object" && ref.__type === "funcOutput") {
    // Types for every declared function are inferred by Zig up front, so this
    // answers forward references and every function kind uniformly.
    const inferredType = state.returnTypeByFuncKey.get(ref.funcId);
    if (inferredType !== undefined) return [getPassTransformFn(inferredType)];

    if (state.returnIdByFuncId[ref.funcId] !== undefined) {
      throw new BuilderInvariantError(
        "UnknownCombineFn",
        `cannot infer the return type of function '${ref.funcId}' — check that its combine function names are known and that any pipe ends in a combine step`,
      );
    }

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

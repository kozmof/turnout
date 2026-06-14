import type { BinaryFnNames, TransformFnNames } from "../types.js";
import { BuilderInvariantError } from "./errors.js";
import type { ValueInputRef } from "./types.js";
import type { BaseTypeSymbol } from "../../state-control/value.js";
import { assertNever } from "../../util/brand.js";
import { getBinaryFnReturnType } from "../runtime/typeInference.js";
import { NAMESPACE_DELIMITER } from "../../util/constants.js";
import type { TransformFnBooleanNameSpace } from "../../state-control/preset-funcs/boolean/transformFn.js";
import type { TransformFnNullNameSpace } from "../../state-control/preset-funcs/null/transformFn.js";
import type { TransformFnNumberNameSpace } from "../../state-control/preset-funcs/number/transformFn.js";
import type { TransformFnStringNameSpace } from "../../state-control/preset-funcs/string/transformFn.js";
import type { TransformFnArrayNameSpace } from "../../state-control/preset-funcs/array/transformFn.js";
import {
  getValueFromTable,
  getFuncFromTable,
  getCombineFuncDefFromTable,
  getStepOutputLookupKey,
  type Scope,
} from "./id-factory.js";
import type { FunctionPhaseState } from "./phase-types.js";

export function getPassTransformFn(typeSymbol: BaseTypeSymbol): TransformFnNames {
  switch (typeSymbol) {
    case "boolean": {
      const namespace: TransformFnBooleanNameSpace = "transformFnBoolean";
      return `${namespace}${NAMESPACE_DELIMITER}pass`;
    }
    case "number": {
      const namespace: TransformFnNumberNameSpace = "transformFnNumber";
      return `${namespace}${NAMESPACE_DELIMITER}pass`;
    }
    case "string": {
      const namespace: TransformFnStringNameSpace = "transformFnString";
      return `${namespace}${NAMESPACE_DELIMITER}pass`;
    }
    case "null": {
      const namespace: TransformFnNullNameSpace = "transformFnNull";
      return `${namespace}${NAMESPACE_DELIMITER}pass`;
    }
    case "array": {
      const namespace: TransformFnArrayNameSpace = "transformFnArray";
      return `${namespace}${NAMESPACE_DELIMITER}pass`;
    }
    default:
      return assertNever(typeSymbol);
  }
}

export function inferTransformForBinaryFn(binaryFnName: BinaryFnNames): TransformFnNames {
  const returnType = getBinaryFnReturnType(binaryFnName);
  if (returnType === null) {
    throw new BuilderInvariantError(
      "UnknownBinaryFn",
      `cannot infer transform: unknown return type for binary function '${binaryFnName}'`,
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
      if (def) return [inferTransformForBinaryFn(def.name)];
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
    const metadata = state.stepMetadata[stepOutputId];
    if (metadata.returnType !== undefined) {
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

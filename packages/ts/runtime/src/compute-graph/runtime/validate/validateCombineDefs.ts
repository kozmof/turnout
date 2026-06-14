import type {
  FuncId,
  ValueId,
  ArgName,
  CombineDefineId,
  PipeDefineId,
  CondDefineId,
  BinaryFnNames,
  TransformFnNames,
} from "../../types.js";
import { createArgName } from "../../idValidation.js";
import {
  getTransformFnInputType,
  getTransformFnReturnType,
  getBinaryFnParamTypes,
  getBinaryFnReturnType,
} from "../typeInference.js";
import type { UnvalidatedContext, ValidationState } from "./types.js";
import {
  isRecord,
  isStringAs,
  hasKey,
  hasNameAndTransformFn,
  funcIdExistsInContext,
  defineIdExistsInContext,
  valueIdExistsInContext,
  inferFuncType,
} from "./utils.js";

/**
 * Validates a single FuncTable entry (combine, pipe, or cond kind).
 */
export function validateFuncEntry(
  funcId: string,
  funcEntry: unknown,
  context: UnvalidatedContext,
  state: ValidationState,
): void {
  if (!isRecord(funcEntry)) {
    state.errors.push({
      message: `FuncTable[${funcId}]: Invalid entry`,
      details: { funcId },
    });
    return;
  }

  const entry = funcEntry;

  if (!("kind" in entry) || typeof entry.kind !== "string") {
    state.errors.push({
      message: `FuncTable[${funcId}]: Missing or invalid kind`,
      details: { funcId, kind: "kind" in entry ? entry.kind : undefined },
    });
    return;
  }
  if (entry.kind !== "combine" && entry.kind !== "pipe" && entry.kind !== "cond") {
    state.errors.push({
      message: `FuncTable[${funcId}]: Unknown kind "${entry.kind}"`,
      details: { funcId, kind: entry.kind },
    });
    return;
  }

  if (!("defId" in entry) || typeof entry.defId !== "string") {
    state.errors.push({
      message: `FuncTable[${funcId}]: Missing or invalid defId`,
      details: { funcId },
    });
    return;
  }

  const defId = entry.defId;

  if (!defineIdExistsInContext(defId, context)) {
    state.errors.push({
      message: `FuncTable[${funcId}]: Definition ${defId} does not exist`,
      details: { funcId, defId },
    });
  } else {
    state.referencedDefs.add(defId);
  }

  if (!("returnId" in entry) || !isStringAs<ValueId>(entry.returnId)) {
    state.errors.push({
      message: `FuncTable[${funcId}]: Missing or invalid returnId`,
      details: { funcId },
    });
  } else {
    state.returnIds.add(entry.returnId);
  }

  if (entry.kind === "combine" && !hasKey(context.combineFuncDefTable, defId)) {
    state.errors.push({
      message: `FuncTable[${funcId}]: kind "combine" must reference CombineFuncDefTable, got ${defId}`,
      details: { funcId, defId, kind: entry.kind },
    });
  }
  if (entry.kind === "pipe" && !hasKey(context.pipeFuncDefTable, defId)) {
    state.errors.push({
      message: `FuncTable[${funcId}]: kind "pipe" must reference PipeFuncDefTable, got ${defId}`,
      details: { funcId, defId, kind: entry.kind },
    });
  }
  if (entry.kind === "cond" && !hasKey(context.condFuncDefTable, defId)) {
    state.errors.push({
      message: `FuncTable[${funcId}]: kind "cond" must reference CondFuncDefTable, got ${defId}`,
      details: { funcId, defId, kind: entry.kind },
    });
  }

  const hasArgMap = "argMap" in entry && isRecord(entry.argMap);
  if ((entry.kind === "combine" || entry.kind === "pipe") && !hasArgMap) {
    state.errors.push({
      message: `FuncTable[${funcId}]: kind "${entry.kind}" requires argMap`,
      details: { funcId, kind: entry.kind },
    });
  }
  if (entry.kind === "cond" && "argMap" in entry && !isRecord(entry.argMap)) {
    state.errors.push({
      message: `FuncTable[${funcId}]: cond argMap must be an object when provided`,
      details: { funcId },
    });
  }

  const argMap = "argMap" in entry && isRecord(entry.argMap) ? entry.argMap : null;
  if (argMap) {
    for (const [argName, argId] of Object.entries(argMap)) {
      if (!isStringAs(argId)) {
        state.errors.push({
          message: `FuncTable[${funcId}].argMap['${argName}']: Argument ID must be a string`,
          details: { funcId, argName, argId },
        });
        continue;
      }
      if (!valueIdExistsInContext(argId, context, state.returnIds)) {
        state.errors.push({
          message: `FuncTable[${funcId}].argMap['${argName}']: Referenced ID ${String(argId)} does not exist`,
          details: { funcId, argName, argId },
        });
      } else {
        state.referencedValues.add(argId);
      }
    }

    if (entry.kind === "combine") {
      validateRequiredCombineArgs(funcId, argMap, state);
    }
  }

  if (entry.kind === "combine" && hasKey(context.combineFuncDefTable, defId)) {
    validateCombineFuncTypes(funcId, entry, defId, context, state);
  }
}

function validateRequiredCombineArgs(
  funcId: string,
  argMap: Record<string, unknown>,
  state: ValidationState,
): void {
  for (const argName of ["a", "b"] as const) {
    const key: ArgName = createArgName(argName);
    if (!(key in argMap)) {
      state.errors.push({
        message: `FuncTable[${funcId}].argMap: Combine function requires argument "${argName}"`,
        details: { funcId, argName },
      });
    }
  }
}

/**
 * Validates type safety for a CombineFunc instance.
 */
function validateCombineFuncTypes(
  funcId: string,
  funcEntry: Record<string, unknown>,
  defId: string,
  context: UnvalidatedContext,
  state: ValidationState,
): void {
  const def = context.combineFuncDefTable?.[defId];
  if (!isRecord(def)) return;
  if (!("transformFn" in def) || !isRecord(def.transformFn)) return;

  const transformFn = def.transformFn;
  const argMap = "argMap" in funcEntry && isRecord(funcEntry.argMap) ? funcEntry.argMap : {};
  const binaryFnName = "name" in def && isStringAs<BinaryFnNames>(def.name) ? def.name : null;
  const paramTypes = binaryFnName ? getBinaryFnParamTypes(binaryFnName) : null;

  for (const [argName, fns] of Object.entries(transformFn)) {
    if (argName !== "a" && argName !== "b") continue;
    if (!Array.isArray(fns)) continue;

    const argId = argMap[argName];
    if (!isStringAs<ValueId | FuncId>(argId)) continue;

    let currentType = state.typeEnv.get(argId);

    if (!currentType && isStringAs<FuncId>(argId) && funcIdExistsInContext(argId, context)) {
      const inferredType = inferFuncType(argId, context);
      if (inferredType) {
        currentType = inferredType;
        state.typeEnv.set(argId, currentType);
      }
    }

    if (!currentType) {
      state.warnings.push({
        message: `FuncTable[${funcId}].argMap['${argName}']: type of argument "${argId}" could not be inferred, skipping compatibility check`,
        details: { funcId, argId, argName },
      });
      continue;
    }

    for (const transformFnName of fns) {
      if (!isStringAs<TransformFnNames>(transformFnName)) continue;
      const expectedType = getTransformFnInputType(transformFnName);
      if (expectedType && currentType !== expectedType) {
        state.errors.push({
          message: `FuncTable[${funcId}].argMap['${argName}']: Argument has type "${currentType}" but transform function "${transformFnName}" expects "${expectedType}"`,
          details: {
            funcId,
            argId,
            argType: currentType,
            transformFn: transformFnName,
            expectedType,
          },
        });
      }

      const returnType = getTransformFnReturnType(transformFnName);
      if (returnType) currentType = returnType;
    }

    if (!paramTypes) continue;
    const expectedBinaryType = paramTypes[argName === "a" ? 0 : 1];
    if (currentType !== expectedBinaryType) {
      state.errors.push({
        message: `FuncTable[${funcId}].argMap['${argName}']: Argument resolves to type "${currentType}" but binary function "${binaryFnName}" expects "${expectedBinaryType}"`,
        details: {
          funcId,
          argId,
          argName,
          argType: currentType,
          binaryFn: binaryFnName,
          expectedType: expectedBinaryType,
        },
      });
    }
  }
}

/**
 * Validates a CombineFuncDefTable entry.
 */
export function validateCombineDefEntry(defId: string, def: unknown, state: ValidationState): void {
  if (!isRecord(def)) {
    state.errors.push({
      message: `CombineFuncDefTable[${defId}]: Invalid entry`,
      details: { defId },
    });
    return;
  }

  const entry = def;

  if (!("name" in entry) || typeof entry.name !== "string" || entry.name.length === 0) {
    state.errors.push({
      message: `CombineFuncDefTable[${defId}]: Invalid or missing function name`,
      details: { defId, name: entry.name },
    });
  } else {
    const binaryReturnType = isStringAs<BinaryFnNames>(entry.name)
      ? getBinaryFnReturnType(entry.name)
      : null;
    if (!binaryReturnType) {
      state.errors.push({
        message: `CombineFuncDefTable[${defId}]: Invalid or unknown binary function "${entry.name}"`,
        details: { defId, binaryFn: entry.name },
      });
    }
  }

  if (!("transformFn" in entry) || !isRecord(entry.transformFn)) {
    state.errors.push({
      message: `CombineFuncDefTable[${defId}]: Missing transform function definitions`,
      details: { defId },
    });
    return;
  }

  const transformFn = entry.transformFn;

  for (const key of ["a", "b"]) {
    if (!(key in transformFn) || !Array.isArray(transformFn[key])) {
      state.errors.push({
        message: `CombineFuncDefTable[${defId}]: Missing transform function '${key}'`,
        details: { defId },
      });
      continue;
    }

    const fns = transformFn[key];
    for (const transformFnName of fns) {
      if (!isStringAs<TransformFnNames>(transformFnName)) {
        state.errors.push({
          message: `CombineFuncDefTable[${defId}]: Transform function '${key}' has invalid entry`,
          details: { defId },
        });
        continue;
      }
      const inputType = getTransformFnInputType(transformFnName);
      const returnType = getTransformFnReturnType(transformFnName);
      if (!inputType || !returnType) {
        state.errors.push({
          message: `CombineFuncDefTable[${defId}].transformFn.${key}: Invalid or unknown transform function "${transformFnName}"`,
          details: { defId, transformFn: transformFnName },
        });
      }
    }
  }

  if (hasNameAndTransformFn(entry)) {
    validateBinaryFnCompatibility(defId, entry.name, transformFn, state);
  }

  if (
    isStringAs<CombineDefineId | PipeDefineId | CondDefineId>(defId) &&
    !state.referencedDefs.has(defId)
  ) {
    state.warnings.push({
      message: `CombineFuncDefTable[${defId}]: Definition is never used`,
      details: { defId },
    });
  }
}

/**
 * Validates that transform function outputs match binary function inputs.
 */
function validateBinaryFnCompatibility(
  defId: string,
  binaryFnName: string,
  transformFn: Record<string, unknown>,
  state: ValidationState,
): void {
  if (!isStringAs<BinaryFnNames>(binaryFnName)) return;

  const paramTypes = getBinaryFnParamTypes(binaryFnName);
  if (!paramTypes) return;

  const [expectedParamA, expectedParamB] = paramTypes;

  if ("a" in transformFn && Array.isArray(transformFn.a) && transformFn.a.length > 0) {
    const lastFn: unknown = transformFn.a[transformFn.a.length - 1];
    if (isStringAs<TransformFnNames>(lastFn)) {
      const returnType = getTransformFnReturnType(lastFn);
      if (returnType && returnType !== expectedParamA) {
        state.errors.push({
          message: `CombineFuncDefTable[${defId}]: Transform function 'a' returns "${returnType}" but binary function "${binaryFnName}" expects "${expectedParamA}" for first parameter`,
          details: {
            defId,
            transformFn: lastFn,
            transformReturnType: returnType,
            binaryFn: binaryFnName,
            expectedType: expectedParamA,
          },
        });
      }
    }
  }

  if ("b" in transformFn && Array.isArray(transformFn.b) && transformFn.b.length > 0) {
    const lastFn: unknown = transformFn.b[transformFn.b.length - 1];
    if (isStringAs<TransformFnNames>(lastFn)) {
      const returnType = getTransformFnReturnType(lastFn);
      if (returnType && returnType !== expectedParamB) {
        state.errors.push({
          message: `CombineFuncDefTable[${defId}]: Transform function 'b' returns "${returnType}" but binary function "${binaryFnName}" expects "${expectedParamB}" for second parameter`,
          details: {
            defId,
            transformFn: lastFn,
            transformReturnType: returnType,
            binaryFn: binaryFnName,
            expectedType: expectedParamB,
          },
        });
      }
    }
  }
}

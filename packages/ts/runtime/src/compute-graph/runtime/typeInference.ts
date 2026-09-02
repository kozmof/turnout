import { getPresetMetadata } from "../../zig-runtime/preset-metadata.js";
import type { AnyValue, BaseTypeSymbol } from "../../state-control/value.js";
import type {
  ExecutionContext,
  ValueId,
  FuncId,
  CombineDefineId,
  PipeDefineId,
  CombineFnNames,
  TransformFnNames,
} from "../types.js";
import { isCondDefineId, isCombineDefineId, isPipeDefineId } from "../idValidation.js";

/**
 * Type-safe helper to get a value from the ValueTable.
 * Returns undefined if the value doesn't exist.
 */
function getValueFromTable(valueId: ValueId, context: ExecutionContext): AnyValue | undefined {
  return context.valueTable[valueId];
}

/**
 * Extracts the expected input type for a transform function.
 * Transform functions are namespaced, e.g., "transformFnNumber::pass"
 */
export function getTransformFnInputType(transformFnName: TransformFnNames): BaseTypeSymbol | null {
  return getPresetMetadata(transformFnName).inputType;
}

/**
 * Gets the return type of a transform function.
 * e.g., "transformFnNumber::toStr" returns "string"
 */
export function getTransformFnReturnType(transformFnName: TransformFnNames): BaseTypeSymbol | null {
  return getPresetMetadata(transformFnName).returnType;
}

/**
 * Gets the expected parameter types for a combine function.
 * e.g., "combineFnNumber::add" returns ["number", "number"]
 *
 * Note: Returns null for combineFnGeneric and combineFnArray functions because:
 * - Generic functions (like isEqual) can work with any type, requiring runtime type checking
 * - Array functions require element type information that depends on runtime values
 */
export function getCombineFnParamTypes(
  combineFnName: CombineFnNames,
): [BaseTypeSymbol, BaseTypeSymbol] | null {
  const parameterType = getPresetMetadata(combineFnName).parameterType;
  return parameterType === null ? null : [parameterType, parameterType];
}

/**
 * Gets the return type of a combine function.
 * e.g., "combineFnNumber::add" returns "number"
 */
export function getCombineFnReturnType(
  combineFnName: CombineFnNames,
  elemType?: BaseTypeSymbol,
): BaseTypeSymbol | null {
  return getPresetMetadata(combineFnName, elemType).returnType;
}

/**
 * Infers the type of a value in the ValueTable.
 * Returns the base type (for arrays, returns 'array').
 * Use inferValueElemType to get the element type of arrays.
 */
export function inferValueType(valueId: ValueId, context: ExecutionContext): BaseTypeSymbol | null {
  const value = getValueFromTable(valueId, context);
  if (!value) return null;
  return value.symbol;
}

/**
 * Infers the element type of an array value in the ValueTable.
 * Returns null for non-array values or untyped arrays.
 */
export function inferValueElemType(
  valueId: ValueId,
  context: ExecutionContext,
): BaseTypeSymbol | null {
  const value = getValueFromTable(valueId, context);
  if (!value) return null;

  // Only array values have element types
  if (value.symbol !== "array") return null;

  // Primitive arrays carry subSymbol metadata. Nested container arrays use the
  // first item symbol; schema validation guarantees homogeneous elements.
  const subSymbol = value.subSymbol ?? value.value[0]?.symbol;
  if (!subSymbol) return null;

  // Tags are tracked separately in the tags field.
  switch (subSymbol) {
    case "number":
    case "string":
    case "boolean":
    case "null":
    case "array":
    case "record":
      return subSymbol;
    default:
      return null;
  }
}

/**
 * Infers the return type of a function in the FuncTable.
 * This recursively analyzes the function definition to determine its output type.
 */
export function inferFuncReturnType(
  funcId: FuncId,
  context: ExecutionContext,
  visited: Set<FuncId> = new Set(),
): BaseTypeSymbol | null {
  // Prevent infinite recursion
  if (visited.has(funcId)) return null;
  visited.add(funcId);

  try {
    const funcEntry = context.funcTable[funcId];
    if (funcEntry === undefined) return null;
    const { defId } = funcEntry;

    // Check if it's a CombineFunc
    if (isCombineDefineId(defId, context.combineFuncDefTable)) {
      return inferCombineFuncReturnType(defId, context);
    }

    // Check if it's a PipeFunc
    if (isPipeDefineId(defId, context.pipeFuncDefTable)) {
      return inferPipeDefReturnType(defId, context, new Set());
    }

    // Check if it's a CondFunc
    if (isCondDefineId(defId, context.condFuncDefTable)) {
      const condDef = context.condFuncDefTable[defId];
      if (condDef === undefined) return null;

      // Branches must resolve to the same type to infer a single output type.
      const trueBranchType = inferFuncReturnType(condDef.trueBranchId, context, new Set(visited));
      const falseBranchType = inferFuncReturnType(condDef.falseBranchId, context, new Set(visited));

      if (trueBranchType === null || falseBranchType === null) return null;
      return trueBranchType === falseBranchType ? trueBranchType : null;
    }

    return null;
  } finally {
    visited.delete(funcId);
  }
}

/**
 * Infers the return type of a pipe definition by walking to its last step.
 * Takes a PipeDefineId directly so it can recurse into nested pipes without
 * requiring a FuncId intermediary.
 */
function inferPipeDefReturnType(
  defId: PipeDefineId,
  context: ExecutionContext,
  visited: Set<PipeDefineId>,
): BaseTypeSymbol | null {
  if (visited.has(defId)) return null;
  visited.add(defId);

  try {
    const def = context.pipeFuncDefTable[defId];
    if (def === undefined || def.sequence.length === 0) return null;

    const lastStep = def.sequence[def.sequence.length - 1];
    if (lastStep === undefined) return null;
    const lastStepDefId = lastStep.defId;

    if (isCombineDefineId(lastStepDefId, context.combineFuncDefTable)) {
      return inferCombineFuncReturnType(lastStepDefId, context);
    }

    if (isPipeDefineId(lastStepDefId, context.pipeFuncDefTable)) {
      return inferPipeDefReturnType(lastStepDefId, context, visited);
    }

    return null;
  } finally {
    visited.delete(defId);
  }
}

/**
 * Infers the return type of a CombineFunc definition.
 */
export function inferCombineFuncReturnType(
  defId: CombineDefineId,
  context: ExecutionContext,
): BaseTypeSymbol | null {
  const def = context.combineFuncDefTable[defId];
  if (def === undefined) return null;

  // For array combine functions, we'd need element type info
  // For now, we'll handle simple cases
  return getCombineFnReturnType(def.name);
}

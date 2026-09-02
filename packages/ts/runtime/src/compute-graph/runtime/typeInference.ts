import { getPresetMetadata, inferGraphType } from "../../zig-runtime/preset-metadata.js";
import type { BaseTypeSymbol } from "../../state-control/value.js";
import type {
  ExecutionContext,
  ValueId,
  FuncId,
  CombineDefineId,
  CombineFnNames,
  TransformFnNames,
} from "../types.js";

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
  return inferGraphType("value", valueId, context);
}

/**
 * Infers the element type of an array value in the ValueTable.
 * Returns null for non-array values or untyped arrays.
 */
export function inferValueElemType(
  valueId: ValueId,
  context: ExecutionContext,
): BaseTypeSymbol | null {
  return inferGraphType("element", valueId, context);
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
  if (visited.has(funcId)) return null;
  return inferGraphType("function", funcId, context);
}

/**
 * Infers the return type of a CombineFunc definition.
 */
export function inferCombineFuncReturnType(
  defId: CombineDefineId,
  context: ExecutionContext,
): BaseTypeSymbol | null {
  return inferGraphType("combine", defId, context);
}

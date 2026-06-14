import {
  metaBfBoolean,
  metaBfNumber,
  metaBfString,
  metaBfArray,
  metaBfGeneric,
} from "../../state-control/meta-chain/binary-fn/metaReturn.js";
import {
  metaBfBooleanParams,
  metaBfNumberParams,
  metaBfStringParams,
} from "../../state-control/meta-chain/binary-fn/metaParams.js";
import {
  metaTfBoolean,
  metaTfNumber,
  metaTfNull,
  metaTfString,
  metaTfArray,
} from "../../state-control/meta-chain/transform-fn/metaReturn.js";
import type { AnyValue, BaseTypeSymbol } from "../../state-control/value.js";
import type {
  ExecutionContext,
  ValueId,
  FuncId,
  CombineDefineId,
  PipeDefineId,
  BinaryFnNames,
  TransformFnNames,
} from "../types.js";
import { isCondDefineId, isCombineDefineId, isPipeDefineId } from "../idValidation.js";
import { splitPairBinaryFnNames, splitPairTranformFnNames } from "../../util/splitPair.js";

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
  const maySplit = splitPairTranformFnNames(transformFnName);
  if (maySplit === null) return null;
  const namespace = maySplit[0];

  switch (namespace) {
    case "transformFnBoolean":
      return "boolean";
    case "transformFnNumber":
      return "number";
    case "transformFnNull":
      return "null";
    case "transformFnString":
      return "string";
    case "transformFnArray":
      return "array";
    default:
      return null;
  }
}

/**
 * Gets the return type of a transform function.
 * e.g., "transformFnNumber::toStr" returns "string"
 */
export function getTransformFnReturnType(transformFnName: TransformFnNames): BaseTypeSymbol | null {
  const maySplit = splitPairTranformFnNames(transformFnName);
  if (maySplit === null) return null;
  const [namespace, fnName] = maySplit;

  switch (namespace) {
    case "transformFnBoolean": {
      const meta = metaTfBoolean();
      return Object.prototype.hasOwnProperty.call(meta, fnName) ? meta[fnName] : null;
    }
    case "transformFnNumber": {
      const meta = metaTfNumber();
      return Object.prototype.hasOwnProperty.call(meta, fnName) ? meta[fnName] : null;
    }
    case "transformFnNull": {
      const meta = metaTfNull();
      return Object.prototype.hasOwnProperty.call(meta, fnName) ? meta[fnName] : null;
    }
    case "transformFnString": {
      const meta = metaTfString();
      return Object.prototype.hasOwnProperty.call(meta, fnName) ? meta[fnName] : null;
    }
    case "transformFnArray": {
      const meta = metaTfArray();
      return Object.prototype.hasOwnProperty.call(meta, fnName) ? meta[fnName] : null;
    }
    default:
      return null;
  }
}

/**
 * Gets the expected parameter types for a binary function.
 * e.g., "binaryFnNumber::add" returns ["number", "number"]
 *
 * Note: Returns null for binaryFnGeneric and binaryFnArray functions because:
 * - Generic functions (like isEqual) can work with any type, requiring runtime type checking
 * - Array functions require element type information that depends on runtime values
 * - This design does not support nested arrays (array elements cannot be arrays)
 */
export function getBinaryFnParamTypes(
  binaryFnName: BinaryFnNames,
): [BaseTypeSymbol, BaseTypeSymbol] | null {
  const mayPair = splitPairBinaryFnNames(binaryFnName);
  if (mayPair === null) return null;
  const [namespace, fnName] = mayPair;

  switch (namespace) {
    case "binaryFnBoolean": {
      const meta = metaBfBooleanParams();
      return Object.prototype.hasOwnProperty.call(meta, fnName) ? meta[fnName] : null;
    }
    case "binaryFnNumber": {
      const meta = metaBfNumberParams();
      return Object.prototype.hasOwnProperty.call(meta, fnName) ? meta[fnName] : null;
    }
    case "binaryFnString": {
      const meta = metaBfStringParams();
      return Object.prototype.hasOwnProperty.call(meta, fnName) ? meta[fnName] : null;
    }
    case "binaryFnGeneric": {
      // Generic functions can work with any type, so we can't validate statically
      // We'd need to check that both params have the same type at runtime
      return null;
    }
    case "binaryFnArray": {
      // Array functions have complex param types (array + element type)
      // Would need the element type to validate properly
      return null;
    }
    default:
      return null;
  }
}

/**
 * Gets the return type of a binary function.
 * e.g., "binaryFnNumber::add" returns "number"
 */
export function getBinaryFnReturnType(
  binaryFnName: BinaryFnNames,
  elemType?: BaseTypeSymbol,
): BaseTypeSymbol | null {
  const mayPair = splitPairBinaryFnNames(binaryFnName);
  if (mayPair === null) return null;
  const [namespace, fnName] = mayPair;

  switch (namespace) {
    case "binaryFnBoolean": {
      const meta = metaBfBoolean();
      return Object.prototype.hasOwnProperty.call(meta, fnName) ? meta[fnName] : null;
    }
    case "binaryFnNumber": {
      const meta = metaBfNumber();
      return Object.prototype.hasOwnProperty.call(meta, fnName) ? meta[fnName] : null;
    }
    case "binaryFnString": {
      const meta = metaBfString();
      return Object.prototype.hasOwnProperty.call(meta, fnName) ? meta[fnName] : null;
    }
    case "binaryFnGeneric": {
      const meta = metaBfGeneric();
      return Object.prototype.hasOwnProperty.call(meta, fnName) ? meta[fnName] : null;
    }
    case "binaryFnArray": {
      // Array binary functions require a non-array element type
      // This design does not support nested arrays (array of arrays)
      if (!elemType || elemType === "array") return null;
      const meta = metaBfArray(elemType);
      return Object.prototype.hasOwnProperty.call(meta, fnName) ? meta[fnName] : null;
    }
    default:
      return null;
  }
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
  const valueType = inferValueType(valueId, context);
  if (valueType !== "array") return null;

  // Get element type from subSymbol
  const subSymbol = value.subSymbol;
  if (!subSymbol) return null;

  // Tags are tracked separately in the tags field.
  switch (subSymbol) {
    case "number":
    case "string":
    case "boolean":
    case "null":
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
    if (def.sequence.length === 0) return null;

    const lastStep = def.sequence[def.sequence.length - 1];
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

  // For array binary functions, we'd need element type info
  // For now, we'll handle simple cases
  return getBinaryFnReturnType(def.name);
}

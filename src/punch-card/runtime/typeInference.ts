import {
  metaBfNumber,
  metaBfString,
  metaBfArray,
  metaBfGeneric,
} from '../../state-control/meta-chain/binary-fn/metaReturn';
import {
  metaBfNumberParams,
  metaBfStringParams,
} from '../../state-control/meta-chain/binary-fn/metaParams';
import {
  metaTfNumber,
  metaTfString,
  metaTfArray,
} from '../../state-control/meta-chain/transform-fn/metaReturn';
import type { AnyValue, BaseTypeSymbol } from '../../state-control/value';
import type {
  ExecutionContext,
  ValueId,
  FuncId,
  CombineDefineId,
  BinaryFnNames,
  TransformFnNames,
} from '../types';
import { isCondDefineId, isCombineDefineId, isPipeDefineId } from '../idValidation';
import { splitPairBinaryFnNames, splitPairTranformFnNames } from '../../util/splitPair';

/**
 * Type-safe helper to get a value from the ValueTable.
 * Returns undefined if the value doesn't exist.
 */
function getValueFromTable(
  valueId: ValueId,
  context: ExecutionContext
): AnyValue | undefined {
  return context.valueTable[valueId];
}

/**
 * Extracts the expected input type for a transform function.
 * Transform functions are namespaced, e.g., "transformFnNumber::pass"
 */
export function getTransformFnInputType(
  transformFnName: TransformFnNames
): BaseTypeSymbol | null {
  const maySplit = splitPairTranformFnNames(transformFnName);
  if (maySplit === null) return null;
  const namespace = maySplit[0]

  switch (namespace) {
    case 'transformFnNumber':
      return 'number';
    case 'transformFnString':
      return 'string';
    case 'transformFnArray':
      return 'array';
    default:
      return null;
  }
}

/**
 * Gets the return type of a transform function.
 * e.g., "transformFnNumber::toStr" returns "string"
 */
export function getTransformFnReturnType(
  transformFnName: TransformFnNames
): BaseTypeSymbol | null {
  const maySplit = splitPairTranformFnNames(transformFnName)
  if(maySplit === null) return null;
  const [namespace, fnName] = maySplit;

  switch (namespace) {
    case 'transformFnNumber': {
      const meta = metaTfNumber();
      const result = meta[fnName];
      return result;
    }
    case 'transformFnString': {
      const meta = metaTfString();
      const result = meta[fnName];
      return result;
    }
    case 'transformFnArray': {
      const meta = metaTfArray();
      const result = meta[fnName];
      return result;
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
  binaryFnName: BinaryFnNames
): [BaseTypeSymbol, BaseTypeSymbol] | null {
  const mayPair = splitPairBinaryFnNames(binaryFnName);
  if (mayPair === null) return null;
  const [namespace, fnName] = mayPair;

  switch (namespace) {
    case 'binaryFnNumber': {
      const meta = metaBfNumberParams();
      const result = meta[fnName];
      return result;
    }
    case 'binaryFnString': {
      const meta = metaBfStringParams();
      const result = meta[fnName];
      return result;
    }
    case 'binaryFnGeneric': {
      // Generic functions can work with any type, so we can't validate statically
      // We'd need to check that both params have the same type at runtime
      return null;
    }
    case 'binaryFnArray': {
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
  elemType?: BaseTypeSymbol
): BaseTypeSymbol | null {
  const mayPair = splitPairBinaryFnNames(binaryFnName);
  if (mayPair === null) return null;
  const [namespace, fnName] = mayPair;

  switch (namespace) {
    case 'binaryFnNumber': {
      const meta = metaBfNumber();
      const result = meta[fnName];
      return result;
    }
    case 'binaryFnString': {
      const meta = metaBfString();
      const result = meta[fnName];
      return result;
    }
    case 'binaryFnGeneric': {
      const meta = metaBfGeneric();
      const result = meta[fnName];
      return result;
    }
    case 'binaryFnArray': {
      // Array binary functions require a non-array element type
      // This design does not support nested arrays (array of arrays)
      if (!elemType || elemType === 'array') return null;
      const meta = metaBfArray(elemType);
      const result = meta[fnName];
      return result;
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
export function inferValueType(
  valueId: ValueId,
  context: ExecutionContext
): BaseTypeSymbol | null {
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
  context: ExecutionContext
): BaseTypeSymbol | null {
  const value = getValueFromTable(valueId, context);
  if (!value) return null;

  // Only array values have element types
  const valueType = inferValueType(valueId, context);
  if (valueType !== 'array') return null;

  // Get element type from subSymbol
  const subSymbol = value.subSymbol;
  if (!subSymbol) return null;

  // Tags are tracked separately in the tags field
  return subSymbol as BaseTypeSymbol;
}

/**
 * Infers the return type of a function in the FuncTable.
 * This recursively analyzes the function definition to determine its output type.
 * TODO: infer all func type-chains
 */
export function inferFuncReturnType(
  funcId: FuncId,
  context: ExecutionContext,
  visited: Set<FuncId> = new Set()
): BaseTypeSymbol | null {
  // Prevent infinite recursion
  if (visited.has(funcId)) return null;
  visited.add(funcId);

  const funcEntry = context.funcTable[funcId];

  const { defId } = funcEntry;

  // Check if it's a CombineFunc
  if (isCombineDefineId(defId, context.combineFuncDefTable)) {
    return inferCombineFuncReturnType(defId, context);
  }

  // Check if it's a PipeFunc
  if (isPipeDefineId(defId, context.pipeFuncDefTable)) {
    const pipeDef = context.pipeFuncDefTable[defId];
    if (pipeDef.sequence.length === 0) return null;

    // Return type is the type of the last step in the sequence
    const lastStep = pipeDef.sequence[pipeDef.sequence.length - 1];
    const lastStepDefId = lastStep.defId;

    // Recursively infer the return type of the last step's definition
    if (isCombineDefineId(lastStepDefId, context.combineFuncDefTable)) {
      return inferCombineFuncReturnType(lastStepDefId, context);
    } else if (lastStepDefId in context.pipeFuncDefTable) {
      // Recursive PipeFunc - we need to create a dummy FuncId to recurse
      // This is a limitation of the current design where inferFuncReturnType expects FuncId
      // For now, just recurse on the definition directly by checking its structure
      if (!isPipeDefineId(lastStepDefId, context.pipeFuncDefTable)) return null;
      const nestedPipeDef = context.pipeFuncDefTable[lastStepDefId];
      if (nestedPipeDef.sequence.length === 0) return null;
      // Continue recursion manually to avoid circular FuncId dependency
      const nestedLastStep = nestedPipeDef.sequence[nestedPipeDef.sequence.length - 1];
      if (isCombineDefineId(nestedLastStep.defId, context.combineFuncDefTable)) {
        return inferCombineFuncReturnType(nestedLastStep.defId, context);
      }
      // For deeper nesting, return null (limitation)
      return null;
    } else if (lastStepDefId in context.condFuncDefTable) {
      // CondFunc type inference not yet fully supported
      return null;
    }

    return null;
  }

  // Check if it's a CondFunc
  if (isCondDefineId(defId, context.condFuncDefTable)) {
    const condDef = context.condFuncDefTable[defId];

    // For conditional functions, we'd need to ensure both branches return the same type
    // For now, we'll return the true branch type
    return inferFuncReturnType(condDef.trueBranchId, context, visited);
  }

  return null;
}

/**
 * Infers the return type of a CombineFunc definition.
 */
export function inferCombineFuncReturnType(
  defId: CombineDefineId,
  context: ExecutionContext
): BaseTypeSymbol | null {
  const def = context.combineFuncDefTable[defId];

  // For array binary functions, we'd need element type info
  // For now, we'll handle simple cases
  return getBinaryFnReturnType(def.name);
}

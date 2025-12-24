import {
  metaBfNumber,
  metaBfString,
  metaBfArray,
  metaBfGeneric,
} from '../../state-control/meta-chain/binary-fn/metaReturn';
import {
  metaBfNumberParams,
  metaBfStringParams,
  metaBfGenericParams,
} from '../../state-control/meta-chain/binary-fn/metaParams';
import {
  metaTfNumber,
  metaTfString,
  metaTfArray,
} from '../../state-control/meta-chain/transform-fn/metaReturn';
import type { DeterministicSymbol } from '../../state-control/value';
import type {
  ExecutionContext,
  ValueId,
  FuncId,
  PlugDefineId,
  BinaryFnNames,
  TransformFnNames,
} from '../types';

/**
 * Extracts the expected input type for a transform function.
 * Transform functions are namespaced, e.g., "transformFnNumber::pass"
 */
export function getTransformFnInputType(
  transformFnName: TransformFnNames
): DeterministicSymbol | null {
  const [namespace] = transformFnName.split('::');

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
): DeterministicSymbol | null {
  const [namespace, fnName] = transformFnName.split('::');

  switch (namespace) {
    case 'transformFnNumber': {
      const meta = metaTfNumber();
      return meta[fnName as keyof typeof meta] || null;
    }
    case 'transformFnString': {
      const meta = metaTfString();
      return meta[fnName as keyof typeof meta] || null;
    }
    case 'transformFnArray': {
      const meta = metaTfArray();
      return meta[fnName as keyof typeof meta] || null;
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
): [DeterministicSymbol, DeterministicSymbol] | null {
  const [namespace, fnName] = binaryFnName.split('::');

  switch (namespace) {
    case 'binaryFnNumber': {
      const meta = metaBfNumberParams();
      return meta[fnName as keyof typeof meta] || null;
    }
    case 'binaryFnString': {
      const meta = metaBfStringParams();
      return meta[fnName as keyof typeof meta] || null;
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
  elemType?: DeterministicSymbol
): DeterministicSymbol | null {
  const [namespace, fnName] = binaryFnName.split('::');

  switch (namespace) {
    case 'binaryFnNumber': {
      const meta = metaBfNumber();
      return meta[fnName as keyof typeof meta] || null;
    }
    case 'binaryFnString': {
      const meta = metaBfString();
      return meta[fnName as keyof typeof meta] || null;
    }
    case 'binaryFnGeneric': {
      const meta = metaBfGeneric();
      return meta[fnName as keyof typeof meta] || null;
    }
    case 'binaryFnArray': {
      // Array binary functions require a non-array element type
      // This design does not support nested arrays (array of arrays)
      if (!elemType || elemType === 'array') return null;
      const meta = metaBfArray(elemType);
      return meta[fnName as keyof typeof meta] || null;
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
): DeterministicSymbol | null {
  const value = context.valueTable[valueId];
  if (!value) return null;

  // Filter out random- prefix for type checking
  const symbol = value.symbol;
  if (symbol.startsWith('random-')) {
    return symbol.replace('random-', '') as DeterministicSymbol;
  }

  return symbol as DeterministicSymbol;
}

/**
 * Infers the element type of an array value in the ValueTable.
 * Returns null for non-array values or untyped arrays.
 */
export function inferValueElemType(
  valueId: ValueId,
  context: ExecutionContext
): DeterministicSymbol | null {
  const value = context.valueTable[valueId];
  if (!value) return null;

  // Only array values have element types
  const valueType = inferValueType(valueId, context);
  if (valueType !== 'array') return null;

  // Get element type from subSymbol
  const subSymbol = value.subSymbol;
  if (!subSymbol) return null;

  // Filter out random- prefix for type checking
  if (typeof subSymbol === 'string' && subSymbol.startsWith('random-')) {
    return subSymbol.replace('random-', '') as DeterministicSymbol;
  }

  return subSymbol as DeterministicSymbol;
}

/**
 * Infers the return type of a function in the FuncTable.
 * This recursively analyzes the function definition to determine its output type.
 */
export function inferFuncReturnType(
  funcId: FuncId,
  context: ExecutionContext,
  visited: Set<FuncId> = new Set()
): DeterministicSymbol | null {
  // Prevent infinite recursion
  if (visited.has(funcId)) return null;
  visited.add(funcId);

  const funcEntry = context.funcTable[funcId];
  if (!funcEntry) return null;

  const { defId } = funcEntry;

  // Check if it's a PlugFunc
  if (defId in context.plugFuncDefTable) {
    return inferPlugFuncReturnType(
      defId as PlugDefineId,
      context,
      visited
    );
  }

  // Check if it's a TapFunc
  if (defId in context.tapFuncDefTable) {
    const tapDef = context.tapFuncDefTable[defId as any];
    if (tapDef.sequence.length === 0) return null;

    // Return type is the type of the last step in the sequence
    const lastStep = tapDef.sequence[tapDef.sequence.length - 1];
    const lastStepDefId = lastStep.defId;

    // Recursively infer the return type of the last step's definition
    if (lastStepDefId in context.plugFuncDefTable) {
      return inferPlugFuncReturnType(
        lastStepDefId as PlugDefineId,
        context,
        visited
      );
    } else if (lastStepDefId in context.tapFuncDefTable) {
      // Recursive TapFunc - we need to create a dummy FuncId to recurse
      // This is a limitation of the current design where inferFuncReturnType expects FuncId
      // For now, just recurse on the definition directly by checking its structure
      const nestedTapDef = context.tapFuncDefTable[lastStepDefId as any];
      if (nestedTapDef.sequence.length === 0) return null;
      // Continue recursion manually to avoid circular FuncId dependency
      const nestedLastStep = nestedTapDef.sequence[nestedTapDef.sequence.length - 1];
      if (nestedLastStep.defId in context.plugFuncDefTable) {
        return inferPlugFuncReturnType(
          nestedLastStep.defId as PlugDefineId,
          context,
          visited
        );
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
  if (defId in context.condFuncDefTable) {
    const condDef = context.condFuncDefTable[defId as any];

    // For conditional functions, we'd need to ensure both branches return the same type
    // For now, we'll return the true branch type
    return inferFuncReturnType(condDef.trueBranchId, context, visited);
  }

  return null;
}

/**
 * Infers the return type of a PlugFunc definition.
 */
export function inferPlugFuncReturnType(
  defId: PlugDefineId,
  context: ExecutionContext,
  visited: Set<FuncId> = new Set()
): DeterministicSymbol | null {
  const def = context.plugFuncDefTable[defId];
  if (!def) return null;

  // For array binary functions, we'd need element type info
  // For now, we'll handle simple cases
  return getBinaryFnReturnType(def.name);
}

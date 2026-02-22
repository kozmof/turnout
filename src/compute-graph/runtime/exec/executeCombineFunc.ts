import { FuncId, CombineDefineId, ExecutionContext, ExecutionResult } from '../../types';
import { getBinaryFn } from '../../call-presets/getBinaryFn';
import { getTransformFn } from '../../call-presets/getTranformFn';

/**
 * Executes a CombineFunc and returns the result along with updated state.
 * This is a pure function - it does not mutate the input context.
 *
 * @param funcId - The function instance to execute
 * @param defId - The function definition ID
 * @param context - The execution context (read-only)
 * @returns Execution result with computed value and updated value table
 */
export function executeCombineFunc(
  funcId: FuncId,
  defId: CombineDefineId,
  context: ExecutionContext
): ExecutionResult {
  const funcEntry = context.funcTable[funcId];
  if (funcEntry.kind !== 'combine') {
    throw new Error(`executeCombineFunc called with non-combine entry for ${funcId}`);
  }
  const def = context.combineFuncDefTable[defId];

  // Get transform functions (Fix 4: direct TransformFnNames, no .name wrapper)
  const transformFnA = getTransformFn(def.transformFn.a);
  const transformFnB = getTransformFn(def.transformFn.b);

  // Get binary function
  const binaryFn = getBinaryFn(def.name);

  // Resolve argument values from argMap
  const argAId = funcEntry.argMap['a'];
  const argBId = funcEntry.argMap['b'];

  const valA = context.valueTable[argAId];
  const valB = context.valueTable[argBId];

  // Apply transforms and binary function
  const transformedA = transformFnA(valA);
  const transformedB = transformFnB(valB);
  const result = binaryFn(transformedA, transformedB);

  // Return result with updated value table (immutable update)
  return {
    value: result,
    updatedValueTable: {
      ...context.valueTable,
      [funcEntry.returnId]: result,
    },
  };
}

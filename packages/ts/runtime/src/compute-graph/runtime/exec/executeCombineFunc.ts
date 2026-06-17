import { FuncId, CombineDefineId, ExecutionContext, ExecutionResult } from "../../types.js";
import { createArgName } from "../../idValidation.js";
import { getBinaryFn } from "../../call-presets/getBinaryFn.js";
import { getTransformFn } from "../../call-presets/getTranformFn.js";

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
  context: ExecutionContext,
): ExecutionResult {
  const funcEntry = context.funcTable[funcId];
  if (funcEntry === undefined || funcEntry.kind !== "combine") {
    throw new Error(`executeCombineFunc called with non-combine entry for ${funcId}`);
  }
  const def = context.combineFuncDefTable[defId];
  if (def === undefined) {
    throw new Error(`executeCombineFunc: missing combine definition ${defId}`);
  }

  // Get binary function
  const binaryFn = getBinaryFn(def.name);

  // Resolve argument values from argMap
  const argAId = funcEntry.argMap[createArgName("a")];
  const argBId = funcEntry.argMap[createArgName("b")];
  if (argAId === undefined || argBId === undefined) {
    throw new Error(`executeCombineFunc: combine ${funcId} is missing arg a/b in argMap`);
  }

  const valA = context.valueTable[argAId];
  const valB = context.valueTable[argBId];
  if (valA === undefined || valB === undefined) {
    throw new Error(`executeCombineFunc: missing value table entry for an arg of ${funcId}`);
  }

  // Apply the transform chain for each arg: each fn in the array is applied in order.
  const transformedA = def.transformFn.a.reduce((v, fn) => getTransformFn(fn)(v), valA);
  const transformedB = def.transformFn.b.reduce((v, fn) => getTransformFn(fn)(v), valB);
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

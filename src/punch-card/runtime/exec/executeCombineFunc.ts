import { FuncId, CombineDefineId, ExecutionContext, ValueTable } from '../../types';
import { getBinaryFn } from '../../call-presets/getBinaryFn';
import { getTransformFn } from '../../call-presets/getTranformFn';
import { AnyValue } from '../../../state-control/value';

/**
 * Execution result containing the computed value and updated state.
 * This makes side effects explicit instead of relying on mutation.
 */
export type ExecutionResult = {
  readonly value: AnyValue;
  readonly updatedValueTable: ValueTable;
};

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
  const def = context.combineFuncDefTable[defId];

  // Get transform functions
  const transformFnA = getTransformFn(def.transformFn.a.name);
  const transformFnB = getTransformFn(def.transformFn.b.name);

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

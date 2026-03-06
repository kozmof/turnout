import { FuncId, ExecutionContext, ExecutionResult } from '../../types';
import { AnyValue } from '../../../state-control/value';

/**
 * Executes a CondFunc and returns the result along with updated state.
 * This is a pure function - it does not mutate the input context.
 *
 * @param funcId - The function instance to execute
 * @param context - The execution context (read-only)
 * @param selectedValue - The already-selected branch value
 * @returns Execution result with computed value and updated value table
 */
export function executeCondFunc(
  funcId: FuncId,
  context: ExecutionContext,
  selectedValue: AnyValue
): ExecutionResult {
  const funcEntry = context.funcTable[funcId];

  // Return result with updated value table (immutable update)
  return {
    value: selectedValue,
    updatedValueTable: {
      ...context.valueTable,
      [funcEntry.returnId]: selectedValue,
    },
  };
}

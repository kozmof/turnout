import { FuncId, ExecutionContext, ExecutionResult } from '../../types';
import {
  createFunctionExecutionError,
} from '../errors';
import { AnyValue } from '../../../state-control/value';

/**
 * Executes a CondFunc and returns the result along with updated state.
 * This is a pure function - it does not mutate the input context.
 *
 * @param funcId - The function instance to execute
 * @param context - The execution context (read-only)
 * @param conditionResult - The evaluated condition value
 * @param trueResult - The result if condition is true
 * @param falseResult - The result if condition is false
 * @returns Execution result with computed value and updated value table
 */
export function executeCondFunc(
  funcId: FuncId,
  context: ExecutionContext,
  conditionResult: AnyValue,
  trueResult: AnyValue,
  falseResult: AnyValue
): ExecutionResult {
  const funcEntry = context.funcTable[funcId];

  // Evaluate condition - it should be a boolean value
  if (conditionResult.symbol !== 'boolean') {
    throw createFunctionExecutionError(
      funcId,
      `Condition must evaluate to a boolean, got ${conditionResult.symbol}`
    );
  }

  // Select the appropriate result based on condition
  const result = conditionResult.value ? trueResult : falseResult;

  // Return result with updated value table (immutable update)
  return {
    value: result,
    updatedValueTable: {
      ...context.valueTable,
      [funcEntry.returnId]: result,
    },
  };
}

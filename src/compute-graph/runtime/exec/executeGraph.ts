import { FuncId } from '../../types';
import {
  GraphExecutionError,
  createFunctionExecutionError,
  isGraphExecutionError,
} from '../errors';
import { buildExecutionTree } from '../buildExecutionTree';
import { executeTree } from '../executeTree';
import type { ValidatedContext } from '../validateContext';
import { type ExecutionResult } from '../../types';

/**
 * Executes a computation graph starting from a root function.
 * This is a pure function - it does not mutate the input context.
 *
 * Accepts only a ValidatedContext - callers must validate the context first
 * using validateContext, assertValidContext, or isValidContext.
 *
 * @param rootFuncId - The root function to execute
 * @param context - The validated execution context (read-only)
 * @returns Execution result with computed value and updated value table
 */
export function executeGraph(
  rootFuncId: FuncId,
  context: ValidatedContext,
): ExecutionResult {
  // 1. Build execution tree
  const tree = buildExecutionTree(rootFuncId, context);

  // 2. Execute tree (post-order traversal) - returns result with updated state
  const result = executeTree(tree, context);

  return result;
}

/**
 * Safe version of executeGraph that catches errors and returns them.
 * This is a pure function - it does not mutate the input context.
 *
 * Accepts only a ValidatedContext - callers must validate the context first
 * using validateContext, assertValidContext, or isValidContext.
 *
 * @param rootFuncId - The root function to execute
 * @param context - The validated execution context (read-only)
 * @returns Object containing either the result or errors
 */
export function executeGraphSafe(
  rootFuncId: FuncId,
  context: ValidatedContext,
): { result?: ExecutionResult; errors: GraphExecutionError[] } {
  const errors: GraphExecutionError[] = [];

  try {
    const result = executeGraph(rootFuncId, context);
    return { result, errors };
  } catch (error) {
    if (isGraphExecutionError(error)) {
      errors.push(error);
    } else {
      errors.push(
        createFunctionExecutionError(
          rootFuncId,
          String(error),
          error instanceof Error ? error : undefined
        )
      );
    }
    return { errors };
  }
}

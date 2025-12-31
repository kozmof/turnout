import { FuncId, ExecutionContext } from '../../types';
import {
  GraphExecutionError,
  createFunctionExecutionError,
  isGraphExecutionError,
} from '../errors';
import { buildExecutionTree } from '../buildExecutionTree';
import { executeTree } from '../executeTree';
import { validateContext } from '../validateContext';
import { type ExecutionResult } from './executePlugFunc';

/**
 * Executes a computation graph starting from a root function.
 * This is a pure function - it does not mutate the input context.
 *
 * @param rootFuncId - The root function to execute
 * @param context - The execution context (read-only)
 * @param options - Execution options
 * @returns Execution result with computed value and updated value table
 */
export function executeGraph(
  rootFuncId: FuncId,
  context: ExecutionContext,
  options: { skipValidation?: boolean } = {}
): ExecutionResult {
  // 0. Validate context before execution (unless explicitly skipped)
  if (!options.skipValidation) {
    const validationResult = validateContext(context);
    if (!validationResult.valid) {
      const errorMessages = validationResult.errors
        .map(err => `  - ${err.message}`)
        .join('\n');
      throw createFunctionExecutionError(
        rootFuncId,
        `ExecutionContext validation failed:\n${errorMessages}`
      );
    }
  }

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
 * @param rootFuncId - The root function to execute
 * @param context - The execution context (read-only)
 * @param options - Execution options
 * @returns Object containing either the result or errors
 */
export function executeGraphSafe(
  rootFuncId: FuncId,
  context: ExecutionContext,
  options: { skipValidation?: boolean } = {}
): { result?: ExecutionResult; errors: GraphExecutionError[] } {
  const errors: GraphExecutionError[] = [];

  try {
    const result = executeGraph(rootFuncId, context, options);
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

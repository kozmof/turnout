import { FuncId, ExecutionContext } from '../../types';
import { AnyValue } from '../../../state-control/value';
import {
  GraphExecutionError,
  createFunctionExecutionError,
  isGraphExecutionError,
} from '../errors';
import { buildExecutionTree } from '../buildExecutionTree';
import { executeTree } from '../executeTree';
import { validateContext } from '../validateContext';

export function executeGraph(
  rootFuncId: FuncId,
  context: ExecutionContext,
  options: { skipValidation?: boolean } = {}
): AnyValue {
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

  // 2. Execute tree (post-order traversal)
  const result = executeTree(tree, context);

  if (!result) {
    throw createFunctionExecutionError(
      rootFuncId,
      'Root function did not produce a result'
    );
  }

  return result;
}

export function executeGraphSafe(
  rootFuncId: FuncId,
  context: ExecutionContext,
  options: { skipValidation?: boolean } = {}
): { result?: AnyValue; errors: GraphExecutionError[] } {
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

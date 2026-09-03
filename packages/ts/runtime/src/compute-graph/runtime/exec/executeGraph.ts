import { FuncId } from "../../types.js";
import {
  GraphExecutionError,
  createEmptySequenceError,
  createFunctionExecutionError,
  createMissingValueError,
  isGraphExecutionError,
} from "../errors.js";
import type { ValidatedContext } from "../validateContext.js";
import { type ExecutionResult, type ValueTable } from "../../types.js";
import { defaultZigRuntimeClient } from "../../../zig-runtime/default-client.js";
import {
  fromCanonicalValue,
  toCanonicalOperationValue,
} from "../../../zig-runtime/value-codec.js";

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
export function executeGraph(rootFuncId: FuncId, context: ValidatedContext): ExecutionResult {
  const valueTable = Object.fromEntries(
    Object.entries(context.valueTable).map(([id, value]) => [id, toCanonicalOperationValue(value)]),
  );
  const response = defaultZigRuntimeClient.compute<{
    value: unknown;
    updatedValueTable: Record<string, unknown>;
    error?: string;
  }>({
    rootFuncId,
    context: { ...context, valueTable },
  });
  if (response.status !== "ok") {
    const message = response.payload.error ?? response.status;
    if (message === "EmptyPipe") throw createEmptySequenceError(rootFuncId);
    if (message === "MissingValue") {
      const root = context.funcTable[rootFuncId];
      if (root !== undefined && "argMap" in root) {
        const returnIds = new Set(Object.values(context.funcTable).map((entry) => entry.returnId));
        const missing = Object.values(root.argMap).find(
          (id) => context.valueTable[id] === undefined && !returnIds.has(id),
        );
        if (missing !== undefined) throw createMissingValueError(missing);
      }
    }
    if (message === "GraphCycle") {
      throw createFunctionExecutionError(rootFuncId, `Cycle detected at node ${rootFuncId}`);
    }
    throw createFunctionExecutionError(rootFuncId, message);
  }
  const updatedValueTable = Object.fromEntries(
    Object.entries(response.payload.updatedValueTable).map(([id, value]) => [
      id,
      fromCanonicalValue(value),
    ]),
  ) as ValueTable;
  return { value: fromCanonicalValue(response.payload.value), updatedValueTable };
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
          error instanceof Error ? error : undefined,
        ),
      );
    }
    return { errors };
  }
}

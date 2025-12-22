import { ExecutionContext, ValueTable, ValueId } from '../types';
import { AnyValue } from '../../state-control/value';

/**
 * Creates a shallow clone of the ExecutionContext with a fresh mutable ValueTable.
 * This protects the original context from mutation during execution.
 *
 * Note: The definition tables (plugFuncDefTable, tapFuncDefTable, condFuncDefTable)
 * are shared references as they should not be modified during execution.
 */
export function cloneContextForExecution(context: ExecutionContext): ExecutionContext {
  return {
    valueTable: { ...context.valueTable },
    funcTable: context.funcTable,
    plugFuncDefTable: context.plugFuncDefTable,
    tapFuncDefTable: context.tapFuncDefTable,
    condFuncDefTable: context.condFuncDefTable,
    returnIdToFuncId: context.returnIdToFuncId,
  };
}

/**
 * Creates a read-only view of the ExecutionContext.
 * This prevents accidental mutation of the context.
 *
 * Note: This is a shallow freeze and doesn't prevent deep mutations.
 * Use this for contexts that should not be modified.
 */
export function freezeContext(context: ExecutionContext): Readonly<ExecutionContext> {
  return Object.freeze({
    ...context,
    valueTable: Object.freeze({ ...context.valueTable }),
  });
}

/**
 * Extracts the final state of the ValueTable after execution.
 * This creates an immutable snapshot that can be safely shared.
 */
export function extractValueTable(context: ExecutionContext): Readonly<ValueTable> {
  return Object.freeze({ ...context.valueTable });
}

/**
 * Sets a value in the context's ValueTable.
 * This is an internal helper that documents the mutation pattern.
 * @internal
 */
export function setValueInContext(
  context: ExecutionContext,
  valueId: ValueId,
  value: AnyValue
): void {
  context.valueTable[valueId] = value;
}

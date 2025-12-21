import { FuncId, CondDefineId, ExecutionContext } from '../../types';
import {
  createMissingDefinitionError,
  createMissingValueError,
  createFunctionExecutionError,
} from '../errors';
import { AnyValue } from '../../../state-control/value';

export function executeCondFunc(
  funcId: FuncId,
  defId: CondDefineId,
  context: ExecutionContext,
  conditionResult: AnyValue,
  trueResult: AnyValue,
  falseResult: AnyValue
): void {
  const funcEntry = context.funcTable[funcId];
  const def = context.condFuncDefTable[defId];

  if (!def) {
    throw createMissingDefinitionError(defId, funcId);
  }

  // Evaluate condition - it should be a boolean value
  if (conditionResult.symbol !== 'boolean') {
    throw createFunctionExecutionError(
      funcId,
      `Condition must evaluate to a boolean, got ${conditionResult.symbol}`
    );
  }

  // Select the appropriate result based on condition
  const result = conditionResult.value ? trueResult : falseResult;

  // Store result in ValueTable
  context.valueTable[funcEntry.returnId] = result;
}

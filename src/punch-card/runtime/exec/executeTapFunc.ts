import { FuncId, TapDefineId, ExecutionContext } from '../../types';
import {
  createMissingDefinitionError,
  createEmptySequenceError,
  createMissingDependencyError,
  createMissingValueError,
} from '../errors';
import { AnyValue } from '../../../state-control/value';

export function executeTapFunc(
  funcId: FuncId,
  defId: TapDefineId,
  context: ExecutionContext
): void {
  const funcEntry = context.funcTable[funcId];
  const def = context.tapFuncDefTable[defId];

  if (!def) {
    throw createMissingDefinitionError(defId, funcId);
  }

  if (def.sequence.length === 0) {
    throw createEmptySequenceError(funcId);
  }

  const results: AnyValue[] = [];

  // Iterate through sequence and collect results
  for (const stepFuncId of def.sequence) {
    const stepFuncEntry = context.funcTable[stepFuncId];

    if (!stepFuncEntry) {
      throw createMissingDependencyError(stepFuncId, funcId);
    }

    const stepResult = context.valueTable[stepFuncEntry.returnId];

    if (!stepResult) {
      throw createMissingValueError(stepFuncEntry.returnId);
    }

    results.push(stepResult);
  }

  // Return the last result (TapFunc semantics)
  const finalResult = results[results.length - 1];

  // Store result in ValueTable
  context.valueTable[funcEntry.returnId] = finalResult;
}

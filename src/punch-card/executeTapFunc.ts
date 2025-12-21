import { FuncId, TapDefineId, ExecutionContext } from './types';
import { GraphExecutionError } from './errors';
import { AnyValue } from '../state-control/value';

export function executeTapFunc(
  funcId: FuncId,
  defId: TapDefineId,
  context: ExecutionContext
): void {
  const funcEntry = context.funcTable[funcId];
  const def = context.tapFuncDefTable[defId];

  if (!def) {
    throw {
      kind: 'missingDefinition',
      missingDefId: defId,
      funcId,
    } as GraphExecutionError;
  }

  if (def.sequence.length === 0) {
    throw {
      kind: 'emptySequence',
      funcId,
    } as GraphExecutionError;
  }

  const results: AnyValue[] = [];

  // Iterate through sequence and collect results
  for (const stepFuncId of def.sequence) {
    const stepFuncEntry = context.funcTable[stepFuncId];

    if (!stepFuncEntry) {
      throw {
        kind: 'missingDependency',
        missingId: stepFuncId,
        dependentId: funcId,
      } as GraphExecutionError;
    }

    const stepResult = context.valueTable[stepFuncEntry.returnId];

    if (!stepResult) {
      throw {
        kind: 'missingValue',
        valueId: stepFuncEntry.returnId,
      } as GraphExecutionError;
    }

    results.push(stepResult);
  }

  // Return the last result (TapFunc semantics)
  const finalResult = results[results.length - 1];

  // Store result in ValueTable
  context.valueTable[funcEntry.returnId] = finalResult;
}

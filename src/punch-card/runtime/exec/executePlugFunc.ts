import { FuncId, PlugDefineId, ExecutionContext, ValueId } from '../../types';
import { GraphExecutionError } from '../errors';
import { getBinaryFn } from '../../call-presets/getBinaryFn';
import { getTransformFn } from '../../call-presets/getTranformFn';
import { AnyValue } from '../../../state-control/value';

export function executePlugFunc(
  funcId: FuncId,
  defId: PlugDefineId,
  context: ExecutionContext
): void {
  const funcEntry = context.funcTable[funcId];
  const def = context.plugFuncDefTable[defId];

  if (!def) {
    throw {
      kind: 'missingDefinition',
      missingDefId: defId,
      funcId,
    } as GraphExecutionError;
  }

  // Get transform functions
  const transformFnA = getTransformFn(def.transformFn.a.name);
  const transformFnB = getTransformFn(def.transformFn.b.name);

  // Get binary function
  const binaryFn = getBinaryFn(def.name);

  // Resolve argument values from argMap
  const argAId = funcEntry.argMap['a'] as ValueId;
  const argBId = funcEntry.argMap['b'] as ValueId;

  if (!argAId || !argBId) {
    throw {
      kind: 'functionExecution',
      funcId,
      message: 'Missing required args "a" or "b" in argMap',
    } as GraphExecutionError;
  }

  const valA = context.valueTable[argAId];
  const valB = context.valueTable[argBId];

  if (!valA) {
    throw {
      kind: 'missingValue',
      valueId: argAId,
    } as GraphExecutionError;
  }

  if (!valB) {
    throw {
      kind: 'missingValue',
      valueId: argBId,
    } as GraphExecutionError;
  }

  // Apply transforms and binary function
  const transformedA = transformFnA(valA);
  const transformedB = transformFnB(valB);
  const result = binaryFn(transformedA, transformedB);

  // Store result in ValueTable
  context.valueTable[funcEntry.returnId] = result;
}

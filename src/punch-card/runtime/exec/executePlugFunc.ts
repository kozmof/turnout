import { FuncId, PlugDefineId, ExecutionContext, ValueId } from '../../types';
import { getBinaryFn } from '../../call-presets/getBinaryFn';
import { getTransformFn } from '../../call-presets/getTranformFn';

export function executePlugFunc(
  funcId: FuncId,
  defId: PlugDefineId,
  context: ExecutionContext
): void {
  const funcEntry = context.funcTable[funcId];
  const def = context.plugFuncDefTable[defId];

  // Get transform functions
  const transformFnA = getTransformFn(def.transformFn.a.name);
  const transformFnB = getTransformFn(def.transformFn.b.name);

  // Get binary function
  const binaryFn = getBinaryFn(def.name);

  // Resolve argument values from argMap
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const argAId = funcEntry.argMap['a'] as ValueId;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const argBId = funcEntry.argMap['b'] as ValueId;

  const valA = context.valueTable[argAId];
  const valB = context.valueTable[argBId];

  // Apply transforms and binary function
  const transformedA = transformFnA(valA);
  const transformedB = transformFnB(valB);
  const result = binaryFn(transformedA, transformedB);

  // Store result in ValueTable
  context.valueTable[funcEntry.returnId] = result;
}

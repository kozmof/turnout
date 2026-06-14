import type { combine, FuncId, ValueId } from 'runtime';

export type LocalFuncOutputRef = { readonly __type: 'funcOutput'; readonly funcId: string };
export type LocalStepOutputRef = { readonly __type: 'stepOutput'; readonly pipeFuncId: string; readonly stepIndex: number };
export type LocalTransformRef = {
  readonly __type: 'transform';
  readonly valueRef: { readonly __type: 'value'; readonly id: string };
  readonly transformFn: readonly string[];
};

export type CombineArgRef = Parameters<typeof combine>[1]['a'];

export function toFuncId(value: string): FuncId {
  return value as FuncId;
}

export function toValueId(value: string): ValueId {
  return value as ValueId;
}

export function toCombineArgRef(value: unknown): CombineArgRef {
  return value as CombineArgRef;
}

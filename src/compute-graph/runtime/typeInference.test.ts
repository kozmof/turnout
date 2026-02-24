import { describe, it, expect } from 'vitest';
import { inferFuncReturnType } from './typeInference';
import type { ExecutionContext, FuncId } from '../types';

function buildCondContext(
  trueBranchFuncId: string,
  falseBranchFuncId: string,
  trueBranchName: 'binaryFnNumber::add' | 'binaryFnString::concat',
  falseBranchName: 'binaryFnNumber::add' | 'binaryFnString::concat'
): ExecutionContext {
  return {
    valueTable: {} as any,
    funcTable: {
      cond1: {
        kind: 'cond',
        defId: 'cd_cond1' as any,
        returnId: 'v_cond1' as any,
      },
      [trueBranchFuncId]: {
        kind: 'combine',
        defId: 'cd_true' as any,
        argMap: {} as any,
        returnId: 'v_true' as any,
      },
      [falseBranchFuncId]: {
        kind: 'combine',
        defId: 'cd_false' as any,
        argMap: {} as any,
        returnId: 'v_false' as any,
      },
    } as any,
    combineFuncDefTable: {
      cd_true: {
        name: trueBranchName,
        transformFn: {
          a: trueBranchName === 'binaryFnNumber::add'
            ? 'transformFnNumber::pass'
            : 'transformFnString::pass',
          b: trueBranchName === 'binaryFnNumber::add'
            ? 'transformFnNumber::pass'
            : 'transformFnString::pass',
        },
      },
      cd_false: {
        name: falseBranchName,
        transformFn: {
          a: falseBranchName === 'binaryFnNumber::add'
            ? 'transformFnNumber::pass'
            : 'transformFnString::pass',
          b: falseBranchName === 'binaryFnNumber::add'
            ? 'transformFnNumber::pass'
            : 'transformFnString::pass',
        },
      },
    } as any,
    pipeFuncDefTable: {} as any,
    condFuncDefTable: {
      cd_cond1: {
        conditionId: { source: 'value', id: 'v_condition' as any },
        trueBranchId: trueBranchFuncId as any,
        falseBranchId: falseBranchFuncId as any,
      },
    } as any,
  };
}

describe('typeInference', () => {
  describe('inferFuncReturnType', () => {
    it('returns the shared branch type for cond functions', () => {
      const context = buildCondContext(
        'f_true',
        'f_false',
        'binaryFnNumber::add',
        'binaryFnNumber::add'
      );

      const result = inferFuncReturnType('cond1' as FuncId, context);
      expect(result).toBe('number');
    });

    it('returns null when cond branches have different return types', () => {
      const context = buildCondContext(
        'f_true',
        'f_false',
        'binaryFnNumber::add',
        'binaryFnString::concat'
      );

      const result = inferFuncReturnType('cond1' as FuncId, context);
      expect(result).toBeNull();
    });

    it('handles cond branches that reference the same function id', () => {
      const context = buildCondContext(
        'f_shared',
        'f_shared',
        'binaryFnNumber::add',
        'binaryFnNumber::add'
      );

      const result = inferFuncReturnType('cond1' as FuncId, context);
      expect(result).toBe('number');
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  getBinaryFnParamTypes,
  getBinaryFnReturnType,
  getTransformFnInputType,
  getTransformFnReturnType,
  inferCombineFuncReturnType,
  inferFuncReturnType,
  inferValueElemType,
  inferValueType,
} from './typeInference';
import type { CombineDefineId, ExecutionContext, FuncId, PipeDefineId, ValueId } from '../types';

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
        conditionId: { kind: 'value', id: 'v_condition' as any },
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


describe('typeInference metadata helpers', () => {
  it('resolves transform input and return types for all namespaces', () => {
    expect(getTransformFnInputType('transformFnBoolean::not' as any)).toBe('boolean');
    expect(getTransformFnInputType('transformFnNumber::abs' as any)).toBe('number');
    expect(getTransformFnInputType('transformFnNull::pass' as any)).toBe('null');
    expect(getTransformFnInputType('transformFnString::trim' as any)).toBe('string');
    expect(getTransformFnInputType('transformFnArray::length' as any)).toBe('array');
    expect(getTransformFnInputType('bad-name' as any)).toBeNull();

    expect(getTransformFnReturnType('transformFnBoolean::toStr' as any)).toBe('string');
    expect(getTransformFnReturnType('transformFnNumber::toStr' as any)).toBe('string');
    expect(getTransformFnReturnType('transformFnNull::pass' as any)).toBe('null');
    expect(getTransformFnReturnType('transformFnString::length' as any)).toBe('number');
    expect(getTransformFnReturnType('transformFnArray::isEmpty' as any)).toBe('boolean');
    expect(getTransformFnReturnType('transformFnNumber::missing' as any)).toBeNull();
    expect(getTransformFnReturnType('bad-name' as any)).toBeNull();
  });

  it('resolves binary parameter and return types across namespaces', () => {
    expect(getBinaryFnParamTypes('binaryFnBoolean::and' as any)).toEqual(['boolean', 'boolean']);
    expect(getBinaryFnParamTypes('binaryFnNumber::add' as any)).toEqual(['number', 'number']);
    expect(getBinaryFnParamTypes('binaryFnString::concat' as any)).toEqual(['string', 'string']);
    expect(getBinaryFnParamTypes('binaryFnGeneric::isEqual' as any)).toBeNull();
    expect(getBinaryFnParamTypes('binaryFnArray::get' as any)).toBeNull();
    expect(getBinaryFnParamTypes('binaryFnNumber::missing' as any)).toBeNull();
    expect(getBinaryFnParamTypes('bad-name' as any)).toBeNull();
    expect(getBinaryFnParamTypes('binaryFnBogus::x' as any)).toBeNull();

    expect(getBinaryFnReturnType('binaryFnBoolean::or' as any)).toBe('boolean');
    expect(getBinaryFnReturnType('binaryFnNumber::add' as any)).toBe('number');
    expect(getBinaryFnReturnType('binaryFnString::includes' as any)).toBe('boolean');
    expect(getBinaryFnReturnType('binaryFnGeneric::isNotEqual' as any)).toBe('boolean');
    expect(getBinaryFnReturnType('binaryFnArray::get' as any, 'number')).toBe('number');
    expect(getBinaryFnReturnType('binaryFnArray::get' as any)).toBeNull();
    expect(getBinaryFnReturnType('binaryFnArray::get' as any, 'array')).toBeNull();
    expect(getBinaryFnReturnType('binaryFnNumber::missing' as any)).toBeNull();
    expect(getBinaryFnReturnType('bad-name' as any)).toBeNull();
    expect(getBinaryFnReturnType('binaryFnBogus::x' as any)).toBeNull();
  });
});

describe('typeInference values and function inference', () => {
  function contextWithTables(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
    return {
      valueTable: {
        v_num: { symbol: 'number', value: 1, subSymbol: undefined, tags: [] },
        v_arr_num: { symbol: 'array', value: [], subSymbol: 'number', tags: [] },
        v_arr_untyped: { symbol: 'array', value: [], subSymbol: undefined, tags: [] },
      } as any,
      funcTable: {},
      combineFuncDefTable: {},
      pipeFuncDefTable: {},
      condFuncDefTable: {},
      ...overrides,
    } as ExecutionContext;
  }

  it('infers value base and array element types', () => {
    const context = contextWithTables();

    expect(inferValueType('v_num' as ValueId, context)).toBe('number');
    expect(inferValueType('missing' as ValueId, context)).toBeNull();
    expect(inferValueElemType('v_arr_num' as ValueId, context)).toBe('number');
    expect(inferValueElemType('v_arr_untyped' as ValueId, context)).toBeNull();
    expect(inferValueElemType('v_num' as ValueId, context)).toBeNull();
    expect(inferValueElemType('missing' as ValueId, context)).toBeNull();
  });

  it('infers combine and pipe return types', () => {
    const context = contextWithTables({
      funcTable: {
        f_combine: { kind: 'combine', defId: 'pd_add' as CombineDefineId, argMap: {}, returnId: 'v_out' as ValueId },
        f_pipe: { kind: 'pipe', defId: 'td_pipe' as PipeDefineId, argMap: {}, returnId: 'v_pipe' as ValueId },
        f_empty_pipe: { kind: 'pipe', defId: 'td_empty' as PipeDefineId, argMap: {}, returnId: 'v_empty' as ValueId },
      } as any,
      combineFuncDefTable: {
        pd_add: { name: 'binaryFnNumber::add' },
        pd_concat: { name: 'binaryFnString::concat' },
      } as any,
      pipeFuncDefTable: {
        td_pipe: { args: {}, sequence: [{ defId: 'pd_concat' as CombineDefineId, argBindings: {} }] },
        td_empty: { args: {}, sequence: [] },
      } as any,
    });

    expect(inferCombineFuncReturnType('pd_add' as CombineDefineId, context)).toBe('number');
    expect(inferFuncReturnType('f_combine' as FuncId, context)).toBe('number');
    expect(inferFuncReturnType('f_pipe' as FuncId, context)).toBe('string');
    expect(inferFuncReturnType('f_empty_pipe' as FuncId, context)).toBeNull();
  });

  it('infers one level of nested pipe return types and stops on deeper unsupported nesting', () => {
    const context = contextWithTables({
      funcTable: {
        f_nested: { kind: 'pipe', defId: 'td_outer' as PipeDefineId, argMap: {}, returnId: 'v_nested' as ValueId },
        f_deep: { kind: 'pipe', defId: 'td_deep_outer' as PipeDefineId, argMap: {}, returnId: 'v_deep' as ValueId },
      } as any,
      combineFuncDefTable: {
        pd_add: { name: 'binaryFnNumber::add' },
      } as any,
      pipeFuncDefTable: {
        td_outer: { args: {}, sequence: [{ defId: 'td_inner' as PipeDefineId, argBindings: {} }] },
        td_inner: { args: {}, sequence: [{ defId: 'pd_add' as CombineDefineId, argBindings: {} }] },
        td_deep_outer: { args: {}, sequence: [{ defId: 'td_deep_middle' as PipeDefineId, argBindings: {} }] },
        td_deep_middle: { args: {}, sequence: [{ defId: 'td_deep_inner' as PipeDefineId, argBindings: {} }] },
        td_deep_inner: { args: {}, sequence: [{ defId: 'pd_add' as CombineDefineId, argBindings: {} }] },
        td_empty_inner: { args: {}, sequence: [] },
      } as any,
    });

    expect(inferFuncReturnType('f_nested' as FuncId, context)).toBe('number');
    expect(inferFuncReturnType('f_deep' as FuncId, context)).toBeNull();

    context.funcTable['f_empty_nested' as FuncId] = { kind: 'pipe', defId: 'td_empty_outer' as PipeDefineId, argMap: {}, returnId: 'v_empty_nested' as ValueId } as any;
    context.pipeFuncDefTable['td_empty_outer' as PipeDefineId] = { args: {}, sequence: [{ defId: 'td_empty_inner' as PipeDefineId, argBindings: {} }] } as any;
    expect(inferFuncReturnType('f_empty_nested' as FuncId, context)).toBeNull();
  });


  it('returns null for pipe steps ending in cond or unknown definitions', () => {
    const context = contextWithTables({
      funcTable: {
        f_pipe_cond: { kind: 'pipe', defId: 'td_cond_last' as PipeDefineId, argMap: {}, returnId: 'v_pipe_cond' as ValueId },
        f_pipe_unknown: { kind: 'pipe', defId: 'td_unknown_last' as PipeDefineId, argMap: {}, returnId: 'v_pipe_unknown' as ValueId },
      } as any,
      combineFuncDefTable: {},
      pipeFuncDefTable: {
        td_cond_last: { args: {}, sequence: [{ defId: 'cd_cond' as any, argBindings: {} }] },
        td_unknown_last: { args: {}, sequence: [{ defId: 'not_registered' as any, argBindings: {} }] },
      } as any,
      condFuncDefTable: {
        cd_cond: { trueBranchId: 'f_missing_true' as FuncId, falseBranchId: 'f_missing_false' as FuncId },
      } as any,
    });

    expect(inferFuncReturnType('f_pipe_cond' as FuncId, context)).toBeNull();
    expect(inferFuncReturnType('f_pipe_unknown' as FuncId, context)).toBeNull();
  });

  it('returns null for unsupported function entries, cycles, missing entries, and unsupported cond branches', () => {
    const context = contextWithTables({
      funcTable: {
        f_unknown: { kind: 'combine', defId: 'unknown_def' as CombineDefineId, argMap: {}, returnId: 'v_unknown' as ValueId },
        f_cond_unknown: { kind: 'cond', defId: 'cd_unknown' as any, returnId: 'v_cond_unknown' as ValueId },
        f_cond_null: { kind: 'cond', defId: 'cd_null' as any, returnId: 'v_cond_null' as ValueId },
        f_cycle: { kind: 'cond', defId: 'cd_cycle' as any, returnId: 'v_cycle' as ValueId },
        f_num: { kind: 'combine', defId: 'pd_add' as CombineDefineId, argMap: {}, returnId: 'v_num_out' as ValueId },
      } as any,
      combineFuncDefTable: {
        pd_add: { name: 'binaryFnNumber::add' },
      } as any,
      condFuncDefTable: {
        cd_null: { trueBranchId: 'f_unknown' as FuncId, falseBranchId: 'f_num' as FuncId },
        cd_cycle: { trueBranchId: 'f_cycle' as FuncId, falseBranchId: 'f_num' as FuncId },
      } as any,
    });

    expect(inferFuncReturnType('f_unknown' as FuncId, context)).toBeNull();
    expect(inferFuncReturnType('f_cond_unknown' as FuncId, context)).toBeNull();
    expect(inferFuncReturnType('f_cond_null' as FuncId, context)).toBeNull();
    expect(inferFuncReturnType('f_cycle' as FuncId, context)).toBeNull();
    expect(() => inferFuncReturnType('missing_func' as FuncId, context)).toThrow();
  });
});

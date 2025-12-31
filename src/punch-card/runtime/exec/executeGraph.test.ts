import { describe, it, expect } from 'vitest';
import { executeGraph, executeGraphSafe } from './executeGraph';
import {
  ExecutionContext,
  FuncId,
  ValueId,
  PlugDefineId,
  TapDefineId,
  CondDefineId,
} from '../../types';

describe('executeGraph', () => {
  it('should execute a simple PlugFunc with two number values', () => {
    const context: ExecutionContext = {
      valueTable: {
        v1: { symbol: 'number', value: 5, subSymbol: undefined, effects: [] },
        v2: { symbol: 'number', value: 3, subSymbol: undefined, effects: [] },
      } as any,
      funcTable: {
        f1: {
          defId: 'pd1' as PlugDefineId,
          argMap: { a: 'v1' as ValueId, b: 'v2' as ValueId },
          returnId: 'v3' as ValueId,
        },
      } as any,
      plugFuncDefTable: {
        pd1: {
          name: 'binaryFnNumber::add',
          transformFn: {
            a: { name: 'transformFnNumber::pass' },
            b: { name: 'transformFnNumber::pass' },
          },
          args: {
            a: 'ia1' as any,
            b: 'ia2' as any,
          },
        },
      } as any,
      tapFuncDefTable: {} as any,
      condFuncDefTable: {} as any,
    };

    const result = executeGraph('f1' as FuncId, context);

    expect(result.value).toEqual({
      symbol: 'number',
      value: 8,
      subSymbol: undefined, effects: [],
    });
  });

  it('should execute nested PlugFuncs with dependencies', () => {
    const context: ExecutionContext = {
      valueTable: {
        v1: { symbol: 'number', value: 10, subSymbol: undefined, effects: [] },
        v2: { symbol: 'number', value: 5, subSymbol: undefined, effects: [] },
        v3: { symbol: 'number', value: 2, subSymbol: undefined, effects: [] },
      } as any,
      funcTable: {
        f1: {
          defId: 'pd-add' as PlugDefineId,
          argMap: { a: 'v1' as ValueId, b: 'v2' as ValueId },
          returnId: 'v4' as ValueId,
        },
        f2: {
          defId: 'pd-multiply' as PlugDefineId,
          argMap: { a: 'v4' as ValueId, b: 'v3' as ValueId },
          returnId: 'v5' as ValueId,
        },
      } as any,
      plugFuncDefTable: {
        'pd-add': {
          name: 'binaryFnNumber::add',
          transformFn: {
            a: { name: 'transformFnNumber::pass' },
            b: { name: 'transformFnNumber::pass' },
          },
          args: {
            a: 'ia1' as any,
            b: 'ia2' as any,
          },
        },
        'pd-multiply': {
          name: 'binaryFnNumber::multiply',
          transformFn: {
            a: { name: 'transformFnNumber::pass' },
            b: { name: 'transformFnNumber::pass' },
          },
          args: {
            a: 'ia1' as any,
            b: 'ia2' as any,
          },
        },
      } as any,
      tapFuncDefTable: {} as any,
      condFuncDefTable: {} as any,
    };

    const result = executeGraph('f2' as FuncId, context);

    expect(result.value).toEqual({
      symbol: 'number',
      value: 30,
      subSymbol: undefined, effects: [],
    });
  });

  it('should execute shared definition with multiple instances', () => {
    const context: ExecutionContext = {
      valueTable: {
        v1: { symbol: 'number', value: 3, subSymbol: undefined, effects: [] },
        v2: { symbol: 'number', value: 4, subSymbol: undefined, effects: [] },
        v3: { symbol: 'number', value: 5, subSymbol: undefined, effects: [] },
      } as any,
      funcTable: {
        f1: {
          defId: 'pd-add' as PlugDefineId,
          argMap: { a: 'v1' as ValueId, b: 'v2' as ValueId },
          returnId: 'v4' as ValueId,
        },
        f2: {
          defId: 'pd-add' as PlugDefineId,
          argMap: { a: 'v4' as ValueId, b: 'v3' as ValueId },
          returnId: 'v5' as ValueId,
        },
      } as any,
      plugFuncDefTable: {
        'pd-add': {
          name: 'binaryFnNumber::add',
          transformFn: {
            a: { name: 'transformFnNumber::pass' },
            b: { name: 'transformFnNumber::pass' },
          },
          args: {
            a: 'ia1' as any,
            b: 'ia2' as any,
          },
        },
      } as any,
      tapFuncDefTable: {} as any,
      condFuncDefTable: {} as any,
    };

    const result = executeGraph('f2' as FuncId, context);

    expect(result.value).toEqual({
      symbol: 'number',
      value: 12,
      subSymbol: undefined, effects: [],
    });
  });

  it('should execute TapFunc with sequence of PlugFuncs', () => {
    const context: ExecutionContext = {
      valueTable: {
        v1: { symbol: 'number', value: 10, subSymbol: undefined, effects: [] },
        v2: { symbol: 'number', value: 5, subSymbol: undefined, effects: [] },
        v3: { symbol: 'number', value: 2, subSymbol: undefined, effects: [] },
      } as any,
      funcTable: {
        tap1: {
          defId: 'td1' as TapDefineId,
          argMap: { a: 'v1' as ValueId, b: 'v2' as ValueId, c: 'v3' as ValueId },
          returnId: 'v6' as ValueId,
        },
      } as any,
      plugFuncDefTable: {
        'pd-add': {
          name: 'binaryFnNumber::add',
          transformFn: {
            a: { name: 'transformFnNumber::pass' },
            b: { name: 'transformFnNumber::pass' },
          },
          args: {
            a: 'ia1' as any,
            b: 'ia2' as any,
          },
        },
        'pd-multiply': {
          name: 'binaryFnNumber::multiply',
          transformFn: {
            a: { name: 'transformFnNumber::pass' },
            b: { name: 'transformFnNumber::pass' },
          },
          args: {
            a: 'ia1' as any,
            b: 'ia2' as any,
          },
        },
      } as any,
      tapFuncDefTable: {
        td1: {
          args: {
            a: 'ia-a' as any,
            b: 'ia-b' as any,
            c: 'ia-c' as any,
          },
          sequence: [
            {
              defId: 'pd-add' as PlugDefineId,
              argBindings: {
                a: { source: 'input', argName: 'a' },
                b: { source: 'input', argName: 'b' },
              },
            },
            {
              defId: 'pd-multiply' as PlugDefineId,
              argBindings: {
                a: { source: 'step', stepIndex: 0 },
                b: { source: 'input', argName: 'c' },
              },
            },
          ],
        },
      } as any,
      condFuncDefTable: {} as any,
    };

    const result = executeGraph('tap1' as FuncId, context);

    expect(result.value).toEqual({
      symbol: 'number',
      value: 30,
      subSymbol: undefined, effects: [],
    });
  });

  it('should execute with transform functions (number to string)', () => {
    const context: ExecutionContext = {
      valueTable: {
        v1: { symbol: 'number', value: 42, subSymbol: undefined, effects: [] },
        v2: { symbol: 'string', value: ' is the answer', subSymbol: undefined, effects: [] },
      } as any,
      funcTable: {
        f1: {
          defId: 'pd1' as PlugDefineId,
          argMap: { a: 'v1' as ValueId, b: 'v2' as ValueId },
          returnId: 'v3' as ValueId,
        },
      } as any,
      plugFuncDefTable: {
        pd1: {
          name: 'binaryFnString::concat',
          transformFn: {
            a: { name: 'transformFnNumber::toStr' },
            b: { name: 'transformFnString::pass' },
          },
          args: {
            a: 'ia1' as any,
            b: 'ia2' as any,
          },
        },
      } as any,
      tapFuncDefTable: {} as any,
      condFuncDefTable: {} as any,
    };

    const result = executeGraph('f1' as FuncId, context);

    expect(result.value).toEqual({
      symbol: 'string',
      value: '42 is the answer',
      subSymbol: undefined, effects: [],
    });
  });

  it('should handle error: cyclic dependency', () => {
    const context: ExecutionContext = {
      valueTable: {} as any,
      funcTable: {
        f1: {
          defId: 'pd-add' as PlugDefineId,
          argMap: { a: 'v1' as ValueId, b: 'v2' as ValueId },
          returnId: 'v2' as ValueId,
        },
      } as any,
      plugFuncDefTable: {
        'pd-add': {
          name: 'binaryFnNumber::add',
          transformFn: {
            a: { name: 'transformFnNumber::pass' },
            b: { name: 'transformFnNumber::pass' },
          },
          args: {
            a: 'ia1' as any,
            b: 'ia2' as any,
          },
        },
      } as any,
      tapFuncDefTable: {} as any,
      condFuncDefTable: {} as any,
    };

    const { result, errors } = executeGraphSafe('f1' as FuncId, context, { skipValidation: true });

    expect(result).toBeUndefined();
    expect(errors).toHaveLength(1);
    // Cyclic dependencies are caught during tree construction as generic errors
    expect(errors[0].kind).toBe('functionExecution');
    expect(errors[0].message).toContain('Cycle detected');
  });

  it('should handle error: missing value', () => {
    const context: ExecutionContext = {
      valueTable: {
        v1: { symbol: 'number', value: 5, subSymbol: undefined, effects: [] },
      } as any,
      funcTable: {
        f1: {
          defId: 'pd1' as PlugDefineId,
          argMap: { a: 'v1' as ValueId, b: 'v2' as ValueId },
          returnId: 'v3' as ValueId,
        },
      } as any,
      plugFuncDefTable: {
        pd1: {
          name: 'binaryFnNumber::add',
          transformFn: {
            a: { name: 'transformFnNumber::pass' },
            b: { name: 'transformFnNumber::pass' },
          },
          args: {
            a: 'ia1' as any,
            b: 'ia2' as any,
          },
        },
      } as any,
      tapFuncDefTable: {} as any,
      condFuncDefTable: {} as any,
    };

    const { result, errors } = executeGraphSafe('f1' as FuncId, context, { skipValidation: true });

    expect(result).toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(errors[0].kind).toBe('missingValue');
  });

  it('should handle error: empty TapFunc sequence', () => {
    const context: ExecutionContext = {
      valueTable: {} as any,
      funcTable: {
        tap1: {
          defId: 'td1' as TapDefineId,
          argMap: {},
          returnId: 'v1' as ValueId,
        },
      } as any,
      plugFuncDefTable: {} as any,
      tapFuncDefTable: {
        td1: {
          args: {},
          sequence: [],
        },
      } as any,
      condFuncDefTable: {} as any,
    };

    const { result, errors } = executeGraphSafe('tap1' as FuncId, context, { skipValidation: true });

    expect(result).toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(errors[0].kind).toBe('emptySequence');
  });

  it('should execute CondFunc with true branch', () => {
    const context: ExecutionContext = {
      valueTable: {
        vCondition: { symbol: 'boolean', value: true, subSymbol: undefined, effects: [] },
        v1: { symbol: 'number', value: 10, subSymbol: undefined, effects: [] },
        v2: { symbol: 'number', value: 20, subSymbol: undefined, effects: [] },
        v0: { symbol: 'number', value: 0, subSymbol: undefined, effects: [] },
      } as any,
      funcTable: {
        fTrue: {
          defId: 'pd-pass-true' as PlugDefineId,
          argMap: { a: 'v1' as ValueId, b: 'v0' as ValueId },
          returnId: 'vTrueResult' as ValueId,
        },
        fFalse: {
          defId: 'pd-pass-false' as PlugDefineId,
          argMap: { a: 'v2' as ValueId, b: 'v0' as ValueId },
          returnId: 'vFalseResult' as ValueId,
        },
        cond1: {
          defId: 'cd1' as CondDefineId,
          argMap: {},
          returnId: 'vCondResult' as ValueId,
        },
      } as any,
      plugFuncDefTable: {
        'pd-pass-true': {
          name: 'binaryFnNumber::add',
          transformFn: {
            a: { name: 'transformFnNumber::pass' },
            b: { name: 'transformFnNumber::pass' },
          },
          args: {
            a: 'ia1' as any,
            b: 'ia2' as any,
          },
        },
        'pd-pass-false': {
          name: 'binaryFnNumber::add',
          transformFn: {
            a: { name: 'transformFnNumber::pass' },
            b: { name: 'transformFnNumber::pass' },
          },
          args: {
            a: 'ia1' as any,
            b: 'ia2' as any,
          },
        },
      } as any,
      tapFuncDefTable: {} as any,
      condFuncDefTable: {
        cd1: {
          conditionId: 'vCondition' as ValueId,
          trueBranchId: 'fTrue' as FuncId,
          falseBranchId: 'fFalse' as FuncId,
        },
      } as any,
    };

    const result = executeGraph('cond1' as FuncId, context);

    expect(result.value).toEqual({
      symbol: 'number',
      value: 10,
      subSymbol: undefined, effects: [],
    });
  });

  it('should execute CondFunc with false branch', () => {
    const context: ExecutionContext = {
      valueTable: {
        vCondition: { symbol: 'boolean', value: false, subSymbol: undefined, effects: [] },
        v1: { symbol: 'number', value: 10, subSymbol: undefined, effects: [] },
        v2: { symbol: 'number', value: 20, subSymbol: undefined, effects: [] },
        v0: { symbol: 'number', value: 0, subSymbol: undefined, effects: [] },
      } as any,
      funcTable: {
        fTrue: {
          defId: 'pd-pass-true' as PlugDefineId,
          argMap: { a: 'v1' as ValueId, b: 'v0' as ValueId },
          returnId: 'vTrueResult' as ValueId,
        },
        fFalse: {
          defId: 'pd-pass-false' as PlugDefineId,
          argMap: { a: 'v2' as ValueId, b: 'v0' as ValueId },
          returnId: 'vFalseResult' as ValueId,
        },
        cond1: {
          defId: 'cd1' as CondDefineId,
          argMap: {},
          returnId: 'vCondResult' as ValueId,
        },
      } as any,
      plugFuncDefTable: {
        'pd-pass-true': {
          name: 'binaryFnNumber::add',
          transformFn: {
            a: { name: 'transformFnNumber::pass' },
            b: { name: 'transformFnNumber::pass' },
          },
          args: {
            a: 'ia1' as any,
            b: 'ia2' as any,
          },
        },
        'pd-pass-false': {
          name: 'binaryFnNumber::add',
          transformFn: {
            a: { name: 'transformFnNumber::pass' },
            b: { name: 'transformFnNumber::pass' },
          },
          args: {
            a: 'ia1' as any,
            b: 'ia2' as any,
          },
        },
      } as any,
      tapFuncDefTable: {} as any,
      condFuncDefTable: {
        cd1: {
          conditionId: 'vCondition' as ValueId,
          trueBranchId: 'fTrue' as FuncId,
          falseBranchId: 'fFalse' as FuncId,
        },
      } as any,
    };

    const result = executeGraph('cond1' as FuncId, context);

    expect(result.value).toEqual({
      symbol: 'number',
      value: 20,
      subSymbol: undefined, effects: [],
    });
  });

  it('should handle CondFunc branches sharing the same value dependency', () => {
    // This test verifies the optimization in buildExecutionTree where sibling branches
    // can visit the same nodes without false cycle detection
    const context: ExecutionContext = {
      valueTable: {
        vCondition: { symbol: 'boolean', value: true, subSymbol: undefined, effects: [] },
        vShared: { symbol: 'number', value: 42, subSymbol: undefined, effects: [] }, // Used by both branches
        v0: { symbol: 'number', value: 0, subSymbol: undefined, effects: [] },
      } as any,
      funcTable: {
        fTrue: {
          defId: 'pd-use-shared' as PlugDefineId,
          argMap: { a: 'vShared' as ValueId, b: 'v0' as ValueId },
          returnId: 'vTrueResult' as ValueId,
        },
        fFalse: {
          defId: 'pd-use-shared' as PlugDefineId,
          argMap: { a: 'vShared' as ValueId, b: 'v0' as ValueId }, // Same vShared
          returnId: 'vFalseResult' as ValueId,
        },
        cond1: {
          defId: 'cd1' as CondDefineId,
          argMap: {},
          returnId: 'vCondResult' as ValueId,
        },
      } as any,
      plugFuncDefTable: {
        'pd-use-shared': {
          name: 'binaryFnNumber::add',
          transformFn: {
            a: { name: 'transformFnNumber::pass' },
            b: { name: 'transformFnNumber::pass' },
          },
          args: {
            a: 'ia1' as any,
            b: 'ia2' as any,
          },
        },
      } as any,
      tapFuncDefTable: {} as any,
      condFuncDefTable: {
        cd1: {
          conditionId: 'vCondition' as ValueId,
          trueBranchId: 'fTrue' as FuncId,
          falseBranchId: 'fFalse' as FuncId,
        },
      } as any,
    };

    // This should not throw "Cycle detected" error
    const result = executeGraph('cond1' as FuncId, context);

    expect(result.value).toEqual({
      symbol: 'number',
      value: 42, // vShared + 0
      subSymbol: undefined, effects: [],
    });
  });

  it('should execute nested CondFunc with computed condition', () => {
    const context: ExecutionContext = {
      valueTable: {
        v1: { symbol: 'number', value: 5, subSymbol: undefined, effects: [] },
        v2: { symbol: 'number', value: 5, subSymbol: undefined, effects: [] },
        v3: { symbol: 'number', value: 100, subSymbol: undefined, effects: [] },
        v4: { symbol: 'number', value: 200, subSymbol: undefined, effects: [] },
        v0: { symbol: 'number', value: 0, subSymbol: undefined, effects: [] },
      } as any,
      funcTable: {
        fCondition: {
          defId: 'pd-eq' as PlugDefineId,
          argMap: { a: 'v1' as ValueId, b: 'v2' as ValueId },
          returnId: 'vCondResult' as ValueId,
        },
        fTrue: {
          defId: 'pd-pass-true' as PlugDefineId,
          argMap: { a: 'v3' as ValueId, b: 'v0' as ValueId },
          returnId: 'vTrueResult' as ValueId,
        },
        fFalse: {
          defId: 'pd-pass-false' as PlugDefineId,
          argMap: { a: 'v4' as ValueId, b: 'v0' as ValueId },
          returnId: 'vFalseResult' as ValueId,
        },
        cond1: {
          defId: 'cd1' as CondDefineId,
          argMap: {},
          returnId: 'vFinalResult' as ValueId,
        },
      } as any,
      plugFuncDefTable: {
        'pd-eq': {
          name: 'binaryFnGeneric::isEqual',
          transformFn: {
            a: { name: 'transformFnNumber::pass' },
            b: { name: 'transformFnNumber::pass' },
          },
          args: {
            a: 'ia1' as any,
            b: 'ia2' as any,
          },
        },
        'pd-pass-true': {
          name: 'binaryFnNumber::add',
          transformFn: {
            a: { name: 'transformFnNumber::pass' },
            b: { name: 'transformFnNumber::pass' },
          },
          args: {
            a: 'ia1' as any,
            b: 'ia2' as any,
          },
        },
        'pd-pass-false': {
          name: 'binaryFnNumber::add',
          transformFn: {
            a: { name: 'transformFnNumber::pass' },
            b: { name: 'transformFnNumber::pass' },
          },
          args: {
            a: 'ia1' as any,
            b: 'ia2' as any,
          },
        },
      } as any,
      tapFuncDefTable: {} as any,
      condFuncDefTable: {
        cd1: {
          conditionId: 'fCondition' as FuncId,
          trueBranchId: 'fTrue' as FuncId,
          falseBranchId: 'fFalse' as FuncId,
        },
      } as any,
    };

    const result = executeGraph('cond1' as FuncId, context);

    // 5 == 5 is true, so should return 100
    expect(result.value).toEqual({
      symbol: 'number',
      value: 100,
      subSymbol: undefined, effects: [],
    });
  });
});

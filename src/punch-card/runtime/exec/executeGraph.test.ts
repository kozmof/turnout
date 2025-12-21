import { describe, it, expect } from 'vitest';
import { executeGraph, executeGraphSafe } from './executeGraph';
import {
  ExecutionContext,
  FuncId,
  ValueId,
  PlugDefineId,
  TapDefineId,
} from '../../types';

describe('executeGraph', () => {
  it('should execute a simple PlugFunc with two number values', () => {
    const context: ExecutionContext = {
      valueTable: {
        v1: { symbol: 'number', value: 5, subSymbol: undefined },
        v2: { symbol: 'number', value: 3, subSymbol: undefined },
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
          interfaceArgs: ['ia1' as any, 'ia2' as any],
        },
      } as any,
      tapFuncDefTable: {} as any,
    };

    const result = executeGraph('f1' as FuncId, context);

    expect(result).toEqual({
      symbol: 'number',
      value: 8,
      subSymbol: undefined,
    });
  });

  it('should execute nested PlugFuncs with dependencies', () => {
    const context: ExecutionContext = {
      valueTable: {
        v1: { symbol: 'number', value: 10, subSymbol: undefined },
        v2: { symbol: 'number', value: 5, subSymbol: undefined },
        v3: { symbol: 'number', value: 2, subSymbol: undefined },
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
          interfaceArgs: ['ia1' as any, 'ia2' as any],
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
          interfaceArgs: ['ia1' as any, 'ia2' as any],
        },
      } as any,
      tapFuncDefTable: {} as any,
    };

    const result = executeGraph('f2' as FuncId, context);

    expect(result).toEqual({
      symbol: 'number',
      value: 30,
      subSymbol: undefined,
    });
  });

  it('should execute shared definition with multiple instances', () => {
    const context: ExecutionContext = {
      valueTable: {
        v1: { symbol: 'number', value: 3, subSymbol: undefined },
        v2: { symbol: 'number', value: 4, subSymbol: undefined },
        v3: { symbol: 'number', value: 5, subSymbol: undefined },
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
          interfaceArgs: ['ia1' as any, 'ia2' as any],
        },
      } as any,
      tapFuncDefTable: {} as any,
    };

    const result = executeGraph('f2' as FuncId, context);

    expect(result).toEqual({
      symbol: 'number',
      value: 12,
      subSymbol: undefined,
    });
  });

  it('should execute TapFunc with sequence of PlugFuncs', () => {
    const context: ExecutionContext = {
      valueTable: {
        v1: { symbol: 'number', value: 10, subSymbol: undefined },
        v2: { symbol: 'number', value: 5, subSymbol: undefined },
        v3: { symbol: 'number', value: 2, subSymbol: undefined },
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
        tap1: {
          defId: 'td1' as TapDefineId,
          argMap: {},
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
          interfaceArgs: ['ia1' as any, 'ia2' as any],
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
          interfaceArgs: ['ia1' as any, 'ia2' as any],
        },
      } as any,
      tapFuncDefTable: {
        td1: {
          sequence: ['f1' as FuncId, 'f2' as FuncId],
          interfaceArgs: [],
        },
      } as any,
    };

    const result = executeGraph('tap1' as FuncId, context);

    expect(result).toEqual({
      symbol: 'number',
      value: 30,
      subSymbol: undefined,
    });
  });

  it('should execute with transform functions (number to string)', () => {
    const context: ExecutionContext = {
      valueTable: {
        v1: { symbol: 'number', value: 42, subSymbol: undefined },
        v2: { symbol: 'string', value: ' is the answer', subSymbol: undefined },
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
          interfaceArgs: ['ia1' as any, 'ia2' as any],
        },
      } as any,
      tapFuncDefTable: {} as any,
    };

    const result = executeGraph('f1' as FuncId, context);

    expect(result).toEqual({
      symbol: 'string',
      value: '42 is the answer',
      subSymbol: undefined,
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
          interfaceArgs: ['ia1' as any, 'ia2' as any],
        },
      } as any,
      tapFuncDefTable: {} as any,
    };

    const { result, errors } = executeGraphSafe('f1' as FuncId, context);

    expect(result).toBeUndefined();
    expect(errors).toHaveLength(1);
    // Cyclic dependencies are caught during tree construction as generic errors
    expect(errors[0].kind).toBe('functionExecution');
    expect(errors[0].message).toContain('Cycle detected');
  });

  it('should handle error: missing value', () => {
    const context: ExecutionContext = {
      valueTable: {
        v1: { symbol: 'number', value: 5, subSymbol: undefined },
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
          interfaceArgs: ['ia1' as any, 'ia2' as any],
        },
      } as any,
      tapFuncDefTable: {} as any,
    };

    const { result, errors } = executeGraphSafe('f1' as FuncId, context);

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
          sequence: [],
          interfaceArgs: [],
        },
      } as any,
    };

    const { result, errors } = executeGraphSafe('tap1' as FuncId, context);

    expect(result).toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(errors[0].kind).toBe('emptySequence');
  });
});

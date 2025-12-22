import { describe, it, expect } from 'vitest';
import { validateContext, assertValidContext } from './validateContext';
import {
  ExecutionContext,
  FuncId,
  ValueId,
  PlugDefineId,
  TapDefineId,
  CondDefineId,
} from '../types';

describe('validateContext', () => {
  describe('valid contexts', () => {
    it('should validate a simple valid context with PlugFunc', () => {
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
          },
        } as any,
        tapFuncDefTable: {} as any,
        condFuncDefTable: {} as any,
      };

      const result = validateContext(context);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate a context with TapFunc', () => {
      const context: ExecutionContext = {
        valueTable: {
          v1: { symbol: 'number', value: 10, subSymbol: undefined },
        } as any,
        funcTable: {
          f1: {
            defId: 'pd1' as PlugDefineId,
            argMap: { a: 'v1' as ValueId, b: 'v1' as ValueId },
            returnId: 'v2' as ValueId,
          },
          tap1: {
            defId: 'td1' as TapDefineId,
            argMap: { x: 'v1' as ValueId },
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
            args: { a: 'ia1' as any, b: 'ia2' as any },
          },
        } as any,
        tapFuncDefTable: {
          td1: {
            args: { x: 'ia-x' as any },
            sequence: ['f1' as FuncId],
          },
        } as any,
        condFuncDefTable: {} as any,
      };

      const result = validateContext(context);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate a context with CondFunc', () => {
      const context: ExecutionContext = {
        valueTable: {
          vCond: { symbol: 'boolean', value: true, subSymbol: undefined },
          v1: { symbol: 'number', value: 10, subSymbol: undefined },
        } as any,
        funcTable: {
          fTrue: {
            defId: 'pd1' as PlugDefineId,
            argMap: { a: 'v1' as ValueId, b: 'v1' as ValueId },
            returnId: 'v2' as ValueId,
          },
          fFalse: {
            defId: 'pd1' as PlugDefineId,
            argMap: { a: 'v1' as ValueId, b: 'v1' as ValueId },
            returnId: 'v3' as ValueId,
          },
          cond1: {
            defId: 'cd1' as CondDefineId,
            argMap: {},
            returnId: 'v4' as ValueId,
          },
        } as any,
        plugFuncDefTable: {
          pd1: {
            name: 'binaryFnNumber::add',
            transformFn: {
              a: { name: 'transformFnNumber::pass' },
              b: { name: 'transformFnNumber::pass' },
            },
            args: { a: 'ia1' as any, b: 'ia2' as any },
          },
        } as any,
        tapFuncDefTable: {} as any,
        condFuncDefTable: {
          cd1: {
            conditionId: 'vCond' as ValueId,
            trueBranchId: 'fTrue' as FuncId,
            falseBranchId: 'fFalse' as FuncId,
          },
        } as any,
      };

      const result = validateContext(context);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('FuncTable validation errors', () => {
    it('should detect missing definition', () => {
      const context: ExecutionContext = {
        valueTable: {
          v1: { symbol: 'number', value: 5, subSymbol: undefined },
        } as any,
        funcTable: {
          f1: {
            defId: 'pd-missing' as PlugDefineId,
            argMap: { a: 'v1' as ValueId },
            returnId: 'v2' as ValueId,
          },
        } as any,
        plugFuncDefTable: {} as any,
        tapFuncDefTable: {} as any,
        condFuncDefTable: {} as any,
      };

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('Definition pd-missing does not exist');
    });

    it('should detect invalid argument ID in argMap', () => {
      const context: ExecutionContext = {
        valueTable: {} as any,
        funcTable: {
          f1: {
            defId: 'pd1' as PlugDefineId,
            argMap: { a: 'v-nonexistent' as ValueId },
            returnId: 'v2' as ValueId,
          },
        } as any,
        plugFuncDefTable: {
          pd1: {
            name: 'binaryFnNumber::add',
            transformFn: {
              a: { name: 'transformFnNumber::pass' },
              b: { name: 'transformFnNumber::pass' },
            },
            args: { a: 'ia1' as any, b: 'ia2' as any },
          },
        } as any,
        tapFuncDefTable: {} as any,
        condFuncDefTable: {} as any,
      };

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.message.includes('v-nonexistent'))).toBe(true);
    });
  });

  describe('PlugFuncDefTable validation errors', () => {
    it('should detect missing function name', () => {
      const context: ExecutionContext = {
        valueTable: {} as any,
        funcTable: {} as any,
        plugFuncDefTable: {
          pd1: {
            name: '' as any, // Invalid empty name
            transformFn: {
              a: { name: 'transformFnNumber::pass' },
              b: { name: 'transformFnNumber::pass' },
            },
            args: { a: 'ia1' as any, b: 'ia2' as any },
          },
        } as any,
        tapFuncDefTable: {} as any,
        condFuncDefTable: {} as any,
      };

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('Invalid or missing function name'))).toBe(true);
    });

    it('should detect missing transform functions', () => {
      const context: ExecutionContext = {
        valueTable: {} as any,
        funcTable: {} as any,
        plugFuncDefTable: {
          pd1: {
            name: 'binaryFnNumber::add',
            transformFn: undefined as any, // Missing transform functions
            args: { a: 'ia1' as any, b: 'ia2' as any },
          },
        } as any,
        tapFuncDefTable: {} as any,
        condFuncDefTable: {} as any,
      };

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('Missing transform function'))).toBe(true);
    });
  });

  describe('TapFuncDefTable validation errors', () => {
    it('should detect empty sequence', () => {
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
            sequence: [], // Empty sequence
          },
        } as any,
        condFuncDefTable: {} as any,
      };

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('Sequence is empty'))).toBe(true);
    });

    it('should detect invalid FuncId in sequence', () => {
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
            sequence: ['f-nonexistent' as FuncId],
          },
        } as any,
        condFuncDefTable: {} as any,
      };

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('f-nonexistent'))).toBe(true);
    });
  });

  describe('CondFuncDefTable validation errors', () => {
    it('should detect invalid condition ID', () => {
      const context: ExecutionContext = {
        valueTable: {} as any,
        funcTable: {
          fTrue: {
            defId: 'pd1' as PlugDefineId,
            argMap: {},
            returnId: 'v1' as ValueId,
          },
          fFalse: {
            defId: 'pd1' as PlugDefineId,
            argMap: {},
            returnId: 'v2' as ValueId,
          },
          cond1: {
            defId: 'cd1' as CondDefineId,
            argMap: {},
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
            args: { a: 'ia1' as any, b: 'ia2' as any },
          },
        } as any,
        tapFuncDefTable: {} as any,
        condFuncDefTable: {
          cd1: {
            conditionId: 'v-nonexistent' as ValueId,
            trueBranchId: 'fTrue' as FuncId,
            falseBranchId: 'fFalse' as FuncId,
          },
        } as any,
      };

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('conditionId'))).toBe(true);
    });

    it('should detect invalid trueBranchId', () => {
      const context: ExecutionContext = {
        valueTable: {
          vCond: { symbol: 'boolean', value: true, subSymbol: undefined },
        } as any,
        funcTable: {
          fFalse: {
            defId: 'pd1' as PlugDefineId,
            argMap: {},
            returnId: 'v1' as ValueId,
          },
          cond1: {
            defId: 'cd1' as CondDefineId,
            argMap: {},
            returnId: 'v2' as ValueId,
          },
        } as any,
        plugFuncDefTable: {
          pd1: {
            name: 'binaryFnNumber::add',
            transformFn: {
              a: { name: 'transformFnNumber::pass' },
              b: { name: 'transformFnNumber::pass' },
            },
            args: { a: 'ia1' as any, b: 'ia2' as any },
          },
        } as any,
        tapFuncDefTable: {} as any,
        condFuncDefTable: {
          cd1: {
            conditionId: 'vCond' as ValueId,
            trueBranchId: 'f-nonexistent' as FuncId,
            falseBranchId: 'fFalse' as FuncId,
          },
        } as any,
      };

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('trueBranchId'))).toBe(true);
    });
  });

  describe('warnings', () => {
    it('should warn about unreferenced values', () => {
      const context: ExecutionContext = {
        valueTable: {
          v1: { symbol: 'number', value: 5, subSymbol: undefined },
          v2: { symbol: 'number', value: 10, subSymbol: undefined }, // Unreferenced
        } as any,
        funcTable: {
          f1: {
            defId: 'pd1' as PlugDefineId,
            argMap: { a: 'v1' as ValueId, b: 'v1' as ValueId },
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
            args: { a: 'ia1' as any, b: 'ia2' as any },
          },
        } as any,
        tapFuncDefTable: {} as any,
        condFuncDefTable: {} as any,
      };

      const result = validateContext(context);

      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.message.includes('v2'))).toBe(true);
      expect(result.warnings.some(w => w.message.includes('never referenced'))).toBe(true);
    });

    it('should warn about unreferenced definitions', () => {
      const context: ExecutionContext = {
        valueTable: {
          v1: { symbol: 'number', value: 5, subSymbol: undefined },
        } as any,
        funcTable: {
          f1: {
            defId: 'pd1' as PlugDefineId,
            argMap: { a: 'v1' as ValueId, b: 'v1' as ValueId },
            returnId: 'v2' as ValueId,
          },
        } as any,
        plugFuncDefTable: {
          pd1: {
            name: 'binaryFnNumber::add',
            transformFn: {
              a: { name: 'transformFnNumber::pass' },
              b: { name: 'transformFnNumber::pass' },
            },
            args: { a: 'ia1' as any, b: 'ia2' as any },
          },
          'pd-unused': { // Unreferenced definition
            name: 'binaryFnNumber::multiply',
            transformFn: {
              a: { name: 'transformFnNumber::pass' },
              b: { name: 'transformFnNumber::pass' },
            },
            args: { a: 'ia1' as any, b: 'ia2' as any },
          },
        } as any,
        tapFuncDefTable: {} as any,
        condFuncDefTable: {} as any,
      };

      const result = validateContext(context);

      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.message.includes('pd-unused'))).toBe(true);
      expect(result.warnings.some(w => w.message.includes('never used'))).toBe(true);
    });
  });

  describe('assertValidContext', () => {
    it('should not throw for valid context', () => {
      const context: ExecutionContext = {
        valueTable: {
          v1: { symbol: 'number', value: 5, subSymbol: undefined },
        } as any,
        funcTable: {
          f1: {
            defId: 'pd1' as PlugDefineId,
            argMap: { a: 'v1' as ValueId, b: 'v1' as ValueId },
            returnId: 'v2' as ValueId,
          },
        } as any,
        plugFuncDefTable: {
          pd1: {
            name: 'binaryFnNumber::add',
            transformFn: {
              a: { name: 'transformFnNumber::pass' },
              b: { name: 'transformFnNumber::pass' },
            },
            args: { a: 'ia1' as any, b: 'ia2' as any },
          },
        } as any,
        tapFuncDefTable: {} as any,
        condFuncDefTable: {} as any,
      };

      expect(() => assertValidContext(context)).not.toThrow();
    });

    it('should throw for invalid context', () => {
      const context: ExecutionContext = {
        valueTable: {} as any,
        funcTable: {
          f1: {
            defId: 'pd-missing' as PlugDefineId,
            argMap: {},
            returnId: 'v1' as ValueId,
          },
        } as any,
        plugFuncDefTable: {} as any,
        tapFuncDefTable: {} as any,
        condFuncDefTable: {} as any,
      };

      expect(() => assertValidContext(context)).toThrow('ExecutionContext validation failed');
    });
  });
});

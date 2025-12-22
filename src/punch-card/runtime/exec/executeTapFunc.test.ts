import { describe, it, expect } from 'vitest';
import {
  createScopedValueTable,
  createScopedContext,
  validateScopedValueTable,
} from './executeTapFunc';
import {
  ExecutionContext,
  FuncId,
  ValueId,
  ValueTable,
  InterfaceArgId,
} from '../../types';

describe('executeTapFunc helpers', () => {
  describe('createScopedValueTable', () => {
    it('should create a scoped value table with all required arguments', () => {
      const sourceValueTable: ValueTable = {
        v1: { symbol: 'number', value: 10, subSymbol: undefined },
        v2: { symbol: 'string', value: 'hello', subSymbol: undefined },
        v3: { symbol: 'boolean', value: true, subSymbol: undefined },
      } as any;

      const argMap = {
        a: 'v1' as ValueId,
        b: 'v2' as ValueId,
      };

      const tapDefArgs = {
        a: 'ia-a' as InterfaceArgId,
        b: 'ia-b' as InterfaceArgId,
      };

      const result = createScopedValueTable(
        argMap,
        tapDefArgs,
        sourceValueTable,
        'f1' as FuncId
      );

      expect(result).toEqual({
        v1: { symbol: 'number', value: 10, subSymbol: undefined },
        v2: { symbol: 'string', value: 'hello', subSymbol: undefined },
      });

      // Should NOT include v3 (not in argMap)
      expect('v3' in result).toBe(false);
    });

    it('should throw error when argument is missing from argMap', () => {
      const sourceValueTable: ValueTable = {
        v1: { symbol: 'number', value: 10, subSymbol: undefined },
      } as any;

      const argMap = {
        // Missing 'b'
        a: 'v1' as ValueId,
      };

      const tapDefArgs = {
        a: 'ia-a' as InterfaceArgId,
        b: 'ia-b' as InterfaceArgId, // Expected but not in argMap
      };

      expect(() =>
        createScopedValueTable(
          argMap,
          tapDefArgs,
          sourceValueTable,
          'f1' as FuncId
        )
      ).toThrow();
    });

    it('should throw error when value is missing from sourceValueTable', () => {
      const sourceValueTable: ValueTable = {
        v1: { symbol: 'number', value: 10, subSymbol: undefined },
        // v2 is missing
      } as any;

      const argMap = {
        a: 'v1' as ValueId,
        b: 'v2' as ValueId,
      };

      const tapDefArgs = {
        a: 'ia-a' as InterfaceArgId,
        b: 'ia-b' as InterfaceArgId,
      };

      expect(() =>
        createScopedValueTable(
          argMap,
          tapDefArgs,
          sourceValueTable,
          'f1' as FuncId
        )
      ).toThrow('Missing value: v2');
    });

    it('should handle empty tapDefArgs (no arguments)', () => {
      const sourceValueTable: ValueTable = {
        v1: { symbol: 'number', value: 10, subSymbol: undefined },
      } as any;

      const argMap = {};
      const tapDefArgs = {};

      const result = createScopedValueTable(
        argMap,
        tapDefArgs,
        sourceValueTable,
        'f1' as FuncId
      );

      expect(result).toEqual({});
    });
  });

  describe('validateScopedValueTable', () => {
    it('should pass validation when all expected values are present', () => {
      const scopedValueTable: Partial<ValueTable> = {
        v1: { symbol: 'number', value: 10, subSymbol: undefined },
        v2: { symbol: 'string', value: 'hello', subSymbol: undefined },
      } as any;

      const argMap = {
        a: 'v1' as ValueId,
        b: 'v2' as ValueId,
      };

      const tapDefArgs = {
        a: 'ia-a' as InterfaceArgId,
        b: 'ia-b' as InterfaceArgId,
      };

      expect(() =>
        validateScopedValueTable(scopedValueTable, tapDefArgs, argMap)
      ).not.toThrow();
    });

    it('should throw error when expected value is missing', () => {
      const scopedValueTable: Partial<ValueTable> = {
        v1: { symbol: 'number', value: 10, subSymbol: undefined },
        // v2 is missing
      } as any;

      const argMap = {
        a: 'v1' as ValueId,
        b: 'v2' as ValueId,
      };

      const tapDefArgs = {
        a: 'ia-a' as InterfaceArgId,
        b: 'ia-b' as InterfaceArgId,
      };

      expect(() =>
        validateScopedValueTable(scopedValueTable, tapDefArgs, argMap)
      ).toThrow('Scoped value table is incomplete: missing v2');
    });

    it('should pass validation for empty table with no arguments', () => {
      const scopedValueTable: Partial<ValueTable> = {};
      const argMap = {};
      const tapDefArgs = {};

      expect(() =>
        validateScopedValueTable(scopedValueTable, tapDefArgs, argMap)
      ).not.toThrow();
    });
  });

  describe('createScopedContext', () => {
    it('should create a new context with scoped value table', () => {
      const originalContext: ExecutionContext = {
        valueTable: {
          v1: { symbol: 'number', value: 10, subSymbol: undefined },
          v2: { symbol: 'string', value: 'original', subSymbol: undefined },
        } as any,
        funcTable: {} as any,
        plugFuncDefTable: {} as any,
        tapFuncDefTable: {} as any,
        condFuncDefTable: {} as any,
      };

      const scopedValueTable: ValueTable = {
        v3: { symbol: 'number', value: 20, subSymbol: undefined },
      } as any;

      const scopedContext = createScopedContext(
        originalContext,
        scopedValueTable
      );

      // Should have the new scoped value table
      expect(scopedContext.valueTable).toBe(scopedValueTable);
      expect(scopedContext.valueTable).toEqual({
        v3: { symbol: 'number', value: 20, subSymbol: undefined },
      });

      // Should preserve other tables from original context
      expect(scopedContext.funcTable).toBe(originalContext.funcTable);
      expect(scopedContext.plugFuncDefTable).toBe(
        originalContext.plugFuncDefTable
      );
      expect(scopedContext.tapFuncDefTable).toBe(
        originalContext.tapFuncDefTable
      );
      expect(scopedContext.condFuncDefTable).toBe(
        originalContext.condFuncDefTable
      );

      // Original context should not be mutated
      expect(originalContext.valueTable).toEqual({
        v1: { symbol: 'number', value: 10, subSymbol: undefined },
        v2: { symbol: 'string', value: 'original', subSymbol: undefined },
      });
    });
  });
});

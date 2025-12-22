import { describe, it, expect } from 'vitest';
import { validateContext, assertValidContext } from './validateContext';
import { executeGraph } from './exec/executeGraph';
import {
  ExecutionContext,
  FuncId,
  ValueId,
  PlugDefineId,
  TapDefineId,
  CondDefineId,
} from '../types';

/**
 * Integration tests demonstrating the compile-time validation workflow.
 * These tests show how to use validateContext before executeGraph,
 * similar to how a compiler validates before running code.
 */
describe('validateContext integration', () => {
  describe('compile-time validation workflow', () => {
    it('should validate context before execution (valid case)', () => {
      const context: ExecutionContext = {
        valueTable: {
          v1: { symbol: 'number', value: 10, subSymbol: undefined },
          v2: { symbol: 'number', value: 5, subSymbol: undefined },
        } as any,
        funcTable: {
          f1: {
            defId: 'pd-add' as PlugDefineId,
            argMap: { a: 'v1' as ValueId, b: 'v2' as ValueId },
            returnId: 'v3' as ValueId,
          },
        } as any,
        plugFuncDefTable: {
          'pd-add': {
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

      // STEP 1: Validate (compile-time check)
      const validation = validateContext(context);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);

      // STEP 2: Execute (runtime) - only if validation passed
      if (validation.valid) {
        const result = executeGraph('f1' as FuncId, context);
        expect(result.value).toBe(15);
      }
    });

    it('should catch errors at validation time, preventing execution', () => {
      const invalidContext: ExecutionContext = {
        valueTable: {
          v1: { symbol: 'number', value: 10, subSymbol: undefined },
          // v2 is missing - validation should catch this
        } as any,
        funcTable: {
          f1: {
            defId: 'pd-add' as PlugDefineId,
            argMap: {
              a: 'v1' as ValueId,
              b: 'v2' as ValueId, // References non-existent v2
            },
            returnId: 'v3' as ValueId,
          },
        } as any,
        plugFuncDefTable: {
          'pd-add': {
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

      // STEP 1: Validate (compile-time check)
      const validation = validateContext(invalidContext);

      // Validation should fail
      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
      expect(validation.errors.some(e => e.message.includes('v2'))).toBe(true);

      // STEP 2: DO NOT execute - validation prevented it
      // This demonstrates catching errors at "compile-time" rather than runtime
      expect(validation.valid).toBe(false);
    });

    it('should use assertValidContext for strict validation', () => {
      const invalidContext: ExecutionContext = {
        valueTable: {} as any,
        funcTable: {
          f1: {
            defId: 'pd-nonexistent' as PlugDefineId,
            argMap: {},
            returnId: 'v1' as ValueId,
          },
        } as any,
        plugFuncDefTable: {} as any,
        tapFuncDefTable: {} as any,
        condFuncDefTable: {} as any,
      };

      // assertValidContext throws if invalid
      expect(() => assertValidContext(invalidContext)).toThrow(
        'ExecutionContext validation failed'
      );
    });
  });

  describe('validation with TapFunc', () => {
    it('should validate TapFunc context before execution', () => {
      const context: ExecutionContext = {
        valueTable: {
          v1: { symbol: 'number', value: 10, subSymbol: undefined },
          v2: { symbol: 'number', value: 5, subSymbol: undefined },
        } as any,
        funcTable: {
          f1: {
            defId: 'pd-add' as PlugDefineId,
            argMap: { a: 'v1' as ValueId, b: 'v2' as ValueId },
            returnId: 'v3' as ValueId,
          },
          tap1: {
            defId: 'td1' as TapDefineId,
            argMap: { x: 'v1' as ValueId, y: 'v2' as ValueId },
            returnId: 'v4' as ValueId,
          },
        } as any,
        plugFuncDefTable: {
          'pd-add': {
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
            args: { x: 'ia-x' as any, y: 'ia-y' as any },
            sequence: ['f1' as FuncId],
          },
        } as any,
        condFuncDefTable: {} as any,
      };

      // Validate
      const validation = validateContext(context);
      expect(validation.valid).toBe(true);

      // Execute
      const result = executeGraph('tap1' as FuncId, context);
      expect(result.value).toBe(15);
    });

    it('should detect invalid TapFunc sequence at validation time', () => {
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
            sequence: ['f-nonexistent' as FuncId], // Invalid reference
          },
        } as any,
        condFuncDefTable: {} as any,
      };

      const validation = validateContext(context);

      expect(validation.valid).toBe(false);
      expect(
        validation.errors.some(e => e.message.includes('f-nonexistent'))
      ).toBe(true);
    });
  });

  describe('validation with CondFunc', () => {
    it('should validate CondFunc context before execution', () => {
      const context: ExecutionContext = {
        valueTable: {
          vCond: { symbol: 'boolean', value: true, subSymbol: undefined },
          v1: { symbol: 'number', value: 100, subSymbol: undefined },
          v2: { symbol: 'number', value: 200, subSymbol: undefined },
          v0: { symbol: 'number', value: 0, subSymbol: undefined },
        } as any,
        funcTable: {
          fTrue: {
            defId: 'pd-add' as PlugDefineId,
            argMap: { a: 'v1' as ValueId, b: 'v0' as ValueId },
            returnId: 'vTrueResult' as ValueId,
          },
          fFalse: {
            defId: 'pd-add' as PlugDefineId,
            argMap: { a: 'v2' as ValueId, b: 'v0' as ValueId },
            returnId: 'vFalseResult' as ValueId,
          },
          cond1: {
            defId: 'cd1' as CondDefineId,
            argMap: {},
            returnId: 'vResult' as ValueId,
          },
        } as any,
        plugFuncDefTable: {
          'pd-add': {
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

      // Validate
      const validation = validateContext(context);
      expect(validation.valid).toBe(true);

      // Execute
      const result = executeGraph('cond1' as FuncId, context);
      expect(result.value).toBe(100);
    });

    it('should detect invalid CondFunc branches at validation time', () => {
      const context: ExecutionContext = {
        valueTable: {
          vCond: { symbol: 'boolean', value: true, subSymbol: undefined },
        } as any,
        funcTable: {
          cond1: {
            defId: 'cd1' as CondDefineId,
            argMap: {},
            returnId: 'vResult' as ValueId,
          },
        } as any,
        plugFuncDefTable: {} as any,
        tapFuncDefTable: {} as any,
        condFuncDefTable: {
          cd1: {
            conditionId: 'vCond' as ValueId,
            trueBranchId: 'f-invalid-true' as FuncId,
            falseBranchId: 'f-invalid-false' as FuncId,
          },
        } as any,
      };

      const validation = validateContext(context);

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThanOrEqual(2);
      expect(
        validation.errors.some(e => e.message.includes('trueBranchId'))
      ).toBe(true);
      expect(
        validation.errors.some(e => e.message.includes('falseBranchId'))
      ).toBe(true);
    });
  });

  describe('warnings do not block execution', () => {
    it('should allow execution with warnings (unreferenced values)', () => {
      const context: ExecutionContext = {
        valueTable: {
          v1: { symbol: 'number', value: 10, subSymbol: undefined },
          v2: { symbol: 'number', value: 5, subSymbol: undefined },
          v_unused: { symbol: 'number', value: 99, subSymbol: undefined }, // Unused
        } as any,
        funcTable: {
          f1: {
            defId: 'pd-add' as PlugDefineId,
            argMap: { a: 'v1' as ValueId, b: 'v2' as ValueId },
            returnId: 'v3' as ValueId,
          },
        } as any,
        plugFuncDefTable: {
          'pd-add': {
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

      const validation = validateContext(context);

      // Valid but has warnings
      expect(validation.valid).toBe(true);
      expect(validation.warnings.length).toBeGreaterThan(0);
      expect(
        validation.warnings.some(w => w.message.includes('v_unused'))
      ).toBe(true);

      // Execution should still work
      const result = executeGraph('f1' as FuncId, context);
      expect(result.value).toBe(15);
    });
  });
});

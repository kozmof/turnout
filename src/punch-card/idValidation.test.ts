import { describe, it, expect } from 'vitest';
import {
  isValidValueId,
  isValidFuncId,
  isValidPlugDefineId,
  isValidTapDefineId,
  isValidCondDefineId,
  isValidInterfaceArgId,
  isValidStepDefId,
  createValueId,
  createFuncId,
  createPlugDefineId,
  createTapDefineId,
  createCondDefineId,
  createInterfaceArgId,
} from './idValidation';
import type {
  ValueId,
  FuncId,
  PlugDefineId,
  TapDefineId,
  CondDefineId,
  InterfaceArgId,
} from './types';

describe('ID Validation Module', () => {
  describe('Structural Validators', () => {
    describe('isValidValueId', () => {
      it('should return true for non-empty strings', () => {
        expect(isValidValueId('v1')).toBe(true);
        expect(isValidValueId('v_a3f2d8e1')).toBe(true);
        expect(isValidValueId('myValue')).toBe(true);
        expect(isValidValueId('x')).toBe(true);
      });

      it('should return false for empty strings', () => {
        expect(isValidValueId('')).toBe(false);
      });

      it('should return false for non-strings', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(isValidValueId(null as any)).toBe(false);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(isValidValueId(undefined as any)).toBe(false);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(isValidValueId(123 as any)).toBe(false);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(isValidValueId({} as any)).toBe(false);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(isValidValueId([] as any)).toBe(false);
      });
    });

    describe('isValidFuncId', () => {
      it('should return true for non-empty strings', () => {
        expect(isValidFuncId('f1')).toBe(true);
        expect(isValidFuncId('f_7b8c9a2e')).toBe(true);
        expect(isValidFuncId('myFunc')).toBe(true);
      });

      it('should return false for empty strings', () => {
        expect(isValidFuncId('')).toBe(false);
      });

      it('should return false for non-strings', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(isValidFuncId(null as any)).toBe(false);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(isValidFuncId(undefined as any)).toBe(false);
      });
    });

    describe('isValidPlugDefineId', () => {
      it('should return true for non-empty strings regardless of prefix', () => {
        expect(isValidPlugDefineId('pd_a3f2d8e1')).toBe(true);
        expect(isValidPlugDefineId('myPlugDef')).toBe(true);
        expect(isValidPlugDefineId('anything')).toBe(true);
      });

      it('should return false for empty strings', () => {
        expect(isValidPlugDefineId('')).toBe(false);
      });
    });

    describe('isValidTapDefineId', () => {
      it('should return true for non-empty strings regardless of prefix', () => {
        expect(isValidTapDefineId('td_a3f2d8e1')).toBe(true);
        expect(isValidTapDefineId('myTapDef')).toBe(true);
        expect(isValidTapDefineId('anything')).toBe(true);
      });

      it('should return false for empty strings', () => {
        expect(isValidTapDefineId('')).toBe(false);
      });
    });

    describe('isValidCondDefineId', () => {
      it('should return true for non-empty strings regardless of prefix', () => {
        expect(isValidCondDefineId('cd_a3f2d8e1')).toBe(true);
        expect(isValidCondDefineId('myCondDef')).toBe(true);
        expect(isValidCondDefineId('anything')).toBe(true);
      });

      it('should return false for empty strings', () => {
        expect(isValidCondDefineId('')).toBe(false);
      });
    });

    describe('isValidInterfaceArgId', () => {
      it('should return true for non-empty strings regardless of prefix', () => {
        expect(isValidInterfaceArgId('ia1')).toBe(true);
        expect(isValidInterfaceArgId('ia_a3f2d8e1')).toBe(true);
        expect(isValidInterfaceArgId('myArg')).toBe(true);
      });

      it('should return false for empty strings', () => {
        expect(isValidInterfaceArgId('')).toBe(false);
      });
    });

    describe('isValidStepDefId', () => {
      it('should return true for non-empty strings regardless of prefix', () => {
        expect(isValidStepDefId('pd_a3f2d8e1')).toBe(true);
        expect(isValidStepDefId('td_a3f2d8e1')).toBe(true);
        expect(isValidStepDefId('cd_a3f2d8e1')).toBe(true);
        expect(isValidStepDefId('myDef')).toBe(true);
      });

      it('should return false for empty strings', () => {
        expect(isValidStepDefId('')).toBe(false);
      });
    });
  });

  describe('Branded ID Creators', () => {
    describe('createValueId', () => {
      it('should create branded ValueId for valid input', () => {
        const id = createValueId('v1');
        expect(id).toBe('v1');

        // Type assertion to verify branded type
        const _typeCheck: ValueId = id;
        expect(_typeCheck).toBe('v1');
      });

      it('should accept various non-empty strings', () => {
        expect(createValueId('v_a3f2d8e1')).toBe('v_a3f2d8e1');
        expect(createValueId('myValue')).toBe('myValue');
        expect(createValueId('123')).toBe('123');
      });

      it('should throw for empty strings', () => {
        expect(() => createValueId('')).toThrow('Invalid ValueId');
      });

      it('should throw for non-strings', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(() => createValueId(null as any)).toThrow('Invalid ValueId');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(() => createValueId(undefined as any)).toThrow('Invalid ValueId');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(() => createValueId(123 as any)).toThrow('Invalid ValueId');
      });
    });

    describe('createFuncId', () => {
      it('should create branded FuncId for valid input', () => {
        const id = createFuncId('f1');
        expect(id).toBe('f1');

        // Type assertion to verify branded type
        const _typeCheck: FuncId = id;
        expect(_typeCheck).toBe('f1');
      });

      it('should accept various non-empty strings', () => {
        expect(createFuncId('f_7b8c9a2e')).toBe('f_7b8c9a2e');
        expect(createFuncId('myFunc')).toBe('myFunc');
      });

      it('should throw for empty strings', () => {
        expect(() => createFuncId('')).toThrow('Invalid FuncId');
      });

      it('should throw for non-strings', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(() => createFuncId(null as any)).toThrow('Invalid FuncId');
      });
    });

    describe('createPlugDefineId', () => {
      it('should create branded PlugDefineId for valid input', () => {
        const id = createPlugDefineId('pd_a3f2d8e1');
        expect(id).toBe('pd_a3f2d8e1');

        // Type assertion to verify branded type
        const _typeCheck: PlugDefineId = id;
        expect(_typeCheck).toBe('pd_a3f2d8e1');
      });

      it('should accept strings regardless of prefix', () => {
        expect(createPlugDefineId('myPlugDef')).toBe('myPlugDef');
        expect(createPlugDefineId('td_something')).toBe('td_something');
      });

      it('should throw for empty strings', () => {
        expect(() => createPlugDefineId('')).toThrow('Invalid PlugDefineId');
      });
    });

    describe('createTapDefineId', () => {
      it('should create branded TapDefineId for valid input', () => {
        const id = createTapDefineId('td_a3f2d8e1');
        expect(id).toBe('td_a3f2d8e1');

        // Type assertion to verify branded type
        const _typeCheck: TapDefineId = id;
        expect(_typeCheck).toBe('td_a3f2d8e1');
      });

      it('should accept strings regardless of prefix', () => {
        expect(createTapDefineId('myTapDef')).toBe('myTapDef');
        expect(createTapDefineId('pd_something')).toBe('pd_something');
      });

      it('should throw for empty strings', () => {
        expect(() => createTapDefineId('')).toThrow('Invalid TapDefineId');
      });
    });

    describe('createCondDefineId', () => {
      it('should create branded CondDefineId for valid input', () => {
        const id = createCondDefineId('cd_a3f2d8e1');
        expect(id).toBe('cd_a3f2d8e1');

        // Type assertion to verify branded type
        const _typeCheck: CondDefineId = id;
        expect(_typeCheck).toBe('cd_a3f2d8e1');
      });

      it('should accept strings regardless of prefix', () => {
        expect(createCondDefineId('myCondDef')).toBe('myCondDef');
      });

      it('should throw for empty strings', () => {
        expect(() => createCondDefineId('')).toThrow('Invalid CondDefineId');
      });
    });

    describe('createInterfaceArgId', () => {
      it('should create branded InterfaceArgId for valid input', () => {
        const id = createInterfaceArgId('ia1');
        expect(id).toBe('ia1');

        // Type assertion to verify branded type
        const _typeCheck: InterfaceArgId = id;
        expect(_typeCheck).toBe('ia1');
      });

      it('should accept strings regardless of prefix', () => {
        expect(createInterfaceArgId('ia_a3f2d8e1')).toBe('ia_a3f2d8e1');
        expect(createInterfaceArgId('myArg')).toBe('myArg');
      });

      it('should throw for empty strings', () => {
        expect(() => createInterfaceArgId('')).toThrow('Invalid InterfaceArgId');
      });
    });
  });

  describe('Integration: Validators and Creators', () => {
    it('should use validators consistently in creators', () => {
      // Valid IDs should pass both validator and creator
      expect(isValidValueId('v1')).toBe(true);
      expect(() => createValueId('v1')).not.toThrow();

      // Invalid IDs should fail both validator and creator
      expect(isValidValueId('')).toBe(false);
      expect(() => createValueId('')).toThrow();
    });

    it('should maintain branded type distinctions', () => {
      const valueId = createValueId('v1');
      const funcId = createFuncId('f1');
      const plugDefId = createPlugDefineId('pd1');

      // All are strings at runtime
      expect(typeof valueId).toBe('string');
      expect(typeof funcId).toBe('string');
      expect(typeof plugDefId).toBe('string');

      // But TypeScript knows they're different types (compile-time check)
      const _v: ValueId = valueId;
      const _f: FuncId = funcId;
      const _p: PlugDefineId = plugDefId;

      // Suppress unused variable warnings
      expect(_v).toBeDefined();
      expect(_f).toBeDefined();
      expect(_p).toBeDefined();
    });
  });
});

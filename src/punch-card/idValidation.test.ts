import { describe, it, expect } from 'vitest';
import {
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
  describe('Branded ID Creators', () => {
    describe('createValueId', () => {
      it('should create branded ValueId from any string', () => {
        const id = createValueId('v1');
        expect(id).toBe('v1');

        // Type assertion to verify branded type
        const _typeCheck: ValueId = id;
        expect(_typeCheck).toBe('v1');
      });

      it('should accept various strings including empty strings', () => {
        expect(createValueId('v_a3f2d8e1')).toBe('v_a3f2d8e1');
        expect(createValueId('myValue')).toBe('myValue');
        expect(createValueId('123')).toBe('123');
        expect(createValueId('')).toBe('');
      });
    });

    describe('createFuncId', () => {
      it('should create branded FuncId from any string', () => {
        const id = createFuncId('f1');
        expect(id).toBe('f1');

        // Type assertion to verify branded type
        const _typeCheck: FuncId = id;
        expect(_typeCheck).toBe('f1');
      });

      it('should accept various strings', () => {
        expect(createFuncId('f_7b8c9a2e')).toBe('f_7b8c9a2e');
        expect(createFuncId('myFunc')).toBe('myFunc');
        expect(createFuncId('')).toBe('');
      });
    });

    describe('createPlugDefineId', () => {
      it('should create branded PlugDefineId from any string', () => {
        const id = createPlugDefineId('pd_a3f2d8e1');
        expect(id).toBe('pd_a3f2d8e1');

        // Type assertion to verify branded type
        const _typeCheck: PlugDefineId = id;
        expect(_typeCheck).toBe('pd_a3f2d8e1');
      });

      it('should accept strings regardless of prefix', () => {
        expect(createPlugDefineId('myPlugDef')).toBe('myPlugDef');
        expect(createPlugDefineId('td_something')).toBe('td_something');
        expect(createPlugDefineId('')).toBe('');
      });
    });

    describe('createTapDefineId', () => {
      it('should create branded TapDefineId from any string', () => {
        const id = createTapDefineId('td_a3f2d8e1');
        expect(id).toBe('td_a3f2d8e1');

        // Type assertion to verify branded type
        const _typeCheck: TapDefineId = id;
        expect(_typeCheck).toBe('td_a3f2d8e1');
      });

      it('should accept strings regardless of prefix', () => {
        expect(createTapDefineId('myTapDef')).toBe('myTapDef');
        expect(createTapDefineId('pd_something')).toBe('pd_something');
        expect(createTapDefineId('')).toBe('');
      });
    });

    describe('createCondDefineId', () => {
      it('should create branded CondDefineId from any string', () => {
        const id = createCondDefineId('cd_a3f2d8e1');
        expect(id).toBe('cd_a3f2d8e1');

        // Type assertion to verify branded type
        const _typeCheck: CondDefineId = id;
        expect(_typeCheck).toBe('cd_a3f2d8e1');
      });

      it('should accept strings regardless of prefix', () => {
        expect(createCondDefineId('myCondDef')).toBe('myCondDef');
        expect(createCondDefineId('')).toBe('');
      });
    });

    describe('createInterfaceArgId', () => {
      it('should create branded InterfaceArgId from any string', () => {
        const id = createInterfaceArgId('ia1');
        expect(id).toBe('ia1');

        // Type assertion to verify branded type
        const _typeCheck: InterfaceArgId = id;
        expect(_typeCheck).toBe('ia1');
      });

      it('should accept strings regardless of prefix', () => {
        expect(createInterfaceArgId('ia_a3f2d8e1')).toBe('ia_a3f2d8e1');
        expect(createInterfaceArgId('myArg')).toBe('myArg');
        expect(createInterfaceArgId('')).toBe('');
      });
    });
  });

  describe('Type Safety', () => {
    it('should maintain branded type distinctions at compile time', () => {
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

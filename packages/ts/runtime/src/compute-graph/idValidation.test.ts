import { describe, it, expect } from 'vitest';
import {
  createValueId,
  createFuncId,
  createCombineDefineId,
  createPipeDefineId,
  createCondDefineId,
} from './idValidation';
import type {
  ValueId,
  FuncId,
  CombineDefineId,
  PipeDefineId,
  CondDefineId,
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

      it('should accept various non-empty strings', () => {
        expect(createValueId('v_a3f2d8e1')).toBe('v_a3f2d8e1');
        expect(createValueId('myValue')).toBe('myValue');
        expect(createValueId('123')).toBe('123');
      });

      it('should throw on empty string', () => {
        expect(() => createValueId('')).toThrow('ValueId cannot be empty');
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

      it('should accept various non-empty strings', () => {
        expect(createFuncId('f_7b8c9a2e')).toBe('f_7b8c9a2e');
        expect(createFuncId('myFunc')).toBe('myFunc');
      });

      it('should throw on empty string', () => {
        expect(() => createFuncId('')).toThrow('FuncId cannot be empty');
      });
    });

    describe('createCombineDefineId', () => {
      it('should create branded CombineDefineId from any string', () => {
        const id = createCombineDefineId('pd_a3f2d8e1');
        expect(id).toBe('pd_a3f2d8e1');

        // Type assertion to verify branded type
        const _typeCheck: CombineDefineId = id;
        expect(_typeCheck).toBe('pd_a3f2d8e1');
      });

      it('should accept non-empty strings regardless of prefix', () => {
        expect(createCombineDefineId('myCombineDef')).toBe('myCombineDef');
        expect(createCombineDefineId('td_something')).toBe('td_something');
      });

      it('should throw on empty string', () => {
        expect(() => createCombineDefineId('')).toThrow('CombineDefineId cannot be empty');
      });
    });

    describe('createPipeDefineId', () => {
      it('should create branded PipeDefineId from any string', () => {
        const id = createPipeDefineId('td_a3f2d8e1');
        expect(id).toBe('td_a3f2d8e1');

        // Type assertion to verify branded type
        const _typeCheck: PipeDefineId = id;
        expect(_typeCheck).toBe('td_a3f2d8e1');
      });

      it('should accept non-empty strings regardless of prefix', () => {
        expect(createPipeDefineId('myPipeDef')).toBe('myPipeDef');
        expect(createPipeDefineId('pd_something')).toBe('pd_something');
      });

      it('should throw on empty string', () => {
        expect(() => createPipeDefineId('')).toThrow('PipeDefineId cannot be empty');
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

      it('should accept non-empty strings regardless of prefix', () => {
        expect(createCondDefineId('myCondDef')).toBe('myCondDef');
      });

      it('should throw on empty string', () => {
        expect(() => createCondDefineId('')).toThrow('CondDefineId cannot be empty');
      });
    });

  });

  describe('Type Safety', () => {
    it('should maintain branded type distinctions at compile time', () => {
      const valueId = createValueId('v1');
      const funcId = createFuncId('f1');
      const combineDefId = createCombineDefineId('pd1');

      // All are strings at runtime
      expect(typeof valueId).toBe('string');
      expect(typeof funcId).toBe('string');
      expect(typeof combineDefId).toBe('string');

      // But TypeScript knows they're different types (compile-time check)
      const _v: ValueId = valueId;
      const _f: FuncId = funcId;
      const _p: CombineDefineId = combineDefId;

      // Suppress unused variable warnings
      expect(_v).toBeDefined();
      expect(_f).toBeDefined();
      expect(_p).toBeDefined();
    });
  });
});

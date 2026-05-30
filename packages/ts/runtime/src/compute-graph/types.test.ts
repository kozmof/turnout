import { describe, it, expect } from 'vitest';
import {
  isArgMapEntry,
  isCondEntry,
  isValueCondition,
  isFuncCondition,
  makeCombineDefineId,
  makePipeDefineId,
  makeCondDefineId,
  makeValueId,
  makeFuncId,
  makePipeArgName,
  makeArgName,
} from './types';
import type {
  FuncTableEntry,
  ConditionId,
  CombineDefineId,
  PipeDefineId,
  CondDefineId,
  ValueId,
  FuncId,
} from './types';

describe('types', () => {
  describe('isArgMapEntry', () => {
    it('returns true for combine entries', () => {
      const entry: FuncTableEntry = {
        kind: 'combine',
        defId: 'pd1' as CombineDefineId,
        argMap: {} as any,
        returnId: 'v1' as ValueId,
      };
      expect(isArgMapEntry(entry)).toBe(true);
    });

    it('returns true for pipe entries', () => {
      const entry: FuncTableEntry = {
        kind: 'pipe',
        defId: 'td1' as PipeDefineId,
        argMap: {} as any,
        returnId: 'v1' as ValueId,
      };
      expect(isArgMapEntry(entry)).toBe(true);
    });

    it('returns false for cond entries', () => {
      const entry: FuncTableEntry = {
        kind: 'cond',
        defId: 'cd1' as CondDefineId,
        returnId: 'v1' as ValueId,
      };
      expect(isArgMapEntry(entry)).toBe(false);
    });
  });

  describe('isCondEntry', () => {
    it('returns true for cond entries', () => {
      const entry: FuncTableEntry = {
        kind: 'cond',
        defId: 'cd1' as CondDefineId,
        returnId: 'v1' as ValueId,
      };
      expect(isCondEntry(entry)).toBe(true);
    });

    it('returns false for combine entries', () => {
      const entry: FuncTableEntry = {
        kind: 'combine',
        defId: 'pd1' as CombineDefineId,
        argMap: {} as any,
        returnId: 'v1' as ValueId,
      };
      expect(isCondEntry(entry)).toBe(false);
    });

    it('returns false for pipe entries', () => {
      const entry: FuncTableEntry = {
        kind: 'pipe',
        defId: 'td1' as PipeDefineId,
        argMap: {} as any,
        returnId: 'v1' as ValueId,
      };
      expect(isCondEntry(entry)).toBe(false);
    });
  });

  describe('isValueCondition', () => {
    it('returns true for value conditions', () => {
      const cond: ConditionId = { source: 'value', id: 'v1' as ValueId };
      expect(isValueCondition(cond)).toBe(true);
    });

    it('returns false for func conditions', () => {
      const cond: ConditionId = { source: 'func', id: 'f1' as FuncId };
      expect(isValueCondition(cond)).toBe(false);
    });
  });

  describe('isFuncCondition', () => {
    it('returns true for func conditions', () => {
      const cond: ConditionId = { source: 'func', id: 'f1' as FuncId };
      expect(isFuncCondition(cond)).toBe(true);
    });

    it('returns false for value conditions', () => {
      const cond: ConditionId = { source: 'value', id: 'v1' as ValueId };
      expect(isFuncCondition(cond)).toBe(false);
    });
  });

  describe('ID constructors', () => {
    it('creates a CombineDefineId', () => {
      expect(makeCombineDefineId('pd1')).toBe('pd1');
    });

    it('creates a PipeDefineId', () => {
      expect(makePipeDefineId('td1')).toBe('td1');
    });

    it('creates a CondDefineId', () => {
      expect(makeCondDefineId('cd1')).toBe('cd1');
    });

    it('creates a ValueId', () => {
      expect(makeValueId('v1')).toBe('v1');
    });

    it('creates a FuncId', () => {
      expect(makeFuncId('f1')).toBe('f1');
    });

    it('creates a PipeArgName', () => {
      expect(makePipeArgName('x')).toBe('x');
    });

    it('creates an ArgName', () => {
      expect(makeArgName('a')).toBe('a');
    });
  });
});

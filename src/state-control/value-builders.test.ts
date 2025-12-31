import { describe, it, expect } from 'vitest';
import {
  buildNumber,
  buildString,
  buildBoolean,
  buildArray,
  buildArrayNumber,
  buildArrayString,
  buildArrayBoolean,
  binaryNumberOp,
  binaryStringOp,
  binaryBooleanOp,
  unaryNumberOp,
  unaryStringOp,
  unaryBooleanOp,
  convertValue,
} from './value-builders';
import type { AnyValue } from './value';

describe('Value Builders', () => {
  describe('buildNumber', () => {
    it('creates a pure number value with no sources', () => {
      const result = buildNumber(42);

      expect(result).toEqual({
        symbol: 'number',
        value: 42,
        subSymbol: undefined,
        effects: [],
      });
    });

    it('propagates effects from a single source', () => {
      const source: AnyValue = {
        symbol: 'number',
        value: 10,
        subSymbol: undefined,
        effects: ['random'],
      };

      const result = buildNumber(42, source);

      expect(result.effects).toEqual(['random']);
    });

    it('merges effects from multiple sources', () => {
      const source1: AnyValue = {
        symbol: 'number',
        value: 5,
        subSymbol: undefined,
        effects: ['random'],
      };

      const source2: AnyValue = {
        symbol: 'number',
        value: 3,
        subSymbol: undefined,
        effects: ['cached', 'network'],
      };

      const result = buildNumber(8, source1, source2);

      expect(result.effects).toHaveLength(3);
      expect(result.effects).toContain('random');
      expect(result.effects).toContain('cached');
      expect(result.effects).toContain('network');
    });

    it('deduplicates effects', () => {
      const source1: AnyValue = {
        symbol: 'number',
        value: 5,
        subSymbol: undefined,
        effects: ['random', 'cached'],
      };

      const source2: AnyValue = {
        symbol: 'number',
        value: 3,
        subSymbol: undefined,
        effects: ['random', 'network'],
      };

      const result = buildNumber(8, source1, source2);

      expect(result.effects).toHaveLength(3);
      expect(result.effects.filter(e => e === 'random')).toHaveLength(1);
    });
  });

  describe('buildString', () => {
    it('creates a pure string value', () => {
      const result = buildString('hello');

      expect(result).toEqual({
        symbol: 'string',
        value: 'hello',
        subSymbol: undefined,
        effects: [],
      });
    });

    it('propagates effects from sources', () => {
      const source: AnyValue = {
        symbol: 'string',
        value: 'world',
        subSymbol: undefined,
        effects: ['user-input'],
      };

      const result = buildString('hello', source);

      expect(result.effects).toEqual(['user-input']);
    });
  });

  describe('buildBoolean', () => {
    it('creates a pure boolean value', () => {
      const result = buildBoolean(true);

      expect(result).toEqual({
        symbol: 'boolean',
        value: true,
        subSymbol: undefined,
        effects: [],
      });
    });

    it('propagates effects from sources', () => {
      const source: AnyValue = {
        symbol: 'boolean',
        value: false,
        subSymbol: undefined,
        effects: ['computed'],
      };

      const result = buildBoolean(true, source);

      expect(result.effects).toEqual(['computed']);
    });
  });

  describe('buildArray', () => {
    it('creates a pure array value', () => {
      const item1 = buildNumber(1);
      const item2 = buildNumber(2);
      const result = buildArray([item1, item2]);

      expect(result).toEqual({
        symbol: 'array',
        value: [item1, item2],
        subSymbol: undefined,
        effects: [],
      });
    });
  });

  describe('buildArrayNumber', () => {
    it('creates a typed number array', () => {
      const item1 = buildNumber(1);
      const item2 = buildNumber(2);
      const result = buildArrayNumber([item1, item2]);

      expect(result.symbol).toBe('array');
      expect(result.subSymbol).toBe('number');
      expect(result.value).toHaveLength(2);
    });
  });

  describe('buildArrayString', () => {
    it('creates a typed string array', () => {
      const item1 = buildString('a');
      const item2 = buildString('b');
      const result = buildArrayString([item1, item2]);

      expect(result.symbol).toBe('array');
      expect(result.subSymbol).toBe('string');
    });
  });

  describe('buildArrayBoolean', () => {
    it('creates a typed boolean array', () => {
      const item1 = buildBoolean(true);
      const item2 = buildBoolean(false);
      const result = buildArrayBoolean([item1, item2]);

      expect(result.symbol).toBe('array');
      expect(result.subSymbol).toBe('boolean');
    });
  });

  describe('binaryNumberOp', () => {
    it('applies operation and propagates effects', () => {
      const sourceA = buildNumber(0);
      const a = buildNumber(5, { ...sourceA, effects: ['random'] });
      const sourceB = buildNumber(0);
      const b = buildNumber(3, { ...sourceB, effects: ['cached'] });

      const result = binaryNumberOp((x, y) => x + y, a, b);

      expect(result.value).toBe(8);
      expect(result.effects).toHaveLength(2);
      expect(result.effects).toContain('random');
      expect(result.effects).toContain('cached');
    });

    it('works with pure values', () => {
      const a = buildNumber(10);
      const b = buildNumber(4);

      const result = binaryNumberOp((x, y) => x - y, a, b);

      expect(result.value).toBe(6);
      expect(result.effects).toEqual([]);
    });
  });

  describe('binaryStringOp', () => {
    it('applies operation and propagates effects', () => {
      const sourceA = buildString('');
      const a = buildString('Hello', { ...sourceA, effects: ['network'] });
      const b = buildString(' World');

      const result = binaryStringOp((x, y) => x + y, a, b);

      expect(result.value).toBe('Hello World');
      expect(result.effects).toEqual(['network']);
    });
  });

  describe('binaryBooleanOp', () => {
    it('applies comparison and propagates effects', () => {
      const sourceA = buildNumber(0);
      const a = buildNumber(5, { ...sourceA, effects: ['random'] });
      const b = buildNumber(3);

      const result = binaryBooleanOp((x, y) => x > y, a, b);

      expect(result.symbol).toBe('boolean');
      expect(result.value).toBe(true);
      expect(result.effects).toEqual(['random']);
    });

    it('works with different value types', () => {
      const a = buildString('hello');
      const b = buildString('world');

      const result = binaryBooleanOp((x, y) => x === y, a, b);

      expect(result.value).toBe(false);
    });
  });

  describe('unaryNumberOp', () => {
    it('applies transformation and propagates effects', () => {
      const baseSource = buildNumber(0);
      const source = buildNumber(5, { ...baseSource, effects: ['random'] });

      const result = unaryNumberOp(x => -x, source);

      expect(result.value).toBe(-5);
      expect(result.effects).toEqual(['random']);
    });

    it('works with pure values', () => {
      const source = buildNumber(16);

      const result = unaryNumberOp(x => Math.sqrt(x), source);

      expect(result.value).toBe(4);
      expect(result.effects).toEqual([]);
    });
  });

  describe('unaryStringOp', () => {
    it('applies transformation and propagates effects', () => {
      const baseSource = buildString('');
      const source = buildString('hello', { ...baseSource, effects: ['user-input'] });

      const result = unaryStringOp(x => x.toUpperCase(), source);

      expect(result.value).toBe('HELLO');
      expect(result.effects).toEqual(['user-input']);
    });
  });

  describe('unaryBooleanOp', () => {
    it('applies transformation and propagates effects', () => {
      const baseSource = buildBoolean(false);
      const source = buildBoolean(true, { ...baseSource, effects: ['computed'] });

      const result = unaryBooleanOp(x => !x, source);

      expect(result.value).toBe(false);
      expect(result.effects).toEqual(['computed']);
    });
  });

  describe('convertValue', () => {
    it('converts between types and propagates effects', () => {
      const baseSource = buildNumber(0);
      const source = buildNumber(42, { ...baseSource, effects: ['random'] });

      const result = convertValue(
        (n: number) => String(n),
        source,
        buildString
      );

      expect(result.symbol).toBe('string');
      expect(result.value).toBe('42');
      expect(result.effects).toEqual(['random']);
    });

    it('converts string to number', () => {
      const baseSource = buildString('');
      const source = buildString('123', { ...baseSource, effects: ['network'] });

      const result = convertValue(
        (s: string) => parseInt(s),
        source,
        buildNumber
      );

      expect(result.symbol).toBe('number');
      expect(result.value).toBe(123);
      expect(result.effects).toEqual(['network']);
    });
  });

  describe('Effect propagation edge cases', () => {
    it('handles empty effect arrays', () => {
      const a = buildNumber(1);
      const b = buildNumber(2);

      const result = buildNumber(3, a, b);

      expect(result.effects).toEqual([]);
    });

    it('handles many sources with overlapping effects', () => {
      const base1 = buildNumber(0);
      const base2 = buildNumber(0);
      const base3 = buildNumber(0);
      const base4 = buildNumber(0);

      const sources: AnyValue[] = [
        buildNumber(1, { ...base1, effects: ['a', 'b'] }),
        buildNumber(2, { ...base2, effects: ['b', 'c'] }),
        buildNumber(3, { ...base3, effects: ['c', 'd'] }),
        buildNumber(4, { ...base4, effects: ['d', 'a'] }),
      ];

      const result = buildNumber(10, ...sources);

      expect(result.effects).toHaveLength(4);
      expect(result.effects).toContain('a');
      expect(result.effects).toContain('b');
      expect(result.effects).toContain('c');
      expect(result.effects).toContain('d');
    });
  });
});

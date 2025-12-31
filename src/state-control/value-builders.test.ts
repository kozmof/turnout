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
        tags: [],
      });
    });

    it('propagates tags from a single source', () => {
      const source: AnyValue = {
        symbol: 'number',
        value: 10,
        subSymbol: undefined,
        tags: ['random'],
      };

      const result = buildNumber(42, source);

      expect(result.tags).toEqual(['random']);
    });

    it('merges tags from multiple sources', () => {
      const source1: AnyValue = {
        symbol: 'number',
        value: 5,
        subSymbol: undefined,
        tags: ['random'],
      };

      const source2: AnyValue = {
        symbol: 'number',
        value: 3,
        subSymbol: undefined,
        tags: ['cached', 'network'],
      };

      const result = buildNumber(8, source1, source2);

      expect(result.tags).toHaveLength(3);
      expect(result.tags).toContain('random');
      expect(result.tags).toContain('cached');
      expect(result.tags).toContain('network');
    });

    it('deduplicates tags', () => {
      const source1: AnyValue = {
        symbol: 'number',
        value: 5,
        subSymbol: undefined,
        tags: ['random', 'cached'],
      };

      const source2: AnyValue = {
        symbol: 'number',
        value: 3,
        subSymbol: undefined,
        tags: ['random', 'network'],
      };

      const result = buildNumber(8, source1, source2);

      expect(result.tags).toHaveLength(3);
      expect(result.tags.filter(e => e === 'random')).toHaveLength(1);
    });
  });

  describe('buildString', () => {
    it('creates a pure string value', () => {
      const result = buildString('hello');

      expect(result).toEqual({
        symbol: 'string',
        value: 'hello',
        subSymbol: undefined,
        tags: [],
      });
    });

    it('propagates tags from sources', () => {
      const source: AnyValue = {
        symbol: 'string',
        value: 'world',
        subSymbol: undefined,
        tags: ['user-input'],
      };

      const result = buildString('hello', source);

      expect(result.tags).toEqual(['user-input']);
    });
  });

  describe('buildBoolean', () => {
    it('creates a pure boolean value', () => {
      const result = buildBoolean(true);

      expect(result).toEqual({
        symbol: 'boolean',
        value: true,
        subSymbol: undefined,
        tags: [],
      });
    });

    it('propagates tags from sources', () => {
      const source: AnyValue = {
        symbol: 'boolean',
        value: false,
        subSymbol: undefined,
        tags: ['computed'],
      };

      const result = buildBoolean(true, source);

      expect(result.tags).toEqual(['computed']);
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
        tags: [],
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
    it('applies operation and propagates tags', () => {
      const sourceA = buildNumber(0);
      const a = buildNumber(5, { ...sourceA, tags: ['random'] });
      const sourceB = buildNumber(0);
      const b = buildNumber(3, { ...sourceB, tags: ['cached'] });

      const result = binaryNumberOp((x, y) => x + y, a, b);

      expect(result.value).toBe(8);
      expect(result.tags).toHaveLength(2);
      expect(result.tags).toContain('random');
      expect(result.tags).toContain('cached');
    });

    it('works with pure values', () => {
      const a = buildNumber(10);
      const b = buildNumber(4);

      const result = binaryNumberOp((x, y) => x - y, a, b);

      expect(result.value).toBe(6);
      expect(result.tags).toEqual([]);
    });
  });

  describe('binaryStringOp', () => {
    it('applies operation and propagates tags', () => {
      const sourceA = buildString('');
      const a = buildString('Hello', { ...sourceA, tags: ['network'] });
      const b = buildString(' World');

      const result = binaryStringOp((x, y) => x + y, a, b);

      expect(result.value).toBe('Hello World');
      expect(result.tags).toEqual(['network']);
    });
  });

  describe('binaryBooleanOp', () => {
    it('applies comparison and propagates tags', () => {
      const sourceA = buildNumber(0);
      const a = buildNumber(5, { ...sourceA, tags: ['random'] });
      const b = buildNumber(3);

      const result = binaryBooleanOp((x, y) => x > y, a, b);

      expect(result.symbol).toBe('boolean');
      expect(result.value).toBe(true);
      expect(result.tags).toEqual(['random']);
    });

    it('works with different value types', () => {
      const a = buildString('hello');
      const b = buildString('world');

      const result = binaryBooleanOp((x, y) => x === y, a, b);

      expect(result.value).toBe(false);
    });
  });

  describe('unaryNumberOp', () => {
    it('applies transformation and propagates tags', () => {
      const baseSource = buildNumber(0);
      const source = buildNumber(5, { ...baseSource, tags: ['random'] });

      const result = unaryNumberOp(x => -x, source);

      expect(result.value).toBe(-5);
      expect(result.tags).toEqual(['random']);
    });

    it('works with pure values', () => {
      const source = buildNumber(16);

      const result = unaryNumberOp(x => Math.sqrt(x), source);

      expect(result.value).toBe(4);
      expect(result.tags).toEqual([]);
    });
  });

  describe('unaryStringOp', () => {
    it('applies transformation and propagates tags', () => {
      const baseSource = buildString('');
      const source = buildString('hello', { ...baseSource, tags: ['user-input'] });

      const result = unaryStringOp(x => x.toUpperCase(), source);

      expect(result.value).toBe('HELLO');
      expect(result.tags).toEqual(['user-input']);
    });
  });

  describe('unaryBooleanOp', () => {
    it('applies transformation and propagates tags', () => {
      const baseSource = buildBoolean(false);
      const source = buildBoolean(true, { ...baseSource, tags: ['computed'] });

      const result = unaryBooleanOp(x => !x, source);

      expect(result.value).toBe(false);
      expect(result.tags).toEqual(['computed']);
    });
  });

  describe('convertValue', () => {
    it('converts between types and propagates tags', () => {
      const baseSource = buildNumber(0);
      const source = buildNumber(42, { ...baseSource, tags: ['random'] });

      const result = convertValue(
        (n: number) => String(n),
        source,
        buildString
      );

      expect(result.symbol).toBe('string');
      expect(result.value).toBe('42');
      expect(result.tags).toEqual(['random']);
    });

    it('converts string to number', () => {
      const baseSource = buildString('');
      const source = buildString('123', { ...baseSource, tags: ['network'] });

      const result = convertValue(
        (s: string) => parseInt(s),
        source,
        buildNumber
      );

      expect(result.symbol).toBe('number');
      expect(result.value).toBe(123);
      expect(result.tags).toEqual(['network']);
    });
  });

  describe('Effect propagation edge cases', () => {
    it('handles empty effect arrays', () => {
      const a = buildNumber(1);
      const b = buildNumber(2);

      const result = buildNumber(3, a, b);

      expect(result.tags).toEqual([]);
    });

    it('handles many sources with overlapping tags', () => {
      const base1 = buildNumber(0);
      const base2 = buildNumber(0);
      const base3 = buildNumber(0);
      const base4 = buildNumber(0);

      const sources: AnyValue[] = [
        buildNumber(1, { ...base1, tags: ['a', 'b'] }),
        buildNumber(2, { ...base2, tags: ['b', 'c'] }),
        buildNumber(3, { ...base3, tags: ['c', 'd'] }),
        buildNumber(4, { ...base4, tags: ['d', 'a'] }),
      ];

      const result = buildNumber(10, ...sources);

      expect(result.tags).toHaveLength(4);
      expect(result.tags).toContain('a');
      expect(result.tags).toContain('b');
      expect(result.tags).toContain('c');
      expect(result.tags).toContain('d');
    });
  });
});

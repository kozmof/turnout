import { expect, test, describe } from 'vitest';
import { isComparable } from './isComparable';

describe('Check comparable or not', () => {
  test('Symbol is string (with or without random tag)', () => {
    expect(isComparable({ symbol: 'string', value: 'test1', subSymbol: undefined, tags: [] }, { symbol: 'string', value: 'test2', subSymbol: undefined, tags: [] })).toBe(true);
    expect(isComparable({ symbol: 'string', value: 'test1', subSymbol: undefined, tags: [] }, { symbol: 'string', value: 'test2', subSymbol: undefined, tags: ['random'] })).toBe(true);
    expect(isComparable({ symbol: 'string', value: 'test1', subSymbol: undefined, tags: ['random'] }, { symbol: 'string', value: 'test2', subSymbol: undefined, tags: ['random'] })).toBe(true);
    expect(isComparable({ symbol: 'number', value: 100, subSymbol: undefined, tags: [] }, { symbol: 'string', value: 'test', subSymbol: undefined, tags: ['random'] })).toBe(false);
  });

  test('Symbol is number (with or without random tag)', () => {
    expect(isComparable({ symbol: 'number', value: 100, subSymbol: undefined, tags: [] }, { symbol: 'number', value: 200, subSymbol: undefined, tags: [] })).toBe(true);
    expect(isComparable({ symbol: 'number', value: 100, subSymbol: undefined, tags: [] }, { symbol: 'number', value: 200, subSymbol: undefined, tags: ['random'] })).toBe(true);
    expect(isComparable({ symbol: 'number', value: 100, subSymbol: undefined, tags: ['random'] }, { symbol: 'number', value: 200, subSymbol: undefined, tags: ['random'] })).toBe(true);
    expect(isComparable({ symbol: 'number', value: 100, subSymbol: undefined, tags: [] }, { symbol: 'string', value: 'test', subSymbol: undefined, tags: ['random'] })).toBe(false);
  });

  test('Symbol is boolean (with or without random tag)', () => {
    expect(isComparable({ symbol: 'boolean', value: true, subSymbol: undefined, tags: [] }, { symbol: 'boolean', value: false, subSymbol: undefined, tags: [] })).toBe(true);
    expect(isComparable({ symbol: 'boolean', value: false, subSymbol: undefined, tags: [] }, { symbol: 'boolean', value: false, subSymbol: undefined, tags: ['random'] })).toBe(true);
    expect(isComparable({ symbol: 'boolean', value: false, subSymbol: undefined, tags: ['random'] }, { symbol: 'boolean', value: false, subSymbol: undefined, tags: ['random'] })).toBe(true);
    expect(isComparable({ symbol: 'number', value: 100, subSymbol: undefined, tags: [] }, { symbol: 'boolean', value: true, subSymbol: undefined, tags: ['random'] })).toBe(false);
  });

  test('Symbol is array (with or without random tag)', () => {
    expect(isComparable(
      { symbol: 'array', value: [{ symbol: 'number', value: 100, subSymbol: undefined, tags: [] }], subSymbol: undefined, tags: [] },
      { symbol: 'array', value: [], subSymbol: undefined, tags: [] }
    )).toBe(true);
    expect(isComparable(
      { symbol: 'array', value: [{ symbol: 'number', value: 100, subSymbol: undefined, tags: [] }], subSymbol: undefined, tags: [] },
      { symbol: 'array', value: [{ symbol: 'string', value: 'test', subSymbol: undefined, tags: [] }], subSymbol: undefined, tags: ['random'] }
    )).toBe(true);
    expect(isComparable(
      { symbol: 'array', value: [{ symbol: 'number', value: 100, subSymbol: undefined, tags: [] }], subSymbol: undefined, tags: ['random'] },
      { symbol: 'array', value: [{ symbol: 'number', value: 200, subSymbol: undefined, tags: [] }], subSymbol: undefined, tags: ['random'] }
    )).toBe(true);
    expect(isComparable(
      { symbol: 'array', value: [{ symbol: 'number', value: 100, subSymbol: undefined, tags: [] }], subSymbol: undefined, tags: [] },
      { symbol: 'boolean', value: true, subSymbol: undefined, tags: ['random'] }
    )).toBe(false);
  });

  test('Symbol is null (with reason categories)', () => {
    expect(isComparable(
      { symbol: 'null', value: null, subSymbol: 'missing', tags: [] },
      { symbol: 'null', value: null, subSymbol: 'error', tags: ['random'] }
    )).toBe(true);
    expect(isComparable(
      { symbol: 'null', value: null, subSymbol: 'unknown', tags: [] },
      { symbol: 'number', value: 10, subSymbol: undefined, tags: [] }
    )).toBe(false);
  });
});

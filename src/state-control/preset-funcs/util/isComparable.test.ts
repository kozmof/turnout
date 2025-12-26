import { expect, test, describe } from 'vitest';
import { isComparable } from './isComparable';

describe('Check comparable or not', () => {
  test('Symbol is string (with or without random effect)', () => {
    expect(isComparable({ symbol: 'string', value: 'test1', subSymbol: undefined, effects: [] }, { symbol: 'string', value: 'test2', subSymbol: undefined, effects: [] })).toBe(true);
    expect(isComparable({ symbol: 'string', value: 'test1', subSymbol: undefined, effects: [] }, { symbol: 'string', value: 'test2', subSymbol: undefined, effects: ['random'] })).toBe(true);
    expect(isComparable({ symbol: 'string', value: 'test1', subSymbol: undefined, effects: ['random'] }, { symbol: 'string', value: 'test2', subSymbol: undefined, effects: ['random'] })).toBe(true);
    expect(isComparable({ symbol: 'number', value: 100, subSymbol: undefined, effects: [] }, { symbol: 'string', value: 'test', subSymbol: undefined, effects: ['random'] })).toBe(false);
  });

  test('Symbol is number (with or without random effect)', () => {
    expect(isComparable({ symbol: 'number', value: 100, subSymbol: undefined, effects: [] }, { symbol: 'number', value: 200, subSymbol: undefined, effects: [] })).toBe(true);
    expect(isComparable({ symbol: 'number', value: 100, subSymbol: undefined, effects: [] }, { symbol: 'number', value: 200, subSymbol: undefined, effects: ['random'] })).toBe(true);
    expect(isComparable({ symbol: 'number', value: 100, subSymbol: undefined, effects: ['random'] }, { symbol: 'number', value: 200, subSymbol: undefined, effects: ['random'] })).toBe(true);
    expect(isComparable({ symbol: 'number', value: 100, subSymbol: undefined, effects: [] }, { symbol: 'string', value: 'test', subSymbol: undefined, effects: ['random'] })).toBe(false);
  });

  test('Symbol is boolean (with or without random effect)', () => {
    expect(isComparable({ symbol: 'boolean', value: true, subSymbol: undefined, effects: [] }, { symbol: 'boolean', value: false, subSymbol: undefined, effects: [] })).toBe(true);
    expect(isComparable({ symbol: 'boolean', value: false, subSymbol: undefined, effects: [] }, { symbol: 'boolean', value: false, subSymbol: undefined, effects: ['random'] })).toBe(true);
    expect(isComparable({ symbol: 'boolean', value: false, subSymbol: undefined, effects: ['random'] }, { symbol: 'boolean', value: false, subSymbol: undefined, effects: ['random'] })).toBe(true);
    expect(isComparable({ symbol: 'number', value: 100, subSymbol: undefined, effects: [] }, { symbol: 'boolean', value: true, subSymbol: undefined, effects: ['random'] })).toBe(false);
  });

  test('Symbol is array (with or without random effect)', () => {
    expect(isComparable(
      { symbol: 'array', value: [{ symbol: 'number', value: 100, subSymbol: undefined, effects: [] }], subSymbol: undefined, effects: [] },
      { symbol: 'array', value: [], subSymbol: undefined, effects: [] }
    )).toBe(true);
    expect(isComparable(
      { symbol: 'array', value: [{ symbol: 'number', value: 100, subSymbol: undefined, effects: [] }], subSymbol: undefined, effects: [] },
      { symbol: 'array', value: [{ symbol: 'string', value: 'test', subSymbol: undefined, effects: [] }], subSymbol: undefined, effects: ['random'] }
    )).toBe(true);
    expect(isComparable(
      { symbol: 'array', value: [{ symbol: 'number', value: 100, subSymbol: undefined, effects: [] }], subSymbol: undefined, effects: ['random'] },
      { symbol: 'array', value: [{ symbol: 'number', value: 200, subSymbol: undefined, effects: [] }], subSymbol: undefined, effects: ['random'] }
    )).toBe(true);
    expect(isComparable(
      { symbol: 'array', value: [{ symbol: 'number', value: 100, subSymbol: undefined, effects: [] }], subSymbol: undefined, effects: [] },
      { symbol: 'boolean', value: true, subSymbol: undefined, effects: ['random'] }
    )).toBe(false);
  });
});

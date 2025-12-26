import { expect, test, describe } from 'vitest';
import { isArray, isBoolean, isNumber, isString, isPure, isPureNumber, isPureString, isPureBoolean, hasEffect } from './value';

describe('Check TypeGuard', () => {
  test('Symbol is number (pure)', () => {
    expect(isPureNumber({ symbol: 'number', value: 100, subSymbol: undefined, effects: [] })).toBe(true);
    expect(isPureNumber({ symbol: 'number', value: 100, subSymbol: undefined, effects: ['random'] })).toBe(false);
  });

  test('Symbol is number (with random effect)', () => {
    const randomNum = { symbol: 'number' as const, value: 100, subSymbol: undefined as undefined, effects: ['random'] as const };
    expect(isNumber(randomNum)).toBe(true);
    expect(hasEffect(randomNum, 'random')).toBe(true);
    expect(isPure(randomNum)).toBe(false);
  });

  test('Symbol is number (any effects)', () => {
    expect(isNumber({ symbol: 'number', value: 100, subSymbol: undefined, effects: ['random'] })).toBe(true);
    expect(isNumber({ symbol: 'number', value: 100, subSymbol: undefined, effects: [] })).toBe(true);
  });

  test('Symbol is string (pure)', () => {
    expect(isPureString({ symbol: 'string', value: 'test1', subSymbol: undefined, effects: [] })).toBe(true);
    expect(isPureString({ symbol: 'string', value: 'test2', subSymbol: undefined, effects: ['random'] })).toBe(false);
  });

  test('Symbol is string (with random effect)', () => {
    const randomStr = { symbol: 'string' as const, value: 'test', subSymbol: undefined as undefined, effects: ['random'] as const };
    expect(isString(randomStr)).toBe(true);
    expect(hasEffect(randomStr, 'random')).toBe(true);
  });

  test('Symbol is string (any effects)', () => {
    expect(isString({ symbol: 'string', value: 'test1', subSymbol: undefined, effects: ['random'] })).toBe(true);
    expect(isString({ symbol: 'string', value: 'test2', subSymbol: undefined, effects: [] })).toBe(true);
  });

  test('Symbol is boolean (pure)', () => {
    expect(isPureBoolean({ symbol: 'boolean', value: true, subSymbol: undefined, effects: [] })).toBe(true);
    expect(isPureBoolean({ symbol: 'boolean', value: false, subSymbol: undefined, effects: ['random'] })).toBe(false);
  });

  test('Symbol is boolean (with random effect)', () => {
    const randomBool = { symbol: 'boolean' as const, value: true, subSymbol: undefined as undefined, effects: ['random'] as const };
    expect(isBoolean(randomBool)).toBe(true);
    expect(hasEffect(randomBool, 'random')).toBe(true);
  });

  test('Symbol is boolean (any effects)', () => {
    expect(isBoolean({ symbol: 'boolean', value: true, subSymbol: undefined, effects: ['random'] })).toBe(true);
    expect(isBoolean({ symbol: 'boolean', value: false, subSymbol: undefined, effects: [] })).toBe(true);
  });

  test('Symbol is array (pure)', () => {
    expect(isArray({ symbol: 'array', value: [], subSymbol: undefined, effects: [] })).toBe(true);
    expect(isPure({ symbol: 'array', value: [], subSymbol: undefined, effects: [] })).toBe(true);
  });

  test('Symbol is array (with random effect)', () => {
    const randomArr = { symbol: 'array' as const, value: [], subSymbol: undefined as undefined, effects: ['random'] as const };
    expect(isArray(randomArr)).toBe(true);
    expect(hasEffect(randomArr, 'random')).toBe(true);
  });

  test('Symbol is array (any effects)', () => {
    expect(isArray({ symbol: 'array', value: [], subSymbol: undefined, effects: ['random'] })).toBe(true);
    expect(isArray({ symbol: 'array', value: [], subSymbol: undefined, effects: [] })).toBe(true);
  });

  test('Custom effects', () => {
    const cachedNum = { symbol: 'number' as const, value: 42, subSymbol: undefined as undefined, effects: ['cached'] as const };
    expect(isNumber(cachedNum)).toBe(true);
    expect(hasEffect(cachedNum, 'cached')).toBe(true);
    expect(hasEffect(cachedNum, 'random')).toBe(false);
    expect(isPure(cachedNum)).toBe(false);
  });

  test('Multiple effects', () => {
    const complexVal = {
      symbol: 'string' as const,
      value: 'test',
      subSymbol: undefined as undefined,
      effects: ['random', 'cached', 'async'] as const
    };
    expect(isString(complexVal)).toBe(true);
    expect(hasEffect(complexVal, 'random')).toBe(true);
    expect(hasEffect(complexVal, 'cached')).toBe(true);
    expect(hasEffect(complexVal, 'async')).toBe(true);
    expect(isPure(complexVal)).toBe(false);
  });

});

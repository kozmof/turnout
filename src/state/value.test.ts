import { expect, test, describe } from 'vitest';
import { isArray, isBoolean, isControlledArray, isControlledBoolean, isControlledNumber, isControlledString, isNumber, isRandomArray, isRandomBoolean, isRandomNumber, isRandomString, isString } from './value';

describe('Check TypeGuard', () => {
  test('Symbol is number', () => {
    expect(isControlledNumber({ symbol: 'number', value: 100, subSymbol: undefined })).toBe(true);
    expect(isControlledNumber({ symbol: 'random-number', value: 100, subSymbol: undefined })).toBe(false);
  });
  test('Symbol is random-number', () => {
    expect(isRandomNumber({ symbol: 'random-number', value: 100, subSymbol: undefined })).toBe(true);
    expect(isRandomNumber({ symbol: 'number', value: 100, subSymbol: undefined })).toBe(false);
  });
  test('Symbol is number or random-number', () => {
    expect(isNumber({ symbol: 'random-number', value: 100, subSymbol: undefined })).toBe(true);
    expect(isNumber({ symbol: 'number', value: 100, subSymbol: undefined })).toBe(true);
  });

  test('Symbol is string', () => {
    expect(isControlledString({ symbol: 'string', value: 'test1', subSymbol: undefined })).toBe(true);
    expect(isControlledString({ symbol: 'random-string', value: 'test2', subSymbol: undefined })).toBe(false);
  });
  test('Symbol is random-string', () => {
    expect(isRandomString({ symbol: 'random-string', value: 'test1', subSymbol: undefined })).toBe(true);
    expect(isRandomString({ symbol: 'string', value: 'test2', subSymbol: undefined })).toBe(false);
  });
  test('Symbol is string or random-string', () => {
    expect(isString({ symbol: 'random-string', value: 'test1', subSymbol: undefined })).toBe(true);
    expect(isString({ symbol: 'string', value: 'test2', subSymbol: undefined })).toBe(true);
  });

  test('Symbol is boolean', () => {
    expect(isControlledBoolean({ symbol: 'boolean', value: true, subSymbol: undefined })).toBe(true);
    expect(isControlledBoolean({ symbol: 'random-boolean', value: false, subSymbol: undefined })).toBe(false);
  });
  test('Symbol is random-boolean', () => {
    expect(isRandomBoolean({ symbol: 'random-boolean', value: true, subSymbol: undefined })).toBe(true);
    expect(isRandomBoolean({ symbol: 'boolean', value: false, subSymbol: undefined })).toBe(false);
  });
  test('Symbol is boolean or random-boolean', () => {
    expect(isBoolean({ symbol: 'random-boolean', value: true, subSymbol: undefined })).toBe(true);
    expect(isBoolean({ symbol: 'boolean', value: false, subSymbol: undefined })).toBe(true);
  });

  test('Symbol is array', () => {
    expect(isControlledArray({ symbol: 'array', value: [], subSymbol: undefined })).toBe(true);
    expect(isControlledArray({ symbol: 'random-array', value: [], subSymbol: undefined})).toBe(false);
  });
  test('Symbol is random-array', () => {
    expect(isRandomArray({ symbol: 'random-array', value: [], subSymbol: undefined})).toBe(true);
    expect(isRandomArray({ symbol: 'array', value: [], subSymbol: undefined })).toBe(false);
  });
  test('Symbol is array or random-array', () => {
    expect(isArray({ symbol: 'random-array', value: [], subSymbol: undefined})).toBe(true);
    expect(isArray({ symbol: 'array', value: [], subSymbol: undefined })).toBe(true);
  });

});

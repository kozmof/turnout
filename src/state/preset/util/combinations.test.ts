import { test, expect } from 'vitest';
import { generateCombinations } from './combinations';
import { type ReturnMetaBinaryFnNumber } from '../number/binaryFn';
import { type ReturnMetaBinaryFnArray } from '../array/binaryFn';

test('test number', () => {
  const input: { [K in keyof ReturnMetaBinaryFnNumber] : Array<ReturnMetaBinaryFnNumber[K]>} = {
    add: ['number'],
    minus: ['number'],
    multiply: ['number'],
    divide: ['number'],
  };

  const result: ReturnMetaBinaryFnNumber[] = generateCombinations(input);
  expect(result).toStrictEqual([{
    add: 'number',
    minus: 'number',
    multiply: 'number',
    divide: 'number'
  }]);
});

test('test array', () => {
  const input: { [K in keyof ReturnMetaBinaryFnArray] : Array<ReturnMetaBinaryFnArray[K]>} = {
    includes: ['boolean'],
    get: ['boolean', 'number', 'string']
  };
  const result: ReturnMetaBinaryFnArray[] = generateCombinations(input);
  expect(result).toStrictEqual([
    {
      includes: 'boolean',
      get: 'boolean'
    },
    {
      includes: 'boolean',
      get: 'number'
    },
    {
      includes: 'boolean',
      get: 'string'
    },
  ]);
});

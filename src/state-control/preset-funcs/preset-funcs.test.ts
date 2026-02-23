import { describe, expect, it } from 'vitest';
import { buildArray, buildBoolean, buildNumber, buildString } from '../value-builders';
import { bfArray } from './array/binaryFn';
import { tfArray } from './array/transformFn';
import { bfBoolean } from './boolean/binaryFn';
import { tfBoolean } from './boolean/transformFn';
import { bfGeneric } from './generic/binaryFn';
import { bfNumber } from './number/binaryFn';
import { tfNumber } from './number/transformFn';
import { bfString } from './string/binaryFn';
import { tfString } from './string/transformFn';

function expectTagsToContainAll(
  actual: readonly string[],
  expected: readonly string[]
): void {
  expect(actual).toHaveLength(expected.length);
  for (const tag of expected) {
    expect(actual).toContain(tag);
  }
}

describe('preset functions', () => {
  describe('number binary functions', () => {
    it('supports arithmetic essentials', () => {
      const a = buildNumber(10, ['left']);
      const b = buildNumber(3, ['right']);

      expect(bfNumber.mod(a, b).value).toBe(1);
      expect(bfNumber.max(a, b).value).toBe(10);
      expect(bfNumber.min(a, b).value).toBe(3);
    });

    it('supports comparison essentials with merged tags', () => {
      const a = buildNumber(10, ['left']);
      const b = buildNumber(3, ['right']);

      const gt = bfNumber.greaterThan(a, b);
      const gte = bfNumber.greaterThanOrEqual(a, b);
      const lt = bfNumber.lessThan(a, b);
      const lte = bfNumber.lessThanOrEqual(a, b);

      expect(gt.value).toBe(true);
      expect(gte.value).toBe(true);
      expect(lt.value).toBe(false);
      expect(lte.value).toBe(false);

      expectTagsToContainAll(gt.tags, ['left', 'right']);
    });
  });

  describe('boolean transform and binary functions', () => {
    it('supports boolean transforms', () => {
      const v = buildBoolean(true, ['source']);

      expect(tfBoolean.pass(v).value).toBe(true);
      expect(tfBoolean.not(v).value).toBe(false);
      expect(tfBoolean.toStr(v).value).toBe('true');
      expect(tfBoolean.not(v).tags).toEqual(['source']);
    });

    it('supports boolean binary operators with merged tags', () => {
      const a = buildBoolean(true, ['left']);
      const b = buildBoolean(false, ['right']);

      expect(bfBoolean.and(a, b).value).toBe(false);
      expect(bfBoolean.or(a, b).value).toBe(true);
      expect(bfBoolean.xor(a, b).value).toBe(true);

      expectTagsToContainAll(bfBoolean.or(a, b).tags, ['left', 'right']);
    });
  });

  describe('number transform functions', () => {
    it('supports unary number transforms', () => {
      const v = buildNumber(-2.6, ['source']);

      expect(tfNumber.abs(v).value).toBe(2.6);
      expect(tfNumber.floor(v).value).toBe(-3);
      expect(tfNumber.ceil(v).value).toBe(-2);
      expect(tfNumber.round(v).value).toBe(-3);
      expect(tfNumber.negate(v).value).toBe(2.6);
      expect(tfNumber.negate(v).tags).toEqual(['source']);
    });
  });

  describe('string transform and binary functions', () => {
    it('supports essential string transforms', () => {
      const v = buildString('  HelLo  ', ['source']);

      expect(tfString.trim(v).value).toBe('HelLo');
      expect(tfString.toLowerCase(v).value).toBe('  hello  ');
      expect(tfString.toUpperCase(v).value).toBe('  HELLO  ');
      expect(tfString.length(v).value).toBe(9);
      expect(tfString.length(v).tags).toEqual(['source']);
    });

    it('supports essential string binary predicates', () => {
      const a = buildString('turnout-engine', ['left']);
      const b = buildString('turn', ['right']);

      const includes = bfString.includes(a, b);
      const startsWith = bfString.startsWith(a, b);
      const endsWith = bfString.endsWith(a, buildString('engine'));

      expect(includes.value).toBe(true);
      expect(startsWith.value).toBe(true);
      expect(endsWith.value).toBe(true);
      expectTagsToContainAll(includes.tags, ['left', 'right']);
    });
  });

  describe('array transform and binary functions', () => {
    it('supports array emptiness and concat', () => {
      const arrA = buildArray([buildNumber(1), buildString('x')], ['arr-a']);
      const arrB = buildArray([buildNumber(2)], ['arr-b']);

      const isEmptyA = tfArray.isEmpty(arrA);
      const isEmptyB = tfArray.isEmpty(buildArray([], ['arr-empty']));
      const concat = bfArray.concat(arrA, arrB);

      expect(isEmptyA.value).toBe(false);
      expect(isEmptyB.value).toBe(true);
      expect(concat.value).toHaveLength(3);
      expectTagsToContainAll(concat.tags, ['arr-a', 'arr-b']);
    });

    it('keeps get tag propagation behavior', () => {
      const item = buildString('value', ['item']);
      const arr = buildArray([item], ['array']);
      const idx = buildNumber(0, ['index']);

      const got = bfArray.get(arr, idx);
      expect(got.value).toBe('value');
      expectTagsToContainAll(got.tags, ['item', 'array', 'index']);
    });
  });

  describe('generic binary functions', () => {
    it('supports isNotEqual with merged tags', () => {
      const a = buildNumber(1, ['left']);
      const b = buildNumber(2, ['right']);

      const result = bfGeneric.isNotEqual(a, b);
      expect(result.value).toBe(true);
      expectTagsToContainAll(result.tags, ['left', 'right']);
    });
  });
});

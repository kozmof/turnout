import { describe, it, expect } from 'vitest';
import { ctx } from './context';
import { combine, pipe, cond } from './functions';
import { val, ref } from './values';
import { executeGraph } from '../runtime/exec/executeGraph';
import { assertValidContext } from '../runtime/validateContext';

describe('Context Builder', () => {
  describe('Simple values', () => {
    it('should create context with number literals', () => {
      const context = ctx({
        v1: 5,
        v2: 3,
      });

      expect(context.exec.valueTable).toHaveProperty('v1');
      expect(context.exec.valueTable).toHaveProperty('v2');
      expect((context.exec.valueTable as any).v1.value).toBe(5);
      expect((context.exec.valueTable as any).v2.value).toBe(3);
    });

    it('should create context with string literals', () => {
      const context = ctx({
        v1: 'hello',
        v2: 'world',
      });

      expect((context.exec.valueTable as any).v1.symbol).toBe('string');
      expect((context.exec.valueTable as any).v1.value).toBe('hello');
    });

    it('should create context with boolean literals', () => {
      const context = ctx({
        v1: true,
        v2: false,
      });

      expect((context.exec.valueTable as any).v1.symbol).toBe('boolean');
      expect((context.exec.valueTable as any).v1.value).toBe(true);
    });
  });

  describe('Explicit value builders', () => {
    it('should create tagged values', () => {
      const context = ctx({
        v1: val.number(42, ['random']),
        v2: val.string('hello', ['network']),
      });

      expect((context.exec.valueTable as any).v1.tags).toContain('random');
      expect((context.exec.valueTable as any).v2.tags).toContain('network');
    });

    it('should create array values', () => {
      const context = ctx({
        item1: 1,
        item2: 2,
        arr: val.array('number', [
          val.number(1),
          val.number(2),
        ]),
      });

      expect((context.exec.valueTable as any).arr.symbol).toBe('array');
      expect((context.exec.valueTable as any).arr.subSymbol).toBe('number');
    });
  });

  describe('CombineFunc builder', () => {
    it('should create simple combine function', () => {
      const context = ctx({
        v1: 5,
        v2: 3,
        f1: combine('binaryFnNumber::add', { a: 'v1', b: 'v2' }),
      });

      expect(context.exec.funcTable).toHaveProperty('f1');
      // returnId should be a hash-based ID with v_ prefix and 16 hex chars
      expect((context.exec.funcTable as any).f1.returnId).toMatch(/^v_[a-f0-9]{16}$/);
    });

    it('should execute combine function', () => {
      const context = ctx({
        v1: 10,
        v2: 5,
        f1: combine('binaryFnNumber::add', { a: 'v1', b: 'v2' }),
      });

      const result = executeGraph(context.ids.f1, assertValidContext(context.exec));

      expect(result.value.value).toBe(15);
      expect(result.value.symbol).toBe('number');
    });

    it('should handle chained functions', () => {
      const context = ctx({
        v1: 10,
        v2: 5,
        v3: 2,
        f1: combine('binaryFnNumber::add', { a: 'v1', b: 'v2' }),
        f2: combine('binaryFnNumber::multiply', { a: ref.output('f1'), b: 'v3' }),
      });

      const result = executeGraph(context.ids.f2, assertValidContext(context.exec));

      // (10 + 5) * 2 = 30
      expect(result.value.value).toBe(30);
    });
  });

  describe('Transform references', () => {
    it('should apply transform to value', () => {
      const context = ctx({
        v1: 42,
        v2: ' is the answer',
        f1: combine('binaryFnString::concat', {
          a: ref.transform('v1', 'transformFnNumber::toStr'),
          b: 'v2',
        }),
      });

      const result = executeGraph(context.ids.f1, assertValidContext(context.exec));

      expect(result.value.symbol).toBe('string');
      expect(result.value.value).toBe('42 is the answer');
    });
  });

  describe('Typed IDs', () => {
    it('should provide typed ID access', () => {
      const context = ctx({
        v1: 5,
        f1: combine('binaryFnNumber::add', { a: 'v1', b: 'v1' }),
      });

      // IDs should be accessible via ids property
      expect(context.ids.v1).toBe('v1');
      expect(context.ids.f1).toBe('f1');
    });
  });

  describe('Complex graphs', () => {
    it('should build nested computation graph', () => {
      const context = ctx({
        x: 3,
        y: 4,
        z: 5,

        // x + y
        sum: combine('binaryFnNumber::add', { a: 'x', b: 'y' }),

        // (x + y) * z
        product: combine('binaryFnNumber::multiply', {
          a: ref.output('sum'),
          b: 'z',
        }),

        // ((x + y) * z) - x
        final: combine('binaryFnNumber::minus', {
          a: ref.output('product'),
          b: 'x',
        }),
      });

      const result = executeGraph(context.ids.final, assertValidContext(context.exec));

      // ((3 + 4) * 5) - 3 = 35 - 3 = 32
      expect(result.value.value).toBe(32);
    });
  });

  describe('PipeFunc builder', () => {
    it('should create and execute simple pipe function', () => {
      const context = ctx({
        v1: 10,
        v2: 5,
        v3: 2,

        // PipeFunc: (a + b) * c
        pipeFn: pipe(
          { a: 'v1', b: 'v2', c: 'v3' },
          [
            combine('binaryFnNumber::add', { a: 'a', b: 'b' }),
            combine('binaryFnNumber::multiply', { a: ref.step('pipeFn', 0), b: 'c' }),
          ]
        ),
      });

      const result = executeGraph(context.ids.pipeFn, assertValidContext(context.exec));

      // (10 + 5) * 2 = 30
      expect(result.value.value).toBe(30);
      expect(result.value.symbol).toBe('number');
    });

    it('should create pipe function with multiple steps', () => {
      const context = ctx({
        x: 3,
        y: 4,
        z: 5,

        // PipeFunc: ((a + b) * c) - a
        compute: pipe(
          { a: 'x', b: 'y', c: 'z' },
          [
            combine('binaryFnNumber::add', { a: 'a', b: 'b' }),
            combine('binaryFnNumber::multiply', { a: ref.step('compute', 0), b: 'c' }),
            combine('binaryFnNumber::minus', { a: ref.step('compute', 1), b: 'a' }),
          ]
        ),
      });

      const result = executeGraph(context.ids.compute, assertValidContext(context.exec));

      // ((3 + 4) * 5) - 3 = 35 - 3 = 32
      expect(result.value.value).toBe(32);
    });

    it('should handle pipe function with string operations', () => {
      const context = ctx({
        str1: 'hello',
        str2: ' world',

        concat: pipe(
          { a: 'str1', b: 'str2' },
          [
            combine('binaryFnString::concat', { a: 'a', b: 'b' }),
          ]
        ),
      });

      const result = executeGraph(context.ids.concat, assertValidContext(context.exec));

      expect(result.value.value).toBe('hello world');
      expect(result.value.symbol).toBe('string');
    });

    it('should reject undefined funcOutput references inside pipe steps', () => {
      expect(() =>
        ctx({
          v1: 10,
          pipeFn: pipe(
            { a: 'v1' },
            [
              combine('binaryFnNumber::add', {
                a: ref.output('missingFunc'),
                b: 'a',
              }),
            ]
          ),
        })
      ).toThrow("Pipe function 'pipeFn' step 0 argument 'a' references undefined: 'missingFunc'");
    });
  });

  describe('CondFunc builder', () => {
    it('should create and execute cond function with true branch', () => {
      const context = ctx({
        condition: true,
        v1: 10,
        v2: 20,
        v0: 0,

        // True branch: returns v1 + 0 = 10
        trueFunc: combine('binaryFnNumber::add', { a: 'v1', b: 'v0' }),

        // False branch: returns v2 + 0 = 20
        falseFunc: combine('binaryFnNumber::add', { a: 'v2', b: 'v0' }),

        // Conditional
        result: cond('condition', { then: 'trueFunc', else: 'falseFunc' }),
      });

      const result = executeGraph(context.ids.result, assertValidContext(context.exec));

      expect(result.value.value).toBe(10);
      expect(result.value.symbol).toBe('number');
    });

    it('should create and execute cond function with false branch', () => {
      const context = ctx({
        condition: false,
        v1: 10,
        v2: 20,
        v0: 0,

        trueFunc: combine('binaryFnNumber::add', { a: 'v1', b: 'v0' }),
        falseFunc: combine('binaryFnNumber::add', { a: 'v2', b: 'v0' }),

        result: cond('condition', { then: 'trueFunc', else: 'falseFunc' }),
      });

      const result = executeGraph(context.ids.result, assertValidContext(context.exec));

      expect(result.value.value).toBe(20);
    });

    it('should execute cond with computed condition', () => {
      const context = ctx({
        v1: 5,
        v2: 5,
        v3: 100,
        v4: 200,
        v0: 0,

        // Compute condition: v1 == v2 (true)
        isEqual: combine('binaryFnGeneric::isEqual', { a: 'v1', b: 'v2' }),

        trueFunc: combine('binaryFnNumber::add', { a: 'v3', b: 'v0' }),
        falseFunc: combine('binaryFnNumber::add', { a: 'v4', b: 'v0' }),

        result: cond('isEqual', { then: 'trueFunc', else: 'falseFunc' }),
      });

      const result = executeGraph(context.ids.result, assertValidContext(context.exec));

      // 5 == 5 is true, so should return 100
      expect(result.value.value).toBe(100);
    });

    it('should execute cond with both branches sharing dependencies', () => {
      const context = ctx({
        condition: true,
        shared: 42,
        v0: 0,

        // Both branches use the same 'shared' value
        trueFunc: combine('binaryFnNumber::add', { a: 'shared', b: 'v0' }),
        falseFunc: combine('binaryFnNumber::add', { a: 'shared', b: 'v0' }),

        result: cond('condition', { then: 'trueFunc', else: 'falseFunc' }),
      });

      const result = executeGraph(context.ids.result, assertValidContext(context.exec));

      expect(result.value.value).toBe(42);
    });

    it('should handle nested cond functions', () => {
      const context = ctx({
        outerCondition: true,
        innerCondition: false,
        v1: 1,
        v2: 2,
        v3: 3,
        v4: 4,
        v0: 0,

        // Inner true branch
        innerTrue: combine('binaryFnNumber::add', { a: 'v1', b: 'v0' }),
        // Inner false branch
        innerFalse: combine('binaryFnNumber::add', { a: 'v2', b: 'v0' }),
        // Inner cond
        innerCond: cond('innerCondition', { then: 'innerTrue', else: 'innerFalse' }),

        // Outer false branch
        outerFalse: combine('binaryFnNumber::add', { a: 'v3', b: 'v0' }),

        // Outer cond
        result: cond('outerCondition', { then: 'innerCond', else: 'outerFalse' }),
      });

      const result = executeGraph(context.ids.result, assertValidContext(context.exec));

      // outerCondition is true -> go to innerCond
      // innerCondition is false -> go to innerFalse (v2 = 2)
      expect(result.value.value).toBe(2);
    });
  });

  describe('Mixed function types', () => {
    it('should combine combine, pipe, and cond in one graph', () => {
      const context = ctx({
        x: 10,
        y: 5,
        condition: true,

        // Simple combine
        sum: combine('binaryFnNumber::add', { a: 'x', b: 'y' }),

        // Pipe function
        compute: pipe(
          { a: 'x', b: 'y' },
          [
            combine('binaryFnNumber::multiply', { a: 'a', b: 'b' }),
          ]
        ),

        // Cond that uses both
        v0: 0,
        trueFunc: combine('binaryFnNumber::add', { a: ref.output('sum'), b: 'v0' }),
        falseFunc: combine('binaryFnNumber::add', { a: 'x', b: 'v0' }),

        result: cond('condition', { then: 'trueFunc', else: 'falseFunc' }),
      });

      const result = executeGraph(context.ids.result, assertValidContext(context.exec));

      // condition is true, so returns sum (10 + 5 = 15)
      expect(result.value.value).toBe(15);
    });
  });
});

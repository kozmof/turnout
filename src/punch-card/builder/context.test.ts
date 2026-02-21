import { describe, it, expect } from 'vitest';
import { ctx } from './context';
import { plug, tap, cond } from './functions';
import { val, ref } from './values';
import { executeGraph } from '../runtime/exec/executeGraph';

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
    it('should create simple plug function', () => {
      const context = ctx({
        v1: 5,
        v2: 3,
        f1: plug('binaryFnNumber::add', { a: 'v1', b: 'v2' }),
      });

      expect(context.exec.funcTable).toHaveProperty('f1');
      // returnId should be a hash-based ID with v_ prefix
      expect((context.exec.funcTable as any).f1.returnId).toMatch(/^v_[a-f0-9]{8}$/);
    });

    it('should execute plug function', () => {
      const context = ctx({
        v1: 10,
        v2: 5,
        f1: plug('binaryFnNumber::add', { a: 'v1', b: 'v2' }),
      });

      const result = executeGraph(context.ids.f1, context.exec);

      expect(result.value.value).toBe(15);
      expect(result.value.symbol).toBe('number');
    });

    it('should handle chained functions', () => {
      const context = ctx({
        v1: 10,
        v2: 5,
        v3: 2,
        f1: plug('binaryFnNumber::add', { a: 'v1', b: 'v2' }),
        f2: plug('binaryFnNumber::multiply', { a: ref.output('f1'), b: 'v3' }),
      });

      const result = executeGraph(context.ids.f2, context.exec);

      // (10 + 5) * 2 = 30
      expect(result.value.value).toBe(30);
    });
  });

  describe('Transform references', () => {
    it('should apply transform to value', () => {
      const context = ctx({
        v1: 42,
        v2: ' is the answer',
        f1: plug('binaryFnString::concat', {
          a: ref.transform('v1', 'transformFnNumber::toStr'),
          b: 'v2',
        }),
      });

      const result = executeGraph(context.ids.f1, context.exec);

      expect(result.value.symbol).toBe('string');
      expect(result.value.value).toBe('42 is the answer');
    });
  });

  describe('Typed IDs', () => {
    it('should provide typed ID access', () => {
      const context = ctx({
        v1: 5,
        f1: plug('binaryFnNumber::add', { a: 'v1', b: 'v1' }),
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
        sum: plug('binaryFnNumber::add', { a: 'x', b: 'y' }),

        // (x + y) * z
        product: plug('binaryFnNumber::multiply', {
          a: ref.output('sum'),
          b: 'z',
        }),

        // ((x + y) * z) - x
        final: plug('binaryFnNumber::minus', {
          a: ref.output('product'),
          b: 'x',
        }),
      });

      const result = executeGraph(context.ids.final, context.exec);

      // ((3 + 4) * 5) - 3 = 35 - 3 = 32
      expect(result.value.value).toBe(32);
    });
  });

  describe('PipeFunc builder', () => {
    it('should create and execute simple tap function', () => {
      const context = ctx({
        v1: 10,
        v2: 5,
        v3: 2,

        // PipeFunc: (a + b) * c
        tapFn: tap(
          { a: 'v1', b: 'v2', c: 'v3' },
          [
            plug('binaryFnNumber::add', { a: 'a', b: 'b' }),
            plug('binaryFnNumber::multiply', { a: ref.step('tapFn', 0), b: 'c' }),
          ]
        ),
      });

      const result = executeGraph(context.ids.tapFn, context.exec);

      // (10 + 5) * 2 = 30
      expect(result.value.value).toBe(30);
      expect(result.value.symbol).toBe('number');
    });

    it('should create tap function with multiple steps', () => {
      const context = ctx({
        x: 3,
        y: 4,
        z: 5,

        // PipeFunc: ((a + b) * c) - a
        compute: tap(
          { a: 'x', b: 'y', c: 'z' },
          [
            plug('binaryFnNumber::add', { a: 'a', b: 'b' }),
            plug('binaryFnNumber::multiply', { a: ref.step('compute', 0), b: 'c' }),
            plug('binaryFnNumber::minus', { a: ref.step('compute', 1), b: 'a' }),
          ]
        ),
      });

      const result = executeGraph(context.ids.compute, context.exec);

      // ((3 + 4) * 5) - 3 = 35 - 3 = 32
      expect(result.value.value).toBe(32);
    });

    it('should handle tap function with string operations', () => {
      const context = ctx({
        str1: 'hello',
        str2: ' world',

        concat: tap(
          { a: 'str1', b: 'str2' },
          [
            plug('binaryFnString::concat', { a: 'a', b: 'b' }),
          ]
        ),
      });

      const result = executeGraph(context.ids.concat, context.exec);

      expect(result.value.value).toBe('hello world');
      expect(result.value.symbol).toBe('string');
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
        trueFunc: plug('binaryFnNumber::add', { a: 'v1', b: 'v0' }),

        // False branch: returns v2 + 0 = 20
        falseFunc: plug('binaryFnNumber::add', { a: 'v2', b: 'v0' }),

        // Conditional
        result: cond('condition', { then: 'trueFunc', else: 'falseFunc' }),
      });

      const result = executeGraph(context.ids.result, context.exec);

      expect(result.value.value).toBe(10);
      expect(result.value.symbol).toBe('number');
    });

    it('should create and execute cond function with false branch', () => {
      const context = ctx({
        condition: false,
        v1: 10,
        v2: 20,
        v0: 0,

        trueFunc: plug('binaryFnNumber::add', { a: 'v1', b: 'v0' }),
        falseFunc: plug('binaryFnNumber::add', { a: 'v2', b: 'v0' }),

        result: cond('condition', { then: 'trueFunc', else: 'falseFunc' }),
      });

      const result = executeGraph(context.ids.result, context.exec);

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
        isEqual: plug('binaryFnGeneric::isEqual', { a: 'v1', b: 'v2' }),

        trueFunc: plug('binaryFnNumber::add', { a: 'v3', b: 'v0' }),
        falseFunc: plug('binaryFnNumber::add', { a: 'v4', b: 'v0' }),

        result: cond('isEqual', { then: 'trueFunc', else: 'falseFunc' }),
      });

      const result = executeGraph(context.ids.result, context.exec);

      // 5 == 5 is true, so should return 100
      expect(result.value.value).toBe(100);
    });

    it('should execute cond with both branches sharing dependencies', () => {
      const context = ctx({
        condition: true,
        shared: 42,
        v0: 0,

        // Both branches use the same 'shared' value
        trueFunc: plug('binaryFnNumber::add', { a: 'shared', b: 'v0' }),
        falseFunc: plug('binaryFnNumber::add', { a: 'shared', b: 'v0' }),

        result: cond('condition', { then: 'trueFunc', else: 'falseFunc' }),
      });

      const result = executeGraph(context.ids.result, context.exec);

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
        innerTrue: plug('binaryFnNumber::add', { a: 'v1', b: 'v0' }),
        // Inner false branch
        innerFalse: plug('binaryFnNumber::add', { a: 'v2', b: 'v0' }),
        // Inner cond
        innerCond: cond('innerCondition', { then: 'innerTrue', else: 'innerFalse' }),

        // Outer false branch
        outerFalse: plug('binaryFnNumber::add', { a: 'v3', b: 'v0' }),

        // Outer cond
        result: cond('outerCondition', { then: 'innerCond', else: 'outerFalse' }),
      });

      const result = executeGraph(context.ids.result, context.exec);

      // outerCondition is true -> go to innerCond
      // innerCondition is false -> go to innerFalse (v2 = 2)
      expect(result.value.value).toBe(2);
    });
  });

  describe('Mixed function types', () => {
    it('should combine plug, tap, and cond in one graph', () => {
      const context = ctx({
        x: 10,
        y: 5,
        condition: true,

        // Simple plug
        sum: plug('binaryFnNumber::add', { a: 'x', b: 'y' }),

        // Tap function
        compute: tap(
          { a: 'x', b: 'y' },
          [
            plug('binaryFnNumber::multiply', { a: 'a', b: 'b' }),
          ]
        ),

        // Cond that uses both
        v0: 0,
        trueFunc: plug('binaryFnNumber::add', { a: ref.output('sum'), b: 'v0' }),
        falseFunc: plug('binaryFnNumber::add', { a: 'x', b: 'v0' }),

        result: cond('condition', { then: 'trueFunc', else: 'falseFunc' }),
      });

      const result = executeGraph(context.ids.result, context.exec);

      // condition is true, so returns sum (10 + 5 = 15)
      expect(result.value.value).toBe(15);
    });
  });
});

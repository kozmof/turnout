import { describe, it, expect } from 'vitest';
import {
  buildContextFromProg,
  type BuiltContext,
} from '../src/executor/hcl-context-builder.js';
import {
  executeGraph,
  assertValidContext,
  buildNumber,
  buildString,
  buildBoolean,
  isPureNumber,
  isPureBoolean,
  isPureString,
} from 'runtime';
import type { ProgModel } from '../src/types/scene-model.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function runProg(ctx: BuiltContext, rootName: string) {
  const rootId = ctx.nameToValueId[rootName];
  const validated = assertValidContext(ctx.exec);
  return executeGraph(rootId, validated);
}

// ─────────────────────────────────────────────────────────────────────────────
// Value bindings
// ─────────────────────────────────────────────────────────────────────────────

describe('buildContextFromProg — value bindings', () => {
  const prog: ProgModel = {
    name: 'test_prog',
    bindings: [
      { name: 'x', type: 'number', value: 10 },
    ],
  };

  it('uses the literal default when no injection is provided', () => {
    const ctx = buildContextFromProg(prog, {});
    expect(ctx.nameToValueId['x']).toBeDefined();
    const result = runProg(ctx, 'x');
    const val = result.updatedValueTable[ctx.nameToValueId['x']];
    expect(isPureNumber(val!) && val.value).toBe(10);
  });

  it('injected value overrides the literal default', () => {
    const ctx = buildContextFromProg(prog, { x: buildNumber(99) });
    const result = runProg(ctx, 'x');
    const val = result.updatedValueTable[ctx.nameToValueId['x']];
    expect(isPureNumber(val!) && val.value).toBe(99);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Combine expressions
// ─────────────────────────────────────────────────────────────────────────────

describe('buildContextFromProg — combine expr', () => {
  const prog: ProgModel = {
    name: 'add_prog',
    bindings: [
      { name: 'a', type: 'number', value: 3 },
      { name: 'b', type: 'number', value: 4 },
      {
        name: 'sum',
        type: 'number',
        expr: { combine: { fn: 'add', args: [{ ref: 'a' }, { ref: 'b' }] } },
      },
    ],
  };

  it('computes a + b correctly', () => {
    const ctx = buildContextFromProg(prog, {});
    const result = runProg(ctx, 'sum');
    const val = result.updatedValueTable[ctx.nameToValueId['sum']];
    expect(isPureNumber(val!) && val.value).toBe(7);
  });

  it('nameToValueId contains entry for the combine binding', () => {
    const ctx = buildContextFromProg(prog, {});
    expect(ctx.nameToValueId['sum']).toBeDefined();
  });

  it('injected value overrides input binding', () => {
    const ctx = buildContextFromProg(prog, { a: buildNumber(10) });
    const result = runProg(ctx, 'sum');
    const val = result.updatedValueTable[ctx.nameToValueId['sum']];
    expect(isPureNumber(val!) && val.value).toBe(14);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Boolean combine
// ─────────────────────────────────────────────────────────────────────────────

describe('buildContextFromProg — boolean combine', () => {
  const prog: ProgModel = {
    name: 'bool_prog',
    bindings: [
      { name: 'p', type: 'bool', value: true },
      { name: 'q', type: 'bool', value: false },
      {
        name: 'p_and_q',
        type: 'bool',
        expr: { combine: { fn: 'bool_and', args: [{ ref: 'p' }, { ref: 'q' }] } },
      },
    ],
  };

  it('bool_and works correctly', () => {
    const ctx = buildContextFromProg(prog, {});
    const result = runProg(ctx, 'p_and_q');
    const val = result.updatedValueTable[ctx.nameToValueId['p_and_q']];
    expect(isPureBoolean(val!) && val.value).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cond expressions
// ─────────────────────────────────────────────────────────────────────────────

describe('buildContextFromProg — cond expr', () => {
  const prog: ProgModel = {
    name: 'cond_prog',
    bindings: [
      { name: 'flag', type: 'bool', value: true },
      { name: 'x', type: 'number', value: 1 },
      { name: 'y', type: 'number', value: 2 },
      {
        name: 'pass_x',
        type: 'number',
        expr: { combine: { fn: 'add', args: [{ ref: 'x' }, { lit: 0 }] } },
      },
      {
        name: 'pass_y',
        type: 'number',
        expr: { combine: { fn: 'add', args: [{ ref: 'y' }, { lit: 0 }] } },
      },
      {
        name: 'result',
        type: 'number',
        expr: {
          cond: {
            condition: { ref: 'flag' },
            then: { func_ref: 'pass_x' },
            else: { func_ref: 'pass_y' },
          },
        },
      },
    ],
  };

  it('cond returns then-branch when condition is true', () => {
    const ctx = buildContextFromProg(prog, {});
    const result = runProg(ctx, 'result');
    const val = result.updatedValueTable[ctx.nameToValueId['result']];
    expect(isPureNumber(val!) && val.value).toBe(1);
  });

  it('cond returns else-branch when condition is false', () => {
    const ctx = buildContextFromProg(prog, { flag: buildBoolean(false) });
    const result = runProg(ctx, 'result');
    const val = result.updatedValueTable[ctx.nameToValueId['result']];
    expect(isPureNumber(val!) && val.value).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Literal args
// ─────────────────────────────────────────────────────────────────────────────

describe('buildContextFromProg — lit args', () => {
  const prog: ProgModel = {
    name: 'lit_prog',
    bindings: [
      { name: 'x', type: 'number', value: 5 },
      {
        name: 'result',
        type: 'number',
        expr: { combine: { fn: 'add', args: [{ ref: 'x' }, { lit: 10 }] } },
      },
    ],
  };

  it('inline literal arg is resolved as a synthetic value', () => {
    const ctx = buildContextFromProg(prog, {});
    const result = runProg(ctx, 'result');
    const val = result.updatedValueTable[ctx.nameToValueId['result']];
    expect(isPureNumber(val!) && val.value).toBe(15);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// nameToValueId completeness
// ─────────────────────────────────────────────────────────────────────────────

describe('buildContextFromProg — nameToValueId', () => {
  const prog: ProgModel = {
    name: 'full_prog',
    bindings: [
      { name: 'v1', type: 'number', value: 1 },
      { name: 'v2', type: 'number', value: 2 },
      {
        name: 'f1',
        type: 'number',
        expr: { combine: { fn: 'add', args: [{ ref: 'v1' }, { ref: 'v2' }] } },
      },
    ],
  };

  it('nameToValueId contains entries for all bindings', () => {
    const ctx = buildContextFromProg(prog, {});
    expect(ctx.nameToValueId['v1']).toBeDefined();
    expect(ctx.nameToValueId['v2']).toBeDefined();
    expect(ctx.nameToValueId['f1']).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error cases
// ─────────────────────────────────────────────────────────────────────────────

describe('buildContextFromProg — errors', () => {
  it('throws a descriptive error for an unknown HCL function name', () => {
    const prog: ProgModel = {
      name: 'err_prog',
      bindings: [
        { name: 'x', type: 'number', value: 1 },
        { name: 'y', type: 'number', value: 2 },
        {
          name: 'z',
          type: 'number',
          expr: { combine: { fn: 'unknown_fn', args: [{ ref: 'x' }, { ref: 'y' }] } },
        },
      ],
    };
    expect(() => buildContextFromProg(prog, {})).toThrow('Unknown HCL function name');
  });
});

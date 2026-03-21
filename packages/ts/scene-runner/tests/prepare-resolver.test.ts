import { describe, it, expect, vi } from 'vitest';
import {
  resolveActionPrepare,
  resolveNextPrepare,
} from '../src/executor/prepare-resolver.js';
import { StateManager } from '../src/state/state-manager.js';
import {
  buildNumber,
  buildString,
  buildBoolean,
  buildNull,
  isPureNumber,
  isPureString,
  isPureBoolean,
  isPureNull,
  isArray,
} from 'runtime';
import type { ActionExecutionResult } from '../src/executor/types.js';
import type { HookRegistry } from '../src/types/harness-types.js';

// ─────────────────────────────────────────────────────────────────────────────
// resolveActionPrepare
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveActionPrepare', () => {
  it('from_state reads the value from StateManager', () => {
    const state = StateManager.from({ 'request.query': buildString('hello') });
    const result = resolveActionPrepare(
      [{ binding: 'query', from_state: 'request.query' }],
      state,
      {},
    );
    expect(isPureString(result['query']!) && result['query'].value).toBe('hello');
  });

  it('from_state returns buildNull("missing") when path is not in state', () => {
    const state = StateManager.from({});
    const result = resolveActionPrepare(
      [{ binding: 'missing_val', from_state: 'no.such.path' }],
      state,
      {},
    );
    const val = result['missing_val'];
    expect(isPureNull(val!)).toBe(true);
  });

  it('from_hook calls the hook and extracts the binding field', () => {
    const state = StateManager.from({});
    const hooks: HookRegistry = {
      my_hook: (_ctx) => ({ foo: buildNumber(42) }),
    };
    const result = resolveActionPrepare(
      [{ binding: 'foo', from_hook: 'my_hook' }],
      state,
      hooks,
    );
    expect(isPureNumber(result['foo']!) && result['foo'].value).toBe(42);
  });

  it('from_hook passes a readState function to the hook', () => {
    const state = StateManager.from({ 'a.x': buildNumber(7) });
    let capturedValue: unknown;
    const hooks: HookRegistry = {
      my_hook: (ctx) => {
        capturedValue = ctx.readState('a.x');
        return { bar: buildString('from_hook') };
      },
    };
    resolveActionPrepare([{ binding: 'bar', from_hook: 'my_hook' }], state, hooks);
    expect(isPureNumber(capturedValue as never) && (capturedValue as { value: number }).value).toBe(7);
  });

  it('from_hook returns buildNull("missing") if the hook is not registered', () => {
    const state = StateManager.from({});
    const result = resolveActionPrepare(
      [{ binding: 'foo', from_hook: 'nonexistent_hook' }],
      state,
      {},
    );
    expect(isPureNull(result['foo']!)).toBe(true);
  });

  it('resolves multiple entries independently', () => {
    const state = StateManager.from({
      'a.x': buildNumber(1),
      'b.y': buildString('two'),
    });
    const result = resolveActionPrepare(
      [
        { binding: 'x_val', from_state: 'a.x' },
        { binding: 'y_val', from_state: 'b.y' },
      ],
      state,
      {},
    );
    expect(isPureNumber(result['x_val']!) && result['x_val'].value).toBe(1);
    expect(isPureString(result['y_val']!) && result['y_val'].value).toBe('two');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveNextPrepare
// ─────────────────────────────────────────────────────────────────────────────

function makePrevResult(bindingValues: Record<string, import('runtime').AnyValue>): ActionExecutionResult {
  return {
    actionId: 'prev_action',
    computeRootValue: buildNull('unknown'),
    bindingValues,
    stateAfterMerge: StateManager.from({}),
  };
}

describe('resolveNextPrepare', () => {
  it('from_action reads from prevResult.bindingValues', () => {
    const state = StateManager.from({});
    const prevResult = makePrevResult({ score: buildNumber(99) });
    const result = resolveNextPrepare(
      [{ binding: 'score', from_action: 'score' }],
      state,
      prevResult,
    );
    expect(isPureNumber(result['score']!) && result['score'].value).toBe(99);
  });

  it('from_action returns buildNull("missing") when binding is absent in prevResult', () => {
    const state = StateManager.from({});
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: 'missing', from_action: 'missing' }],
      state,
      prevResult,
    );
    expect(isPureNull(result['missing']!)).toBe(true);
  });

  it('from_state reads the post-merge state', () => {
    const state = StateManager.from({ 'workflow.stage': buildString('review') });
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: 'stage', from_state: 'workflow.stage' }],
      state,
      prevResult,
    );
    expect(isPureString(result['stage']!) && result['stage'].value).toBe('review');
  });

  it('from_state returns buildNull("missing") when path not in state', () => {
    const state = StateManager.from({});
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: 'x', from_state: 'no.path' }],
      state,
      prevResult,
    );
    expect(isPureNull(result['x']!)).toBe(true);
  });

  it('from_literal converts number correctly', () => {
    const state = StateManager.from({});
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: 'n', from_literal: 42 }],
      state,
      prevResult,
    );
    expect(isPureNumber(result['n']!) && result['n'].value).toBe(42);
  });

  it('from_literal converts string correctly', () => {
    const state = StateManager.from({});
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: 'msg', from_literal: 'hello' }],
      state,
      prevResult,
    );
    expect(isPureString(result['msg']!) && result['msg'].value).toBe('hello');
  });

  it('from_literal converts boolean correctly', () => {
    const state = StateManager.from({});
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: 'flag', from_literal: true }],
      state,
      prevResult,
    );
    expect(isPureBoolean(result['flag']!) && result['flag'].value).toBe(true);
  });

  it('from_literal converts number array correctly', () => {
    const state = StateManager.from({});
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: 'nums', from_literal: [1, 2, 3] }],
      state,
      prevResult,
    );
    expect(isArray(result['nums']!)).toBe(true);
  });

  it('from_literal converts string array correctly', () => {
    const state = StateManager.from({});
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: 'tags', from_literal: ['a', 'b'] }],
      state,
      prevResult,
    );
    expect(isArray(result['tags']!)).toBe(true);
  });

  it('from_literal converts bool array correctly', () => {
    const state = StateManager.from({});
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: 'flags', from_literal: [true, false] }],
      state,
      prevResult,
    );
    expect(isArray(result['flags']!)).toBe(true);
  });

  it('from_literal handles empty array (no element type to infer)', () => {
    const state = StateManager.from({});
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: 'empty', from_literal: [] as unknown as number[] }],
      state,
      prevResult,
    );
    expect(isArray(result['empty']!)).toBe(true);
  });

  it('resolves multiple entries with mixed sources', () => {
    const state = StateManager.from({ 'ctx.mode': buildString('fast') });
    const prevResult = makePrevResult({ raw_score: buildNumber(5) });
    const result = resolveNextPrepare(
      [
        { binding: 'score', from_action: 'raw_score' },
        { binding: 'mode', from_state: 'ctx.mode' },
        { binding: 'threshold', from_literal: 3 },
      ],
      state,
      prevResult,
    );
    expect(isPureNumber(result['score']!) && result['score'].value).toBe(5);
    expect(isPureString(result['mode']!) && result['mode'].value).toBe('fast');
    expect(isPureNumber(result['threshold']!) && result['threshold'].value).toBe(3);
  });
});

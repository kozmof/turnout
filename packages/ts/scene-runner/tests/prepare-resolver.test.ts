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
import type { HookRegistry, PrepareHookContext } from '../src/types/harness-types.js';
import type { PrepareEntry, NextPrepareEntry } from '../src/types/turnout-model_pb.js';

// ─────────────────────────────────────────────────────────────────────────────
// resolveActionPrepare
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveActionPrepare', () => {
  it('from_state reads the value from StateManager', () => {
    const state = StateManager.from({ 'request.query': buildString('hello') });
    const result = resolveActionPrepare(
      [{ binding: 'query', fromState: 'request.query' }] as unknown as PrepareEntry[],
      state,
      {},
      'test_action',
    );
    expect(isPureString(result['query']!) && result['query'].value).toBe('hello');
  });

  it('from_state returns buildNull("missing") when path is not in state', () => {
    const state = StateManager.from({});
    const result = resolveActionPrepare(
      [{ binding: 'missing_val', fromState: 'no.such.path' }] as unknown as PrepareEntry[],
      state,
      {},
      'test_action',
    );
    const val = result['missing_val'];
    expect(isPureNull(val!)).toBe(true);
  });

  it('from_hook calls the hook and extracts the binding field', () => {
    const state = StateManager.from({});
    const hooks: HookRegistry = {
      my_hook: (_ctx: PrepareHookContext) => ({ foo: buildNumber(42) }),
    };
    const result = resolveActionPrepare(
      [{ binding: 'foo', fromHook: 'my_hook' }] as unknown as PrepareEntry[],
      state,
      hooks,
      'test_action',
    );
    expect(isPureNumber(result['foo']!) && result['foo'].value).toBe(42);
  });

  it('from_hook passes PrepareHookContext with actionId, hookName, and get()', () => {
    const state = StateManager.from({ 'a.x': buildNumber(7) });
    let capturedActionId: string | undefined;
    let capturedHookName: string | undefined;
    let capturedGetResult: unknown;
    const hooks: HookRegistry = {
      my_hook: (ctx: PrepareHookContext) => {
        capturedActionId = ctx.actionId;
        capturedHookName = ctx.hookName;
        capturedGetResult = ctx.get('x_val'); // reads the binding resolved via from_state above
        return { bar: buildString('from_hook') };
      },
    };
    resolveActionPrepare(
      [
        { binding: 'x_val', fromState: 'a.x' }, // resolved first
        { binding: 'bar', fromHook: 'my_hook' }, // hook reads x_val via ctx.get()
      ] as unknown as PrepareEntry[],
      state,
      hooks,
      'action_42',
    );
    expect(capturedActionId).toBe('action_42');
    expect(capturedHookName).toBe('my_hook');
    expect(isPureNumber(capturedGetResult as never) && (capturedGetResult as { value: number }).value).toBe(7);
  });

  it('from_hook returns buildNull("missing") if the hook is not registered', () => {
    const state = StateManager.from({});
    const result = resolveActionPrepare(
      [{ binding: 'foo', fromHook: 'nonexistent_hook' }] as unknown as PrepareEntry[],
      state,
      {},
      'test_action',
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
        { binding: 'x_val', fromState: 'a.x' },
        { binding: 'y_val', fromState: 'b.y' },
      ] as unknown as PrepareEntry[],
      state,
      {},
      'test_action',
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
      [{ binding: 'score', fromAction: 'score' }] as unknown as NextPrepareEntry[],
      state,
      prevResult,
    );
    expect(isPureNumber(result['score']!) && result['score'].value).toBe(99);
  });

  it('from_action returns buildNull("missing") when binding is absent in prevResult', () => {
    const state = StateManager.from({});
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: 'missing', fromAction: 'missing' }] as unknown as NextPrepareEntry[],
      state,
      prevResult,
    );
    expect(isPureNull(result['missing']!)).toBe(true);
  });

  it('from_state reads the post-merge state', () => {
    const state = StateManager.from({ 'workflow.stage': buildString('review') });
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: 'stage', fromState: 'workflow.stage' }] as unknown as NextPrepareEntry[],
      state,
      prevResult,
    );
    expect(isPureString(result['stage']!) && result['stage'].value).toBe('review');
  });

  it('from_state returns buildNull("missing") when path not in state', () => {
    const state = StateManager.from({});
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: 'x', fromState: 'no.path' }] as unknown as NextPrepareEntry[],
      state,
      prevResult,
    );
    expect(isPureNull(result['x']!)).toBe(true);
  });

  it('from_literal converts number correctly', () => {
    const state = StateManager.from({});
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: 'n', fromLiteral: 42 }] as unknown as NextPrepareEntry[],
      state,
      prevResult,
    );
    expect(isPureNumber(result['n']!) && result['n'].value).toBe(42);
  });

  it('from_literal converts string correctly', () => {
    const state = StateManager.from({});
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: 'msg', fromLiteral: 'hello' }] as unknown as NextPrepareEntry[],
      state,
      prevResult,
    );
    expect(isPureString(result['msg']!) && result['msg'].value).toBe('hello');
  });

  it('from_literal converts boolean correctly', () => {
    const state = StateManager.from({});
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: 'flag', fromLiteral: true }] as unknown as NextPrepareEntry[],
      state,
      prevResult,
    );
    expect(isPureBoolean(result['flag']!) && result['flag'].value).toBe(true);
  });

  it('from_literal converts number array correctly', () => {
    const state = StateManager.from({});
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: 'nums', fromLiteral: [1, 2, 3] }] as unknown as NextPrepareEntry[],
      state,
      prevResult,
    );
    expect(isArray(result['nums']!)).toBe(true);
  });

  it('from_literal converts string array correctly', () => {
    const state = StateManager.from({});
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: 'tags', fromLiteral: ['a', 'b'] }] as unknown as NextPrepareEntry[],
      state,
      prevResult,
    );
    expect(isArray(result['tags']!)).toBe(true);
  });

  it('from_literal converts bool array correctly', () => {
    const state = StateManager.from({});
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: 'flags', fromLiteral: [true, false] }] as unknown as NextPrepareEntry[],
      state,
      prevResult,
    );
    expect(isArray(result['flags']!)).toBe(true);
  });

  it('from_literal handles empty array (no element type to infer)', () => {
    const state = StateManager.from({});
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: 'empty', fromLiteral: [] as unknown as number[] }] as unknown as NextPrepareEntry[],
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
        { binding: 'score', fromAction: 'raw_score' },
        { binding: 'mode', fromState: 'ctx.mode' },
        { binding: 'threshold', fromLiteral: 3 },
      ] as unknown as NextPrepareEntry[],
      state,
      prevResult,
    );
    expect(isPureNumber(result['score']!) && result['score'].value).toBe(5);
    expect(isPureString(result['mode']!) && result['mode'].value).toBe('fast');
    expect(isPureNumber(result['threshold']!) && result['threshold'].value).toBe(3);
  });
});

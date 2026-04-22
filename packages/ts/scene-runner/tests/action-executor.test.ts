import { describe, it, expect } from 'vitest';
import { executeAction } from '../src/executor/action-executor.js';
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
} from 'runtime';
import type { ActionModel } from '../src/types/turnout-model_pb.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** A simple action: adds two values and merges the result into STATE. */
const addAction = {
  id: 'add_action',
  compute: {
    root: 'sum',
    prog: {
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
    },
  },
} as unknown as ActionModel;

// ─────────────────────────────────────────────────────────────────────────────
// Basic compute
// ─────────────────────────────────────────────────────────────────────────────

describe('executeAction — compute', () => {
  it('returns the correct computeRootValue', () => {
    const state = StateManager.from({});
    const result = executeAction(addAction, state, {});
    expect(isPureNumber(result.computeRootValue) && result.computeRootValue.value).toBe(7);
  });

  it('populates bindingValues for all prog bindings', () => {
    const state = StateManager.from({});
    const result = executeAction(addAction, state, {});
    expect(isPureNumber(result.bindingValues['a']) && result.bindingValues['a'].value).toBe(3);
    expect(isPureNumber(result.bindingValues['b']) && result.bindingValues['b'].value).toBe(4);
    expect(isPureNumber(result.bindingValues['sum']) && result.bindingValues['sum'].value).toBe(7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Prepare (from_state)
// ─────────────────────────────────────────────────────────────────────────────

describe('executeAction — prepare', () => {
  const actionWithPrepare = {
    id: 'prepared_action',
    prepare: [{ binding: 'a', fromState: 'inputs.a' }],
    compute: {
      root: 'sum',
      prog: {
        name: 'prepared_prog',
        bindings: [
          { name: 'a', type: 'number', value: 0 },   // placeholder; will be overridden
          { name: 'b', type: 'number', value: 10 },
          {
            name: 'sum',
            type: 'number',
            expr: { combine: { fn: 'add', args: [{ ref: 'a' }, { ref: 'b' }] } },
          },
        ],
      },
    },
  } as unknown as ActionModel;

  it('from_state injects value from STATE into the prog', () => {
    const state = StateManager.from({ 'inputs.a': buildNumber(5) });
    const result = executeAction(actionWithPrepare, state, {});
    // a is overridden to 5; b is 10 → sum = 15
    expect(isPureNumber(result.computeRootValue) && result.computeRootValue.value).toBe(15);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Merge
// ─────────────────────────────────────────────────────────────────────────────

describe('executeAction — merge', () => {
  const actionWithMerge = {
    id: 'merge_action',
    compute: {
      root: 'result',
      prog: {
        name: 'merge_prog',
        bindings: [
          { name: 'x', type: 'number', value: 42 },
          {
            name: 'result',
            type: 'number',
            expr: { combine: { fn: 'add', args: [{ ref: 'x' }, { lit: 0 }] } },
          },
        ],
      },
    },
    merge: [{ binding: 'x', toState: 'output.value' }],
  } as unknown as ActionModel;

  it('writes merged binding value to STATE', () => {
    const state = StateManager.from({});
    const result = executeAction(actionWithMerge, state, {});
    const stateVal = result.stateAfterMerge.read('output.value');
    expect(isPureNumber(stateVal!) && stateVal.value).toBe(42);
  });

  it('does not mutate the input state', () => {
    const state = StateManager.from({});
    executeAction(actionWithMerge, state, {});
    expect(state.read('output.value')).toBeUndefined();
  });

  it('merges multiple entries', () => {
    const action = {
      id: 'multi_merge',
      compute: {
        root: 'label',
        prog: {
          name: 'multi_prog',
          bindings: [
            { name: 'score', type: 'number', value: 99 },
            {
              name: 'label',
              type: 'str',
              expr: { combine: { fn: 'str_concat', args: [{ lit: 'score:' }, { lit: 'x' }] } },
            },
          ],
        },
      },
      merge: [
        { binding: 'score', toState: 'result.score' },
      ],
    } as unknown as ActionModel;
    const state = StateManager.from({});
    const result = executeAction(action, state, {});
    expect(isPureNumber(result.stateAfterMerge.read('result.score')!) && result.stateAfterMerge.read('result.score')!.value).toBe(99);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// No compute block
// ─────────────────────────────────────────────────────────────────────────────

describe('executeAction — no compute', () => {
  const noComputeAction = {
    id: 'noop',
  } as unknown as ActionModel;

  it('returns buildNull("missing") as computeRootValue', () => {
    const state = StateManager.from({});
    const result = executeAction(noComputeAction, state, {});
    expect(isPureNull(result.computeRootValue)).toBe(true);
  });

  it('returns empty bindingValues', () => {
    const state = StateManager.from({});
    const result = executeAction(noComputeAction, state, {});
    expect(Object.keys(result.bindingValues)).toHaveLength(0);
  });

  it('returns the original state unchanged', () => {
    const state = StateManager.from({ 'a.b': buildString('original') });
    const result = executeAction(noComputeAction, state, {});
    expect(result.stateAfterMerge).toBe(state);
  });
});

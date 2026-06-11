import { describe, it, expect } from 'vitest';
import { executeScene, executeSceneSafe, createSceneExecutor } from '../src/executor/scene-executor.js';
import { StateManager, stateManagerFromUnchecked } from '../src/state/state-manager.js';
import {
  buildNumber,
  buildString,
  buildBoolean,
  isPureNumber,
  isPureString,
  isPureBoolean,
} from 'runtime';
import type { SceneBlock, ActionModel } from '../src/types/turnout-model_pb.js';
import { SceneRuntimeError, PrepareError } from '../src/executor/errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a trivial pass-through action that merges one number binding into STATE. */
function makePassAction(id: string, value: number, toState: string): ActionModel {
  return {
    id,
    compute: {
      root: 'out',
      prog: {
        name: `${id}_prog`,
        bindings: [
          { name: 'v', type: 'number', value },
          {
            name: 'out',
            type: 'number',
            expr: { combine: { fn: 'add', args: [{ ref: 'v' }, { lit: 0 }] } },
          },
        ],
      },
    },
    merge: [{ binding: 'v', toState: toState }],
  } as unknown as ActionModel;
}

/** Build a conditional next rule that fires when a boolean state path is true. */
function makeBoolCondNextRule(
  condStatePath: string,
  nextActionId: string,
): ActionModel['next'] {
  return [
    {
      prepare: [{ binding: 'flag', fromState: condStatePath }],
      compute: {
        condition: 'flag',
        prog: {
          name: 'cond_prog',
          bindings: [{ name: 'flag', type: 'bool', value: false }],
        },
      },
      action: nextActionId,
    },
  ] as unknown as ActionModel['next'];
}

// ─────────────────────────────────────────────────────────────────────────────
// Single action, no next rules → terminates immediately
// ─────────────────────────────────────────────────────────────────────────────

describe('executeScene — single terminal action', () => {
  const scene = {
    id: 'single_scene',
    entryActions: ['only_action'],
    actions: [makePassAction('only_action', 7, 'out.val')],
  } as unknown as SceneBlock;

  it('terminates the single action', async () => {
    const result = await executeScene(scene, stateManagerFromUnchecked({}));
    expect(result.terminatedAt).toEqual(['only_action']);
  });

  it('trace contains one action entry', async () => {
    const result = await executeScene(scene, stateManagerFromUnchecked({}));
    expect(result.trace.actions).toHaveLength(1);
    expect(result.trace.actions[0].actionId).toBe('only_action');
    expect(result.trace.actions[0].nextActionIds).toEqual([]);
  });

  it('final state has the merged value', async () => {
    const result = await executeScene(scene, stateManagerFromUnchecked({}));
    const v = result.stateAfterScene.read('out.val');
    expect(isPureNumber(v!) && v.value).toBe(7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Two-action chain (first-match, conditional)
// ─────────────────────────────────────────────────────────────────────────────

describe('executeScene — two-action chain (first-match)', () => {
  const scene = {
    id: 'chain_scene',
    entryActions: ['action_a'],
    nextPolicy: 'first-match',
    actions: [
      {
        ...makePassAction('action_a', 1, 'step.a'),
        next: makeBoolCondNextRule('gate.proceed', 'action_b'),
      },
      makePassAction('action_b', 2, 'step.b'),
    ],
  } as unknown as SceneBlock;

  it('follows the chain when the condition is true', async () => {
    const state = stateManagerFromUnchecked({ 'gate.proceed': buildBoolean(true) });
    const result = await executeScene(scene, state);
    expect(result.terminatedAt).toEqual(['action_b']);
    expect(result.trace.actions.map((t) => t.actionId)).toEqual(['action_a', 'action_b']);
    const v = result.stateAfterScene.read('step.b');
    expect(isPureNumber(v!) && v.value).toBe(2);
  });

  it('terminates at action_a when the condition is false', async () => {
    const state = stateManagerFromUnchecked({ 'gate.proceed': buildBoolean(false) });
    const result = await executeScene(scene, state);
    expect(result.terminatedAt).toEqual(['action_a']);
    expect(result.trace.actions.map((t) => t.actionId)).toEqual(['action_a']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unconditional next rule
// ─────────────────────────────────────────────────────────────────────────────

describe('executeScene — unconditional next rule', () => {
  const scene = {
    id: 'unconditional_scene',
    entryActions: ['first'],
    actions: [
      {
        ...makePassAction('first', 10, 'step.first'),
        next: [{ action: 'second' }],   // no compute → always fires
      },
      makePassAction('second', 20, 'step.second'),
    ],
  } as unknown as SceneBlock;

  it('always follows an unconditional next rule', async () => {
    const result = await executeScene(scene, stateManagerFromUnchecked({}));
    expect(result.terminatedAt).toEqual(['second']);
    expect(result.trace.actions.map((t) => t.actionId)).toEqual(['first', 'second']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// all-match policy
// ─────────────────────────────────────────────────────────────────────────────

describe('executeScene — all-match policy', () => {
  const scene = {
    id: 'all_match_scene',
    entryActions: ['start'],
    nextPolicy: 'all-match',
    actions: [
      {
        ...makePassAction('start', 0, 'step.start'),
        next: [
          { action: 'branch_a' },   // unconditional
          { action: 'branch_b' },   // unconditional
        ],
      },
      makePassAction('branch_a', 100, 'step.a'),
      makePassAction('branch_b', 200, 'step.b'),
    ],
  } as unknown as SceneBlock;

  it('enqueues all matching branches', async () => {
    const result = await executeScene(scene, stateManagerFromUnchecked({}));
    const ran = result.trace.actions.map((t) => t.actionId);
    expect(ran).toContain('branch_a');
    expect(ran).toContain('branch_b');
    expect(result.terminatedAt).toContain('branch_a');
    expect(result.terminatedAt).toContain('branch_b');
  });

  it('start action has both nextActionIds', async () => {
    const result = await executeScene(scene, stateManagerFromUnchecked({}));
    const startTrace = result.trace.actions.find((t) => t.actionId === 'start')!;
    expect(startTrace.nextActionIds).toEqual(['branch_a', 'branch_b']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// State propagation across actions
// ─────────────────────────────────────────────────────────────────────────────

describe('executeScene — state propagation', () => {
  /** Action B reads the value written by action A via from_state in prepare. */
  const actionA = {
    id: 'action_a',
    compute: {
      root: 'out',
      prog: {
        name: 'a_prog',
        bindings: [
          { name: 'v', type: 'number', value: 55 },
          {
            name: 'out',
            type: 'number',
            expr: { combine: { fn: 'add', args: [{ ref: 'v' }, { lit: 0 }] } },
          },
        ],
      },
    },
    merge: [{ binding: 'v', toState: 'shared.val' }],
    next: [{ action: 'action_b' }],
  } as unknown as ActionModel;

  const actionB = {
    id: 'action_b',
    prepare: [{ binding: 'input', fromState: 'shared.val' }],
    compute: {
      root: 'doubled',
      prog: {
        name: 'b_prog',
        bindings: [
          { name: 'input', type: 'number', value: 0 },
          {
            name: 'doubled',
            type: 'number',
            expr: { combine: { fn: 'add', args: [{ ref: 'input' }, { ref: 'input' }] } },
          },
        ],
      },
    },
    merge: [{ binding: 'doubled', toState: 'shared.doubled' }],
  } as unknown as ActionModel;

  const scene = {
    id: 'propagation_scene',
    entryActions: ['action_a'],
    actions: [actionA, actionB],
  } as unknown as SceneBlock;

  it('action_b can read the STATE written by action_a', async () => {
    const result = await executeScene(scene, stateManagerFromUnchecked({}));
    const doubled = result.stateAfterScene.read('shared.doubled');
    // 55 written by A, doubled by B → 110
    expect(isPureNumber(doubled!) && doubled.value).toBe(110);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cycle guard
// ─────────────────────────────────────────────────────────────────────────────

describe('executeScene — cycle guard', () => {
  const scene = {
    id: 'cycle_scene',
    entryActions: ['a'],
    actions: [
      {
        ...makePassAction('a', 1, 'step.a'),
        next: [{ action: 'a' }],   // self-loop
      },
    ],
  } as unknown as SceneBlock;

  it('does not loop infinitely on a self-referencing next rule', async () => {
    const result = await executeScene(scene, stateManagerFromUnchecked({}));
    // 'a' runs once; the re-queued 'a' is skipped by the visited guard
    expect(result.trace.actions.filter((t) => t.actionId === 'a')).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createSceneExecutor — manual stepping API
// ─────────────────────────────────────────────────────────────────────────────

describe('createSceneExecutor — isDone / next / result', () => {
  const scene = {
    id: 'step_scene',
    entryActions: ['only_action'],
    actions: [makePassAction('only_action', 7, 'out.val')],
  } as unknown as SceneBlock;

  it('isDone() is false before any steps', () => {
    const executor = createSceneExecutor(scene, stateManagerFromUnchecked({}));
    expect(executor.isDone()).toBe(false);
  });

  it('next() returns done:false with a trace on the first step', async () => {
    const executor = createSceneExecutor(scene, stateManagerFromUnchecked({}));
    const step = await executor.next();
    expect(step.done).toBe(false);
    if (step.done) return;
    expect(step.trace.actionId).toBe('only_action');
  });

  it('isDone() is true after the single action runs', async () => {
    const executor = createSceneExecutor(scene, stateManagerFromUnchecked({}));
    await executor.next();
    expect(executor.isDone()).toBe(true);
  });

  it('next() returns done:true when the queue is empty', async () => {
    const executor = createSceneExecutor(scene, stateManagerFromUnchecked({}));
    await executor.next();
    expect(await executor.next()).toEqual({ done: true });
  });

  it('result() throws SceneRuntimeError(IncompleteScene) before the scene is complete', () => {
    const executor = createSceneExecutor(scene, stateManagerFromUnchecked({}));
    let err: unknown;
    try { executor.result(); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(SceneRuntimeError);
    expect((err as SceneRuntimeError).code).toBe('IncompleteScene');
  });

  it('result() returns the correct SceneExecutionResult after completion', async () => {
    const executor = createSceneExecutor(scene, stateManagerFromUnchecked({}));
    while (!executor.isDone()) await executor.next();
    const result = executor.result();
    expect(result.sceneId).toBe('step_scene');
    expect(result.terminatedAt).toEqual(['only_action']);
    const v = result.stateAfterScene.read('out.val');
    expect(isPureNumber(v!) && v.value).toBe(7);
  });
});

describe('createSceneExecutor — step-by-step trace', () => {
  const scene = {
    id: 'chain_step_scene',
    entryActions: ['first'],
    actions: [
      {
        ...makePassAction('first', 10, 'step.first'),
        next: [{ action: 'second' }],
      },
      makePassAction('second', 20, 'step.second'),
    ],
  } as unknown as SceneBlock;

  it('yields each action trace in order', async () => {
    const executor = createSceneExecutor(scene, stateManagerFromUnchecked({}));

    const step1 = await executor.next();
    expect(step1.done).toBe(false);
    if (step1.done) return;
    expect(step1.trace.actionId).toBe('first');
    expect(step1.trace.nextActionIds).toEqual(['second']);

    const step2 = await executor.next();
    expect(step2.done).toBe(false);
    if (step2.done) return;
    expect(step2.trace.actionId).toBe('second');
    expect(step2.trace.nextActionIds).toEqual([]);

    expect(executor.isDone()).toBe(true);
  });

  it('intermediate state is visible via result() only after completion', async () => {
    const executor = createSceneExecutor(scene, stateManagerFromUnchecked({}));
    await executor.next(); // run 'first'
    let err: unknown;
    try { executor.result(); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(SceneRuntimeError); // 'second' still pending
    await executor.next(); // run 'second'
    const result = executor.result();
    const v = result.stateAfterScene.read('step.second');
    expect(isPureNumber(v!) && v.value).toBe(20);
  });
});

describe('createSceneExecutor — cycle guard', () => {
  const scene = {
    id: 'cycle_step_scene',
    entryActions: ['a'],
    actions: [
      {
        ...makePassAction('a', 1, 'step.a'),
        next: [{ action: 'a' }],
      },
    ],
  } as unknown as SceneBlock;

  it('completes after one step despite a self-loop next rule', async () => {
    const executor = createSceneExecutor(scene, stateManagerFromUnchecked({}));
    await executor.next();
    expect(executor.isDone()).toBe(true);
  });
});

describe('executeSceneSafe — failedActionId', () => {
  const scene = {
    id: 'safe_failure_scene',
    entryActions: ['first'],
    actions: [
      {
        ...makePassAction('first', 1, 'step.first'),
        next: [{ action: 'second' }],
      },
      {
        id: 'second',
        compute: {
          root: 'out',
          prog: {
            name: 'bad_prog',
            bindings: [
              { name: 'x', type: 'number', value: 1 },
              {
                name: 'out',
                type: 'number',
                expr: { combine: { fn: 'missing_fn', args: [{ ref: 'x' }, { lit: 1 }] } },
              },
            ],
          },
        },
      },
    ],
  } as unknown as SceneBlock;

  it('reports the action that failed before trace emission', async () => {
    const result = await executeSceneSafe(scene, stateManagerFromUnchecked({}));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failedActionId).toBe('second');
      expect((result.error as { code?: string }).code).toBe('UnknownFunction');
      expect(result.partialState.read('step.first')).toBeDefined();
    }
  });
});


describe('createSceneExecutor — all-match duplicate enqueue warnings', () => {
  it('warns when all-match enqueues an already visited action', async () => {
    const scene = {
      id: 'duplicate_enqueue_scene',
      entryActions: ['start'],
      nextPolicy: 'all-match',
      actions: [
        {
          ...makePassAction('start', 1, 'step.start'),
          next: [{ action: 'again' }, { action: 'again' }],
        },
        makePassAction('again', 2, 'step.again'),
      ],
    } as unknown as SceneBlock;

    const result = await executeScene(scene, stateManagerFromUnchecked({}));

    expect(result.trace.actions.map((a) => a.actionId)).toEqual(['start', 'again']);
    expect(result.trace.warnings).toEqual([
      'action "again" was enqueued more than once (all-match, first enqueued by "start") but ran only once',
    ]);
  });
});

describe('executeSceneSafe — success result', () => {
  it('returns ok true when the scene completes', async () => {
    const scene = {
      id: 'safe_success_scene',
      entryActions: ['only'],
      actions: [makePassAction('only', 3, 'safe.value')],
    } as unknown as SceneBlock;

    const result = await executeSceneSafe(scene, stateManagerFromUnchecked({}));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sceneId).toBe('safe_success_scene');
      expect(isPureNumber(result.value.stateAfterScene.read('safe.value'))).toBe(true);
    }
  });
});

describe('createSceneExecutor — construction errors', () => {
  it('throws for duplicate action ids', () => {
    const duplicateA = makePassAction('dup', 1, 'dup.one');
    const duplicateB = makePassAction('dup', 2, 'dup.two');
    const scene = {
      id: 'duplicate_action_scene',
      entryActions: ['dup'],
      actions: [duplicateA, duplicateB],
    } as unknown as SceneBlock;

    expect(() => createSceneExecutor(scene, stateManagerFromUnchecked({}))).toThrow('duplicate action id "dup"');
  });
});

describe('executeScene — next rule compute without prog', () => {
  it('treats a next rule with missing prog as not matched', async () => {
    const scene = {
      id: 'missing_prog_scene',
      entryActions: ['start'],
      actions: [
        {
          ...makePassAction('start', 1, 'step.start'),
          next: [{ compute: { condition: 'flag' }, action: 'never' }],
        },
        makePassAction('never', 2, 'step.never'),
      ],
    } as unknown as SceneBlock;

    const result = await executeScene(scene, stateManagerFromUnchecked({}));

    expect(result.trace.actions.map((a) => a.actionId)).toEqual(['start']);
    expect(result.terminatedAt).toEqual(['start']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// executeSceneSafe — non-SceneRuntimeError re-throw
// ─────────────────────────────────────────────────────────────────────────────

describe('executeSceneSafe — non-SceneRuntimeError is re-thrown', () => {
  it('re-throws PrepareError for an unregistered hook instead of returning ok:false', async () => {
    // An action with a prepare entry that references an unregistered hook causes
    // resolveActionPrepare to throw PrepareError. PrepareError is not a
    // SceneRuntimeError, so executeSceneSafe must re-throw it rather than
    // silently capturing it as { ok: false }.
    const action = {
      ...makePassAction('a', 1, 'x.v'),
      prepare: [{ binding: 'unused', fromHook: 'missing_hook' }],
    } as unknown as ActionModel;
    const scene = {
      id: 'rethrow_scene',
      entryActions: ['a'],
      actions: [action],
    } as unknown as SceneBlock;

    const promise = executeSceneSafe(scene, stateManagerFromUnchecked({}));
    await expect(promise).rejects.toBeInstanceOf(PrepareError);
    await expect(promise).rejects.toThrow('prepare hook "missing_hook" is not registered');
  });
});

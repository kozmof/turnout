import { describe, it, expect } from 'vitest';
import { executeRoute } from '../src/executor/route-executor.js';
import { StateManager } from '../src/state/state-manager.js';
import { isPureNumber } from 'runtime';
import type { RouteModel, SceneBlock, ActionModel } from '../src/types/turnout-model_pb.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** A minimal pass-through action: merges a fixed number into STATE. */
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

function makeScene(id: string, ...actions: ActionModel[]): SceneBlock {
  return { id, entryActions: [actions[0].id], actions } as unknown as SceneBlock;
}

function makeSceneMap(...scenes: SceneBlock[]): Record<string, SceneBlock> {
  return Object.fromEntries(scenes.map((s) => [s.id, s]));
}

// ─────────────────────────────────────────────────────────────────────────────
// Single scene — no match arm → completed immediately
// ─────────────────────────────────────────────────────────────────────────────

describe('executeRoute — single scene, no match arm', () => {
  const scene = makeScene('only_scene', makePassAction('step', 7, 'out.v'));
  const route = { id: 'r1', match: [] } as unknown as RouteModel;

  it('status is "completed"', () => {
    const result = executeRoute(route, makeSceneMap(scene), 'only_scene', StateManager.from({}));
    expect(result.status).toBe('completed');
  });

  it('trace contains one scene entry', () => {
    const result = executeRoute(route, makeSceneMap(scene), 'only_scene', StateManager.from({}));
    expect(result.trace.scenes).toHaveLength(1);
    expect(result.trace.scenes[0].sceneId).toBe('only_scene');
  });

  it('history has one entry per completed action', () => {
    const result = executeRoute(route, makeSceneMap(scene), 'only_scene', StateManager.from({}));
    expect(result.history).toEqual(['only_scene.step']);
  });

  it('finalState reflects the scene merge', () => {
    const result = executeRoute(route, makeSceneMap(scene), 'only_scene', StateManager.from({}));
    const v = result.finalState['out.v'];
    expect(isPureNumber(v!) && v.value).toBe(7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Two-scene route — specific pattern routes to second scene, then completes
// (non-looping: no arm references scene_2, so route terminates after scene_2)
// ─────────────────────────────────────────────────────────────────────────────

describe('executeRoute — two-scene route (exact pattern)', () => {
  const scene1 = makeScene('scene_1', makePassAction('a1', 1, 's1.val'));
  const scene2 = makeScene('scene_2', makePassAction('a2', 2, 's2.val'));
  // arm only references scene_1 → fires after scene_1, not after scene_2
  const route = {
    id: 'r1',
    match: [{ patterns: ['scene_1.a1'], target: 'scene_2' }],
  } as unknown as RouteModel;

  it('executes both scenes in order', () => {
    const result = executeRoute(route, makeSceneMap(scene1, scene2), 'scene_1', StateManager.from({}));
    expect(result.trace.scenes.map((s) => s.sceneId)).toEqual(['scene_1', 'scene_2']);
  });

  it('history has entries from both scenes', () => {
    const result = executeRoute(route, makeSceneMap(scene1, scene2), 'scene_1', StateManager.from({}));
    expect(result.history).toEqual(['scene_1.a1', 'scene_2.a2']);
  });

  it('finalState has values from both scenes', () => {
    const result = executeRoute(route, makeSceneMap(scene1, scene2), 'scene_1', StateManager.from({}));
    const s1 = result.finalState['s1.val'];
    const s2 = result.finalState['s2.val'];
    expect(isPureNumber(s1!) && s1.value).toBe(1);
    expect(isPureNumber(s2!) && s2.value).toBe(2);
  });

  it('status is completed after second scene', () => {
    const result = executeRoute(route, makeSceneMap(scene1, scene2), 'scene_1', StateManager.from({}));
    expect(result.status).toBe('completed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Exact pattern doesn't match → route completes after first scene
// ─────────────────────────────────────────────────────────────────────────────

describe('executeRoute — pattern does not match', () => {
  const scene1 = makeScene('scene_1', makePassAction('terminal', 99, 's1.out'));
  const scene2 = makeScene('scene_2', makePassAction('done', 42, 's2.out'));
  const route = {
    id: 'r_nomatch',
    match: [{ patterns: ['scene_1.other_action'], target: 'scene_2' }],
  } as unknown as RouteModel;

  it('route terminates after scene_1 when pattern does not match', () => {
    const result = executeRoute(route, makeSceneMap(scene1, scene2), 'scene_1', StateManager.from({}));
    expect(result.trace.scenes).toHaveLength(1);
    expect(result.status).toBe('completed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wildcard pattern match
// ─────────────────────────────────────────────────────────────────────────────

describe('executeRoute — wildcard pattern match "scene_1.*.terminal"', () => {
  const intro = makePassAction('intro', 1, 's1.intro');
  const terminal = makePassAction('terminal', 2, 's1.term');
  const scene1 = {
    id: 'scene_1',
    entryActions: ['intro'],
    actions: [
      { ...intro, next: [{ action: 'terminal' }] },
      terminal,
    ],
  } as unknown as SceneBlock;
  const scene2 = makeScene('scene_2', makePassAction('final', 100, 's2.out'));
  const route = {
    id: 'r1',
    match: [{ patterns: ['scene_1.*.terminal'], target: 'scene_2' }],
  } as unknown as RouteModel;

  it('routes to scene_2 via wildcard match', () => {
    const result = executeRoute(route, makeSceneMap(scene1, scene2), 'scene_1', StateManager.from({}));
    expect(result.trace.scenes.map((s) => s.sceneId)).toEqual(['scene_1', 'scene_2']);
  });

  it('history contains all actions including those before the terminal', () => {
    const result = executeRoute(route, makeSceneMap(scene1, scene2), 'scene_1', StateManager.from({}));
    expect(result.history).toContain('scene_1.intro');
    expect(result.history).toContain('scene_1.terminal');
    expect(result.history).toContain('scene_2.final');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Three-scene route: two hops via separate arms
// ─────────────────────────────────────────────────────────────────────────────

describe('executeRoute — three-scene chain', () => {
  const scene1 = makeScene('s1', makePassAction('a', 10, 'v.a'));
  const scene2 = makeScene('s2', makePassAction('b', 20, 'v.b'));
  const scene3 = makeScene('s3', makePassAction('c', 30, 'v.c'));
  const route = {
    id: 'chain',
    match: [
      { patterns: ['s1.a'], target: 's2' },
      { patterns: ['s2.b'], target: 's3' },
      // no arm for s3 → route completes
    ],
  } as unknown as RouteModel;

  it('executes all three scenes', () => {
    const result = executeRoute(route, makeSceneMap(scene1, scene2, scene3), 's1', StateManager.from({}));
    expect(result.trace.scenes.map((s) => s.sceneId)).toEqual(['s1', 's2', 's3']);
  });

  it('finalState has values from all three scenes', () => {
    const result = executeRoute(route, makeSceneMap(scene1, scene2, scene3), 's1', StateManager.from({}));
    expect(isPureNumber(result.finalState['v.a']!) && result.finalState['v.a'].value).toBe(10);
    expect(isPureNumber(result.finalState['v.b']!) && result.finalState['v.b'].value).toBe(20);
    expect(isPureNumber(result.finalState['v.c']!) && result.finalState['v.c'].value).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STATE propagation across scenes
// ─────────────────────────────────────────────────────────────────────────────

describe('executeRoute — STATE propagates from scene_1 to scene_2', () => {
  const writeAction = makePassAction('write', 55, 'shared.val');
  const scene1 = { id: 'scene_1', entryActions: ['write'], actions: [writeAction] } as unknown as SceneBlock;

  /** scene_2 reads shared.val via from_state prepare and doubles it. */
  const readAction = {
    id: 'read_double',
    prepare: [{ binding: 'v', fromState: 'shared.val' }],
    compute: {
      root: 'doubled',
      prog: {
        name: 'double_prog',
        bindings: [
          { name: 'v', type: 'number', value: 0 },
          {
            name: 'doubled',
            type: 'number',
            expr: { combine: { fn: 'add', args: [{ ref: 'v' }, { ref: 'v' }] } },
          },
        ],
      },
    },
    merge: [{ binding: 'doubled', toState: 'shared.doubled' }],
  } as unknown as ActionModel;
  const scene2 = { id: 'scene_2', entryActions: ['read_double'], actions: [readAction] } as unknown as SceneBlock;

  const route = {
    id: 'r1',
    match: [{ patterns: ['scene_1.write'], target: 'scene_2' }],
  } as unknown as RouteModel;

  it('scene_2 reads STATE written by scene_1 and produces correct output', () => {
    const result = executeRoute(route, makeSceneMap(scene1, scene2), 'scene_1', StateManager.from({}));
    // 55 written by scene_1, doubled by scene_2 → 110
    const doubled = result.finalState['shared.doubled'];
    expect(isPureNumber(doubled!) && doubled.value).toBe(110);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OR pattern — multiple paths into the same target
// ─────────────────────────────────────────────────────────────────────────────

describe('executeRoute — OR pattern in a single arm', () => {
  const scene1 = makeScene('s1', makePassAction('done', 1, 's1.v'));
  const scene2 = makeScene('alt', makePassAction('done', 2, 'alt.v'));
  const sceneEnd = makeScene('s_end', makePassAction('finish', 99, 'end.v'));
  // Both scene paths lead to the same target via OR
  const route = {
    id: 'r_or',
    match: [{ patterns: ['s1.done', 'alt.done'], target: 's_end' }],
  } as unknown as RouteModel;

  it('OR pattern fires when s1 exits with "done"', () => {
    const result = executeRoute(route, makeSceneMap(scene1, sceneEnd), 's1', StateManager.from({}));
    expect(result.trace.scenes.map((s) => s.sceneId)).toEqual(['s1', 's_end']);
  });

  it('OR pattern fires when alt exits with "done"', () => {
    const result = executeRoute(route, makeSceneMap(scene2, sceneEnd), 'alt', StateManager.from({}));
    expect(result.trace.scenes.map((s) => s.sceneId)).toEqual(['alt', 's_end']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Result metadata
// ─────────────────────────────────────────────────────────────────────────────

describe('executeRoute — result metadata', () => {
  const scene = makeScene('s1', makePassAction('a', 1, 'x'));
  const route = { id: 'my_route', match: [] } as unknown as RouteModel;

  it('result.routeId matches the route id', () => {
    const result = executeRoute(route, makeSceneMap(scene), 's1', StateManager.from({}));
    expect(result.routeId).toBe('my_route');
  });

  it('result.trace.routeId matches the route id', () => {
    const result = executeRoute(route, makeSceneMap(scene), 's1', StateManager.from({}));
    expect(result.trace.routeId).toBe('my_route');
  });
});

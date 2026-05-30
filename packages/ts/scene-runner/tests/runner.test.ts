import { describe, it, expect, vi } from 'vitest';
import { createRunner } from '../src/runner.js';
import { buildNumber, isPureNumber } from 'runtime';
import type { TurnModel } from '../src/types/turnout-model_pb.js';

const sceneA = {
  id: 's1',
  entryActions: ['a'],
  actions: [{ id: 'a' }],
};

const sceneB = {
  id: 's2',
  entryActions: ['b'],
  actions: [{ id: 'b' }],
};

// spec: scene-to-scene.md §route — maxRouteTransitions and maxSceneSteps guards
describe('createRunner — route execution limits', () => {
  // spec: scene-to-scene.md §route — exceeding maxRouteTransitions throws
  it('uses maxRouteTransitions in route mode', async () => {
    const model = {
      scenes: [sceneA, sceneB],
      routes: [{
        id: 'loop',
        entrySceneId: 's1',
        match: [
          { patterns: ['s1.a'], target: 's2' },
          { patterns: ['s2.b'], target: 's1' },
        ],
      }],
    } as unknown as TurnModel;

    const runner = createRunner(model, { entryId: 'loop', initialState: {}, maxRouteTransitions: 0 });
    await expect(() => runner.run()).rejects.toThrow('exceeded 0 scene transitions');
  });

  // spec: scene-graph.md §action — exceeding maxSceneSteps throws MaxStepsExceeded
  it('uses maxSceneSteps for the active scene executor', async () => {
    const model = {
      scenes: [{
        id: 's',
        entryActions: ['a'],
        actions: [{ id: 'a', next: [{ action: 'b' }] }, { id: 'b' }],
      }],
    } as unknown as TurnModel;

    const runner = createRunner(model, { entryId: 's', initialState: {}, maxSceneSteps: 1 });
    await expect(() => runner.run()).rejects.toThrow('exceeded 1 action steps');
  });
});


describe('createRunner — scene mode API', () => {
  const scene = {
    id: 'scene_api',
    entryActions: ['write'],
    actions: [
      {
        id: 'write',
        prepare: [{ binding: 'v', fromHook: 'load_value' }],
        compute: {
          root: 'out',
          prog: {
            name: 'write_prog',
            bindings: [
              { name: 'v', type: 'number', value: 0 },
              { name: 'out', type: 'number', expr: { combine: { fn: 'add', args: [{ ref: 'v' }, { lit: 1 }] } } },
            ],
          },
        },
        merge: [{ binding: 'out', toState: 'result.value' }],
        publish: ['notify'],
      },
    ],
  };

  const model = { scenes: [scene], routes: [] } as unknown as TurnModel;

  it('supports hook registration, next batching, result, and partialState', async () => {
    const publish = vi.fn();
    const runner = createRunner(model, { entryId: 'scene_api', initialState: {} })
      .usePrepareHook('load_value', () => ({ v: buildNumber(4) }))
      .usePublishHook('notify', publish);

    expect(() => runner.result()).toThrow('execution is not complete');
    expect(runner.partialState().snapshot()).toEqual({});

    const steps = await runner.next(2);

    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ done: false, sceneId: 'scene_api', actionId: 'write' });
    expect(steps[1]).toEqual({ done: true });
    expect(runner.isDone()).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);

    const partial = runner.partialState().read('result.value');
    expect(isPureNumber(partial!) && partial.value).toBe(5);

    const result = runner.result();
    expect(result.trace.kind).toBe('scene');
    expect(isPureNumber(result.finalState['result.value']!) && result.finalState['result.value'].value).toBe(5);
  });

  it('runAsync yields action steps and lets run finish an already completed runner', async () => {
    const runner = createRunner(model, { entryId: 'scene_api', initialState: {} })
      .usePrepareHook('load_value', () => ({ v: buildNumber(1) }));

    const yielded = [];
    for await (const step of runner.runAsync()) {
      yielded.push(step);
    }

    expect(yielded).toHaveLength(1);
    expect(yielded[0]).toMatchObject({ done: false, sceneId: 'scene_api', actionId: 'write' });
    expect(runner.isDone()).toBe(true);

    const result = await runner.run();
    expect(result.trace.kind).toBe('scene');
  });
});

describe('createRunner — route mode API', () => {
  const routeModel = {
    scenes: [sceneA, sceneB],
    routes: [{
      id: 'route_api',
      entrySceneId: 's1',
      match: [{ patterns: ['s1.a'], target: 's2' }],
    }],
  } as unknown as TurnModel;

  it('steps across route scenes and returns a route result', async () => {
    const runner = createRunner(routeModel, { entryId: 'route_api', initialState: {} });

    expect(() => runner.result()).toThrow('execution is not complete');

    const first = await runner.next();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ done: false, sceneId: 's1', actionId: 'a' });

    const rest = await runner.next(3);
    expect(rest.some((step) => !step.done && step.sceneId === 's2' && step.actionId === 'b')).toBe(true);
    expect(rest.at(-1)).toEqual({ done: true });
    expect(runner.isDone()).toBe(true);

    const result = runner.result();
    expect(result.trace.kind).toBe('route');
    expect(result.trace.route.routeId).toBe('route_api');
  });

  it('runAsync yields route action steps until completion', async () => {
    const runner = createRunner(routeModel, { entryId: 'route_api', initialState: {} });
    const yielded = [];

    for await (const step of runner.runAsync()) yielded.push(step);

    expect(yielded.map((step) => step.done ? 'done' : step.sceneId + '.' + step.actionId)).toEqual(['s1.a', 's2.b']);
    expect(runner.isDone()).toBe(true);
  });
});

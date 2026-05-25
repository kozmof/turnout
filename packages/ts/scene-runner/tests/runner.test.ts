import { describe, it, expect } from 'vitest';
import { createRunner } from '../src/runner.js';
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

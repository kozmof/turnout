import { describe, it, expect } from 'vitest';
import { runHarness } from '../src/harness/harness.js';
import type { TurnModel } from '../src/types/turnout-model_pb.js';

// Minimal scene fixture — no compute, just an empty action so execution terminates.
const minimalScene = {
  id: 'scene_a',
  entryActions: ['act_a'],
  actions: [{ id: 'act_a' }],
};

describe('runHarness — error cases', () => {
  it('throws when a matching route exists but the model has no scenes', () => {
    const model: TurnModel = {
      scenes: [],
      routes: [{ id: 'empty_route', match: [] }],
    };
    expect(() =>
      runHarness({ model, entryId: 'empty_route', initialState: {} }),
    ).toThrow('route "empty_route" found but model has no scenes');
  });

  it('throws when entryId matches neither a route nor a scene', () => {
    const model: TurnModel = {
      scenes: [minimalScene],
    };
    expect(() =>
      runHarness({ model, entryId: 'nonexistent', initialState: {} }),
    ).toThrow('entryId "nonexistent" not found as route or scene in the model');
  });
});

describe('runHarness — model without state schema', () => {
  it('uses stateManagerFrom when model has no state block', () => {
    const model: TurnModel = {
      // no state field
      scenes: [minimalScene],
    };
    const result = runHarness({
      model,
      entryId: 'scene_a',
      initialState: {},
    });
    expect(result.trace.kind).toBe('scene');
  });

  it('accepts caller-supplied initialState when no schema is present', () => {
    const model: TurnModel = {
      scenes: [minimalScene],
    };
    const { finalState } = runHarness({
      model,
      entryId: 'scene_a',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialState: { 'custom.key': { type: 'number', value: 42 } as any },
    });
    expect(finalState['custom.key']).toBeDefined();
  });
});

describe('runHarness — scene mode', () => {
  it('returns a scene trace when entryId matches a scene', () => {
    const model: TurnModel = {
      scenes: [minimalScene],
    };
    const result = runHarness({ model, entryId: 'scene_a', initialState: {} });
    expect(result.trace.kind).toBe('scene');
    if (result.trace.kind !== 'scene') throw new Error('expected scene trace');
    expect(result.trace.scene.sceneId).toBe('scene_a');
    expect(result.model).toBe(model);
  });
});

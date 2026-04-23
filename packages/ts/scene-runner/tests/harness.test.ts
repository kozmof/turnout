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
  it('throws when a matching route exists but the model has no scenes', async () => {
    const model = {
      scenes: [],
      routes: [{ id: 'empty_route', match: [] }],
    } as unknown as TurnModel;
    await expect(() =>
      runHarness({ model, entryId: 'empty_route', initialState: {} }),
    ).rejects.toThrow('route "empty_route" found but model has no scenes');
  });

  it('throws when entryId matches neither a route nor a scene', async () => {
    const model = {
      scenes: [minimalScene],
    } as unknown as TurnModel;
    await expect(() =>
      runHarness({ model, entryId: 'nonexistent', initialState: {} }),
    ).rejects.toThrow('entryId "nonexistent" not found as route or scene in the model');
  });
});

describe('runHarness — model without state schema', () => {
  it('uses stateManagerFrom when model has no state block', async () => {
    const model = {
      // no state field
      scenes: [minimalScene],
    } as unknown as TurnModel;
    const result = await runHarness({
      model,
      entryId: 'scene_a',
      initialState: {},
    });
    expect(result.trace.kind).toBe('scene');
  });

  it('accepts caller-supplied initialState when no schema is present', async () => {
    const model = {
      scenes: [minimalScene],
    } as unknown as TurnModel;
    const { finalState } = await runHarness({
      model,
      entryId: 'scene_a',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialState: { 'custom.key': { type: 'number', value: 42 } as any },
    });
    expect(finalState['custom.key']).toBeDefined();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock bridge so tests don't need the actual go converter binary.
vi.mock('../src/server/bridge.js', () => ({
  runConverter: vi.fn(),
  loadJsonModel: vi.fn(),
}));

import { runConverter, loadJsonModel } from '../src/server/bridge.js';
import { runServerHarness } from '../src/server/harness.js';
import type { TurnModel } from '../src/types/turnout-model_pb.js';

const mockRunConverter = vi.mocked(runConverter);
const mockLoadJsonModel = vi.mocked(loadJsonModel);

const minimalModel = {
  scenes: [{ id: 'scene_a', entryActions: ['act_a'], actions: [{ id: 'act_a' }] }],
} as unknown as TurnModel;

beforeEach(() => {
  vi.resetAllMocks();
});

describe('runServerHarness', () => {
  it('loads model from jsonFile and executes', async () => {
    mockLoadJsonModel.mockReturnValue(minimalModel);

    const result = await runServerHarness({
      jsonFile: 'model.json',
      entryId: 'scene_a',
      initialState: {},
    });

    expect(mockLoadJsonModel).toHaveBeenCalledWith('model.json');
    expect(result.trace.kind).toBe('scene');
  });

  it('loads model from turnFile via runConverter', async () => {
    mockRunConverter.mockReturnValue(minimalModel);

    const result = await runServerHarness({
      turnFile: 'my.turn',
      entryId: 'scene_a',
      initialState: {},
    });

    expect(mockRunConverter).toHaveBeenCalledWith('my.turn');
    expect(result.trace.kind).toBe('scene');
  });

  it('throws when neither turnFile nor jsonFile is provided', async () => {
    await expect(
      runServerHarness({
        entryId: 'scene_a',
        initialState: {},
      }),
    ).rejects.toThrow('either turnFile or jsonFile must be provided');
  });
});

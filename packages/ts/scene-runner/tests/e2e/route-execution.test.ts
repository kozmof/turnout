/**
 * E2E: two-scene route (hand-crafted JSON fixture)
 *
 * Route: main_route
 *   match { scene_a.step_a => scene_b }
 *
 * scene_a: step_a reads input.value, writes output.result = value * 2
 * scene_b: step_b reads output.result, writes output.result = result + 1
 *
 * After full route: output.result = input.value * 2 + 1
 */
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { runServerHarness as runHarness } from '../../src/server/index.js';
import { buildNumber, isPureNumber } from 'runtime';

const fixture = resolve(__dirname, '../fixtures/two-scene-route.json');

function numVal(v: unknown): number | undefined {
  if (v && typeof v === 'object' && 'value' in v && typeof (v as { value: unknown }).value === 'number') {
    return (v as { value: number }).value;
  }
  return undefined;
}

// ─── two-scene route ──────────────────────────────────────────────────────────

describe('route — two-scene pipeline', () => {
  it('executes both scenes and produces value * 2 + 1', async () => {
    const { finalState } = await runHarness({
      jsonFile: fixture,
      entryId: 'main_route',
      initialState: { 'input.value': buildNumber(10) },
    });

    expect(numVal(finalState['output.result'])).toBe(21); // 10*2+1
  });

  it('works for different input values', async () => {
    const { finalState } = await runHarness({
      jsonFile: fixture,
      entryId: 'main_route',
      initialState: { 'input.value': buildNumber(7) },
    });

    expect(numVal(finalState['output.result'])).toBe(15); // 7*2+1
  });
});

describe('route — schema default state', () => {
  it('uses schema default (value=0) when no initialState override provided', async () => {
    const { finalState } = await runHarness({
      jsonFile: fixture,
      entryId: 'main_route',
      initialState: {},
    });

    // schema default input.value = 0 → 0*2+1 = 1
    expect(numVal(finalState['output.result'])).toBe(1);
  });
});

describe('route — trace', () => {
  it('returns a route trace with kind = "route"', async () => {
    const result = await runHarness({
      jsonFile: fixture,
      entryId: 'main_route',
      initialState: { 'input.value': buildNumber(5) },
    });

    expect(result.trace.kind).toBe('route');
  });

  it('trace contains both scene_a and scene_b', async () => {
    const result = await runHarness({
      jsonFile: fixture,
      entryId: 'main_route',
      initialState: { 'input.value': buildNumber(5) },
    });

    if (result.trace.kind !== 'route') throw new Error('expected route trace');
    const sceneIds = result.trace.route.scenes.map((s) => s.sceneId);
    expect(sceneIds).toContain('scene_a');
    expect(sceneIds).toContain('scene_b');
  });

  it('trace has scene_a before scene_b', async () => {
    const result = await runHarness({
      jsonFile: fixture,
      entryId: 'main_route',
      initialState: { 'input.value': buildNumber(3) },
    });

    if (result.trace.kind !== 'route') throw new Error('expected route trace');
    const sceneIds = result.trace.route.scenes.map((s) => s.sceneId);
    expect(sceneIds.indexOf('scene_a')).toBeLessThan(sceneIds.indexOf('scene_b'));
  });
});

describe('route — STATE propagation', () => {
  it('scene_b can read the value written by scene_a', async () => {
    // Intermediate: after scene_a, output.result = 10*2 = 20.
    // scene_b reads output.result (20) and writes 20+1 = 21.
    const { finalState } = await runHarness({
      jsonFile: fixture,
      entryId: 'main_route',
      initialState: { 'input.value': buildNumber(10) },
    });

    const result = finalState['output.result'];
    expect(isPureNumber(result!) && result.value).toBe(21);
  });
});

describe('route — finalState snapshot', () => {
  it('finalState is a plain Record<string, AnyValue>', async () => {
    const { finalState } = await runHarness({
      jsonFile: fixture,
      entryId: 'main_route',
      initialState: { 'input.value': buildNumber(2) },
    });

    expect(typeof finalState).toBe('object');
    expect(finalState['output.result']).toBeDefined();
    expect(finalState['input.value']).toBeDefined();
  });
});

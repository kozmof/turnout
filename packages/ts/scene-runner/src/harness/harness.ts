import type { HarnessOptions, HarnessResult } from '../types/harness-types.js';
import { StateManager } from '../state/state-manager.js';
import { executeScene } from '../executor/scene-executor.js';
import { executeRoute } from '../executor/route-executor.js';

/**
 * Universal harness entry point (client + server).
 *
 * Accepts a pre-parsed TurnModel, builds STATE, then dispatches to the route
 * or scene executor based on `entryId`.
 *
 * To load a model from a .turn or .json file (Node.js only), use
 * `runServerHarness` from the server entry point instead.
 *
 * Dispatch rules:
 *  - `entryId` matches a `route.id`  → `executeRoute` (entry scene = first in model)
 *  - `entryId` matches a `scene.id`  → `executeScene`  (single-scene mode)
 *  - no match                         → throws
 */
export function runHarness(options: HarnessOptions): HarnessResult {
  const { model } = options;

  // ── 1. Build STATE ────────────────────────────────────────────────────────
  // When the model has a state schema, seed it with declared defaults then
  // apply the caller-supplied overrides. When there is no schema (the spec
  // examples omit a state {} block), use the provided values directly.
  const state: StateManager = model.state
    ? StateManager.fromSchema(model.state, options.initialState)
    : StateManager.from(options.initialState);

  // ── 2. Build lookup maps ─────────────────────────────────────────────────
  const sceneMap = Object.fromEntries(model.scenes.map((s) => [s.id, s]));
  const routeMap = Object.fromEntries((model.routes ?? []).map((r) => [r.id, r]));

  // ── 3a. Route mode ────────────────────────────────────────────────────────
  const route = routeMap[options.entryId];
  if (route) {
    const entrySceneId = model.scenes[0]?.id;
    if (!entrySceneId) {
      throw new Error(`runHarness: route "${options.entryId}" found but model has no scenes`);
    }
    const result = executeRoute(route, sceneMap, entrySceneId, state, options.hooks);
    return {
      finalState: result.finalState,
      trace: { kind: 'route', route: result.trace },
      model,
    };
  }

  // ── 3b. Scene mode ────────────────────────────────────────────────────────
  const scene = sceneMap[options.entryId];
  if (scene) {
    const result = executeScene(scene, state, options.hooks);
    return {
      finalState: result.stateAfterScene.snapshot(),
      trace: { kind: 'scene', scene: result.trace },
      model,
    };
  }

  throw new Error(
    `runHarness: entryId "${options.entryId}" not found as route or scene in the model`,
  );
}

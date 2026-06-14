import type { HarnessOptions, FullHarnessResult } from '../types/harness-types.js';
import { stateManagerFromUnchecked, stateManagerFromSchema } from '../state/state-manager.js';
import type { StateManager } from '../state/state-manager.js';
import { executeScene } from '../executor/scene-executor.js';
import { executeRoute } from '../executor/route-executor.js';
import { resolveDispatchTarget } from '../executor/dispatch.js';
import { migrateModel } from '../migration.js';
import { validateModel } from '../executor/validate-model.js';
import { ModelValidationError } from '../executor/errors.js';

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
 *  - `entryId` matches a `route.id`  → `executeRoute`
 *  - `entryId` matches a `scene.id`  → `executeScene`
 *  - no match                         → throws
 */
export async function runHarness(options: HarnessOptions): Promise<FullHarnessResult> {
  const model = migrateModel(options.model);
  const validationErrors = validateModel(model);
  if (validationErrors.length > 0) {
    throw new ModelValidationError(validationErrors);
  }

  // ── 1. Build STATE ────────────────────────────────────────────────────────
  const state: StateManager = model.state
    ? stateManagerFromSchema(model.state, options.initialState)
    : stateManagerFromUnchecked(options.initialState);

  // ── 2. Resolve dispatch target ────────────────────────────────────────────
  const target = resolveDispatchTarget(model, options.entryId);
  const sceneMap = Object.fromEntries(model.scenes.map((s) => [s.id, s]));

  // ── 3. Execute ────────────────────────────────────────────────────────────
  if (target.kind === 'route') {
    const result = await executeRoute(
      target.route,
      sceneMap,
      target.entryScene.id,
      state,
      options.hooks,
      { maxSceneSteps: options.maxSceneSteps, maxRouteTransitions: options.maxRouteTransitions },
    );
    return { finalState: result.finalState, trace: { kind: 'route', route: result.trace }, model: options.model };
  }

  const result = await executeScene(
    target.scene,
    state,
    options.hooks,
    undefined,
    options.maxSceneSteps,
  );
  return {
    finalState: result.stateAfterScene.snapshot(),
    trace: { kind: 'scene', scene: result.trace },
    model: options.model,
  };
}

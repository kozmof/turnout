import type { AnyValue } from 'runtime';
import type { RouteModel, SceneBlock } from '../types/turnout-model_pb.js';
import type { StateManager } from '../state/state-manager.js';
import type { HookRegistry, RouteTrace } from '../types/harness-types.js';
import { executeScene } from './scene-executor.js';
import { selectNextScene } from './route-pattern.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type RouteExecutionResult = {
  routeId: string;
  finalState: Record<string, AnyValue>;
  history: string[];
  trace: RouteTrace;
  /** Terminal state — route exits when no match arm fires. */
  status: 'completed';
};

// ─────────────────────────────────────────────────────────────────────────────
// Route executor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a route by looping over scenes until no match arm fires.
 *
 * STATE is shared across scene boundaries and never reset between scenes.
 * Route history grows with one `"scene_id.action_id"` entry per completed action.
 *
 * @param route         - The route definition (id + match arms).
 * @param scenes        - Map of scene id → SceneBlock for all scenes reachable by this route.
 * @param entrySceneId  - The first scene to enter.
 * @param state         - The initial STATE (typically built from the model's state schema).
 * @param hooks         - Optional hook registry passed through to each scene execution.
 */
export function executeRoute(
  route: RouteModel,
  scenes: Record<string, SceneBlock>,
  entrySceneId: string,
  state: StateManager,
  hooks: HookRegistry = {},
): RouteExecutionResult {
  const history: string[] = [];
  const sceneTraces: RouteTrace['scenes'] = [];
  let currentSceneId = entrySceneId;

  for (;;) {
    const scene = scenes[currentSceneId];
    if (!scene) throw new Error(`Route "${route.id}": unknown scene "${currentSceneId}"`);

    // Route-driven entry: only the first declared entry action fires (spec §route-entry).
    const routeEntry = scene.entryActions[0];
    if (!routeEntry) throw new Error(`Route "${route.id}": scene "${currentSceneId}" has no entry actions`);
    const sceneResult = executeScene(scene, state, hooks, [routeEntry]);
    state = sceneResult.stateAfterScene;
    sceneTraces.push(sceneResult.trace);

    // Append all completed actions to the route history (spec §2.3).
    for (const actionTrace of sceneResult.trace.actions) {
      history.push(`${currentSceneId}.${actionTrace.actionId}`);
    }

    // Evaluate match arms against history, restricting to patterns for the current scene.
    const nextSceneId = selectNextScene(history, route.match, currentSceneId);
    if (nextSceneId === null) break; // No arm matched — route completes.

    currentSceneId = nextSceneId;
  }

  return {
    routeId: route.id,
    finalState: state.snapshot(),
    history,
    trace: { routeId: route.id, scenes: sceneTraces },
    status: 'completed',
  };
}

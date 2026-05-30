import type { AnyValue } from 'runtime';
import type { RouteModel, SceneBlock } from '../types/turnout-model_pb.js';
import type { StateManager } from '../state/state-manager.js';
import type { HookRegistry, RouteTrace } from '../types/harness-types.js';
import { executeScene } from './scene-executor.js';
import { selectNextScene, parseMatchArms } from './route-pattern.js';
import { RouteRuntimeError } from './errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type RouteExecutionOptions = {
  /** Maximum action steps allowed per scene execution. Defaults to scene executor default. */
  maxSceneSteps?: number;
  /** Maximum scene transitions before aborting a route. Defaults to 1,000. */
  maxRouteTransitions?: number;
};

const DEFAULT_MAX_ROUTE_TRANSITIONS = 1_000;

export type RouteExecutionResult = {
  routeId: string;
  finalState: Record<string, AnyValue>;
  history: string[];
  trace: RouteTrace;
  /** Terminal state — route exits when no match arm fires. */
  status: 'completed';
  /** Non-fatal warnings produced during route execution. */
  warnings?: string[];
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
export async function executeRoute(
  route: RouteModel,
  scenes: Record<string, SceneBlock>,
  entrySceneId: string,
  state: StateManager,
  hooks: HookRegistry = { prepare: {}, publish: {} },
  options: RouteExecutionOptions = {},
): Promise<RouteExecutionResult> {
  const maxRouteTransitions = options.maxRouteTransitions ?? DEFAULT_MAX_ROUTE_TRANSITIONS;
  const parsedArms = parseMatchArms(route.match);
  let routeTransitionCount = 0;
  const history: string[] = [];
  const sceneTraces: RouteTrace['scenes'] = [];
  const warnings: string[] = [];
  let currentSceneId = entrySceneId;

  for (;;) {
    const scene = scenes[currentSceneId];
    if (!scene) throw new RouteRuntimeError('UnknownScene', route.id, `unknown scene "${currentSceneId}"`);

    // Route-driven entry: only the first declared entry action fires (spec §route-entry).
    if (scene.entryActions.length > 1) {
      warnings.push(
        `route "${route.id}" scene "${currentSceneId}": only the first entry action fires in route-driven execution (${scene.entryActions.length} declared)`,
      );
    }
    const routeEntry = scene.entryActions[0];
    if (!routeEntry) throw new RouteRuntimeError('NoEntryAction', route.id, `scene "${currentSceneId}" has no entry actions`);
    const sceneResult = await executeScene(scene, state, hooks, [routeEntry], options.maxSceneSteps);
    state = sceneResult.stateAfterScene;
    sceneTraces.push(sceneResult.trace);

    // Build the current-scene history slice used for pattern matching.
    // Using only the current visit's actions (not accumulated global history) ensures
    // that revisited scenes match against their current run, consistent with RouteStepper.
    const sceneHistory = sceneResult.trace.actions.map(
      (a) => `${currentSceneId}.${a.actionId}`,
    );

    // Append to the global history accumulator (exposed on the result for callers).
    history.push(...sceneHistory);

    // Evaluate match arms against the current-scene slice only.
    const nextSceneId = selectNextScene(sceneHistory, parsedArms, currentSceneId);
    if (nextSceneId === null) break; // No arm matched — route completes.

    routeTransitionCount++;
    if (routeTransitionCount > maxRouteTransitions) {
      throw new RouteRuntimeError(
        'MaxRouteTransitionsExceeded',
        route.id,
        `exceeded ${maxRouteTransitions} scene transitions — possible infinite loop`,
      );
    }

    currentSceneId = nextSceneId;
  }

  return {
    routeId: route.id,
    finalState: state.snapshot(),
    history,
    trace: { routeId: route.id, scenes: sceneTraces },
    status: 'completed',
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

import type { AnyValue } from "runtime";
import type { RouteModel, SceneBlock } from "../types/turnout-model_pb.js";
import type { StateManager } from "../state/state-manager.js";
import type { HookRegistry, RouteTrace, SceneWarning } from "../types/harness-types.js";
import { executeScene } from "./scene-executor.js";
import { selectNextScene, parseMatchArms } from "./route-pattern.js";
import type { HistoryEntry } from "./route-pattern.js";
import { RouteRuntimeError } from "./errors.js";

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

/**
 * Structured warning type for route execution. Use `kind` to filter programmatically
 * instead of parsing warning strings.
 */
export type RouteWarning =
  | { kind: "multi_entry_action"; sceneId: string; entryActions: string[] }
  | { kind: "scene_warning"; sceneId: string; warning: SceneWarning };

export type RouteExecutionResult = {
  routeId: string;
  finalState: Record<string, AnyValue>;
  history: string[];
  trace: RouteTrace;
  /** Terminal state — route exits when no match arm fires. */
  status: "completed";
  /** Structured non-fatal warnings produced during route execution. */
  warnings?: RouteWarning[];
};

/**
 * Discriminated union returned by `executeRouteSafe`.
 * On failure, `partialState` holds the state after all successfully completed
 * scenes, and `failedSceneId` identifies the scene that was executing.
 */
export type RouteResult =
  | { ok: true; value: RouteExecutionResult }
  | {
      ok: false;
      error: unknown;
      /** State after all successfully completed scenes. */
      partialState: Record<string, AnyValue>;
      /** ID of the scene that was executing when the error occurred. */
      failedSceneId: string;
    };

// ─────────────────────────────────────────────────────────────────────────────
// Mutable progress holder — threads last-committed state/sceneId to catch blocks
// ─────────────────────────────────────────────────────────────────────────────

type RouteProgress = {
  currentSceneId: string;
  currentState: StateManager;
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared core loop
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Internal implementation of the route execution loop shared by `executeRoute`
 * and `executeRouteSafe`. `progress` is mutated on each successful scene
 * completion so callers can inspect the last committed state/sceneId on error.
 */
async function runRouteCore(
  route: RouteModel,
  scenes: Record<string, SceneBlock>,
  hooks: HookRegistry,
  options: RouteExecutionOptions,
  progress: RouteProgress,
): Promise<RouteExecutionResult> {
  const maxRouteTransitions = options.maxRouteTransitions ?? DEFAULT_MAX_ROUTE_TRANSITIONS;
  const parsedArms = parseMatchArms(route.match);
  let routeTransitionCount = 0;
  const history: string[] = [];
  const sceneTraces: RouteTrace["scenes"] = [];
  const warnings: RouteWarning[] = [];

  for (;;) {
    const scene = scenes[progress.currentSceneId];
    if (!scene)
      throw new RouteRuntimeError(
        "UnknownScene",
        route.id,
        `unknown scene "${progress.currentSceneId}"`,
      );

    // Route-driven entry: only the first declared entry action fires (spec §route-entry).
    if (scene.entryActions.length > 1) {
      warnings.push({
        kind: "multi_entry_action",
        sceneId: progress.currentSceneId,
        entryActions: scene.entryActions,
      });
    }
    const routeEntry = scene.entryActions[0];
    if (!routeEntry)
      throw new RouteRuntimeError(
        "NoEntryAction",
        route.id,
        `scene "${progress.currentSceneId}" has no entry actions`,
      );

    const sceneResult = await executeScene(
      scene,
      progress.currentState,
      hooks,
      [routeEntry],
      options.maxSceneSteps,
    );
    // Commit state and record scene id only after a scene fully completes —
    // partial states stay at the last successfully committed scene boundary.
    progress.currentState = sceneResult.stateAfterScene;
    sceneTraces.push(sceneResult.trace);

    // Propagate scene-level warnings into structured route warnings.
    if (sceneResult.trace.warnings) {
      for (const warning of sceneResult.trace.warnings) {
        warnings.push({ kind: "scene_warning", sceneId: progress.currentSceneId, warning });
      }
    }

    // Build the current-scene history slice used for pattern matching.
    // Using only the current visit's actions (not accumulated global history) ensures
    // that revisited scenes match against their current run, consistent with RouteStepper.
    const sceneHistory: HistoryEntry[] = sceneResult.trace.actions.map((a) => ({
      sceneId: progress.currentSceneId,
      actionId: a.actionId,
    }));

    // Append to the global history accumulator (exposed on the result for callers).
    history.push(...sceneHistory.map((e) => `${e.sceneId}.${e.actionId}`));

    // Evaluate match arms against the current-scene slice only.
    const nextSceneId = selectNextScene(sceneHistory, parsedArms, progress.currentSceneId);
    if (nextSceneId === null) break; // No arm matched — route completes.

    routeTransitionCount++;
    if (routeTransitionCount >= maxRouteTransitions) {
      throw new RouteRuntimeError(
        "MaxRouteTransitionsExceeded",
        route.id,
        `exceeded ${maxRouteTransitions} scene transitions — possible infinite loop`,
      );
    }

    progress.currentSceneId = nextSceneId;
  }

  return {
    routeId: route.id,
    finalState: progress.currentState.snapshot(),
    history,
    trace: { routeId: route.id, scenes: sceneTraces },
    status: "completed",
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
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
  const progress: RouteProgress = { currentSceneId: entrySceneId, currentState: state };
  return runRouteCore(route, scenes, hooks, options, progress);
}

/**
 * Like `executeRoute` but catches errors and returns a discriminated union
 * instead of throwing. `partialState` holds the STATE after all successfully
 * completed scenes so callers can inspect progress up to the failure point.
 */
export async function executeRouteSafe(
  route: RouteModel,
  scenes: Record<string, SceneBlock>,
  entrySceneId: string,
  state: StateManager,
  hooks: HookRegistry = { prepare: {}, publish: {} },
  options: RouteExecutionOptions = {},
): Promise<RouteResult> {
  const progress: RouteProgress = { currentSceneId: entrySceneId, currentState: state };
  try {
    return { ok: true, value: await runRouteCore(route, scenes, hooks, options, progress) };
  } catch (err) {
    return {
      ok: false,
      error: err,
      partialState: progress.currentState.snapshot(),
      failedSceneId: progress.currentSceneId,
    };
  }
}

import type { AnyValue } from "turnout-runtime";
import type { RouteModel, SceneBlock } from "./types/turnout-model_pb.js";
import type { StateManager } from "./state/state-manager.js";
import type {
  ExecutionWarning,
  HookRegistry,
  LogEvent,
  RouteTrace,
} from "./types/harness-types.js";
import { RouteRuntimeError } from "./errors.js";
import { createRouteRunner } from "./runner.js";
import { registerHooks } from "./register-hooks.js";
import { defined } from "./defined.js";
import { drainRunner, errorField, withoutLifecycleLogs } from "./safe-execution.js";

export type RouteExecutionOptions = {
  maxSceneSteps?: number | undefined;
  maxRouteTransitions?: number | undefined;
  signal?: AbortSignal | undefined;
  onLog?: ((event: LogEvent) => void) | undefined;
  failOnPublishError?: boolean | undefined;
};

export type RouteExecutionResult = {
  routeId: string;
  finalState: Record<string, AnyValue>;
  history: string[];
  trace: RouteTrace;
  status: "completed";
  warnings?: ExecutionWarning[];
};

export type RouteResult =
  | { ok: true; value: RouteExecutionResult }
  | {
      ok: false;
      error: RouteRuntimeError | Error;
      /**
       * STATE as of the last committed action.
       *
       * A `StateManager`, matching `SceneResult.partialState`. It used to be a
       * plain `Record<string, AnyValue>` here and a `StateManager` there — the
       * same field name, on the failure branch of two sibling functions,
       * holding two different types. Call `.snapshot()` for the record.
       */
      partialState: StateManager;
      failedSceneId: string;
    };

/** Run one route through the Zig runtime and capture failures with their partial state. */
export async function executeRouteSafe(
  route: RouteModel,
  scenes: Record<string, SceneBlock>,
  entrySceneId: string,
  state: StateManager,
  hooks: HookRegistry = { prepare: {}, extend: {}, publish: {} },
  options: RouteExecutionOptions = {},
): Promise<RouteResult> {
  let runner: ReturnType<typeof createRouteRunner> | undefined;
  let activeSceneId = entrySceneId;
  try {
    const entryScene = scenes[entrySceneId];
    if (entryScene === undefined) {
      throw new RouteRuntimeError("UnknownScene", route.id, 'unknown scene "' + entrySceneId + '"');
    }
    if (!entryScene.entryAction) {
      throw new RouteRuntimeError(
        "NoEntryAction",
        route.id,
        'scene "' + entrySceneId + '" has no entry action',
      );
    }
    runner = createRouteRunner(
      route,
      entryScene,
      scenes,
      {
        entryId: route.id,
        initialState: state.snapshot(),
        allowUncheckedState: true,
        ...defined({
          maxSceneSteps: options.maxSceneSteps,
          maxRouteTransitions: options.maxRouteTransitions,
          signal: options.signal,
          onLog: withoutLifecycleLogs(options.onLog, [
            "scene-start",
            "scene-complete",
            "route-transition",
          ]),
          failOnPublishError: options.failOnPublishError,
        }),
      },
      state,
    );
    registerHooks(runner, hooks);
    await drainRunner(runner, (step) => {
      if (step.kind === "scene-transition") activeSceneId = step.toSceneId;
      if (step.kind === "action") activeSceneId = step.sceneId;
    });
    const result = runner.result();
    const trace = result.trace.kind === "route" ? result.trace.route : undefined;
    if (trace === undefined) throw new Error("Route runner returned a scene trace");
    return {
      ok: true,
      value: {
        routeId: route.id,
        finalState: result.finalState,
        history: trace.scenes.flatMap((scene) =>
          scene.actions.map((action) => `${scene.sceneId}.${action.actionId}`),
        ),
        trace,
        status: "completed",
        ...defined({ warnings: result.warnings }),
      },
    };
  } catch (caught) {
    return {
      ok: false,
      error: caught instanceof Error ? caught : new Error(String(caught)),
      partialState: runner?.partialState() ?? state,
      failedSceneId: errorField(caught, "sceneId") ?? activeSceneId,
    };
  }
}

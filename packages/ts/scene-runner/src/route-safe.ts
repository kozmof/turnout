import type { AnyValue } from "runtime";
import type { RouteModel, SceneBlock } from "./types/turnout-model_pb.js";
import type { StateManager } from "./state/state-manager.js";
import type {
  ExecutionWarning,
  HookRegistry,
  LogEvent,
  RouteTrace,
} from "./types/harness-types.js";
import { createRouteRunner } from "./runner.js";

export type RouteExecutionOptions = {
  maxSceneSteps?: number;
  maxRouteTransitions?: number;
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
      error: unknown;
      partialState: Record<string, AnyValue>;
      failedSceneId: string;
    };

/** Run one route through the Zig runtime and capture failures with their partial state. */
export async function executeRouteSafe(
  route: RouteModel,
  scenes: Record<string, SceneBlock>,
  entrySceneId: string,
  state: StateManager,
  hooks: HookRegistry = { prepare: {}, publish: {} },
  options: RouteExecutionOptions = {},
): Promise<RouteResult> {
  let runner: ReturnType<typeof createRouteRunner> | undefined;
  let activeSceneId = entrySceneId;
  try {
    const entryScene = scenes[entrySceneId];
    if (entryScene === undefined) throw new Error(`unknown scene ""`);
    if (!entryScene.entryAction) {
      throw new Error(`scene "" has no entry action`);
    }
    runner = createRouteRunner(
      route,
      entryScene,
      scenes,
      {
        entryId: route.id,
        initialState: state.snapshot(),
        allowUncheckedState: true,
        ...(options.maxSceneSteps === undefined ? {} : { maxSceneSteps: options.maxSceneSteps }),
        ...(options.maxRouteTransitions === undefined
          ? {}
          : { maxRouteTransitions: options.maxRouteTransitions }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(options.onLog === undefined
          ? {}
          : { onLog: (event: LogEvent) => forwardLegacyLog(options.onLog, event) }),
        ...(options.failOnPublishError === undefined
          ? {}
          : { failOnPublishError: options.failOnPublishError }),
      },
      state,
    );
    registerHooks(runner, hooks);
    while (!runner.isDone()) {
      for (const event of await runner.next()) {
        if (event.kind === "scene-transition") activeSceneId = event.toSceneId;
        if (event.kind === "action") activeSceneId = event.sceneId;
      }
    }
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
        ...(result.warnings === undefined ? {} : { warnings: result.warnings }),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error,
      partialState: runner?.partialState().snapshot() ?? state.snapshot(),
      failedSceneId: sceneIdFromError(error) ?? activeSceneId,
    };
  }
}

function forwardLegacyLog(onLog: ((event: LogEvent) => void) | undefined, event: LogEvent): void {
  if (
    event.kind !== "scene-start" &&
    event.kind !== "scene-complete" &&
    event.kind !== "route-transition"
  ) {
    onLog?.(event);
  }
}

function registerHooks(runner: ReturnType<typeof createRouteRunner>, hooks: HookRegistry): void {
  for (const [name, handler] of Object.entries(hooks.prepare)) runner.usePrepareHook(name, handler);
  for (const [name, handler] of Object.entries(hooks.publish)) runner.usePublishHook(name, handler);
}

function sceneIdFromError(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "sceneId" in error &&
    typeof error.sceneId === "string"
    ? error.sceneId
    : undefined;
}

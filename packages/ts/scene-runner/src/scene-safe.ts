import type { SceneBlock } from "./types/turnout-model_pb.js";
import type { StateManager } from "./state/state-manager.js";
import type { HookRegistry, LogEvent, SceneTrace } from "./types/harness-types.js";
import { SceneRuntimeError } from "./errors.js";
import { createSceneRunner } from "./runner.js";

export type SceneExecutionResult = {
  sceneId: string;
  stateAfterScene: StateManager;
  trace: SceneTrace;
  /** Action IDs that reached a terminal state with no matching next rule. */
  terminatedAt: string[];
};

export type SceneExecutionOptions = {
  signal?: AbortSignal | undefined;
  onLog?: ((event: LogEvent) => void) | undefined;
  failOnPublishError?: boolean | undefined;
};

export type SceneResult =
  | { ok: true; value: SceneExecutionResult }
  | {
      ok: false;
      error: SceneRuntimeError | Error;
      partialState: StateManager;
      failedActionId: string;
    };

/** Run one scene through the Zig runtime and capture failures with their partial state. */
export async function executeSceneSafe(
  scene: SceneBlock,
  state: StateManager,
  hooks: HookRegistry = { prepare: {}, publish: {} },
  maxSteps?: number,
  options: SceneExecutionOptions = {},
): Promise<SceneResult> {
  let runner: ReturnType<typeof createSceneRunner> | undefined;
  let pendingActionId = scene.entryAction || undefined;
  try {
    validateScene(scene);
    runner = createSceneRunner(
      scene,
      {
        entryId: scene.id,
        initialState: state.snapshot(),
        allowUncheckedState: true,
        ...(maxSteps === undefined ? {} : { maxSceneSteps: maxSteps }),
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
        if (event.kind === "action") pendingActionId = event.trace.nextActionIds[0];
      }
    }
    const result = runner.result();
    const trace = result.trace.kind === "scene" ? result.trace.scene : undefined;
    if (trace === undefined) throw new Error("Scene runner returned a route trace");
    return {
      ok: true,
      value: {
        sceneId: scene.id,
        stateAfterScene: runner.partialState(),
        trace,
        terminatedAt: trace.actions
          .filter((action) => action.nextActionIds.length === 0)
          .map((action) => action.actionId),
      },
    };
  } catch (caught) {
    const error = normalizeError(caught, scene.id, pendingActionId);
    return {
      ok: false,
      error,
      partialState: runner?.partialState() ?? state,
      failedActionId: actionIdFromError(caught) ?? pendingActionId ?? "<none>",
    };
  }
}

function validateScene(scene: SceneBlock): void {
  if (!scene.entryAction) {
    throw new SceneRuntimeError("NoEntryAction", scene.id, "scene declares no entry action");
  }
  const seen = new Set<string>();
  for (const action of scene.actions) {
    if (seen.has(action.id)) {
      throw new SceneRuntimeError(
        "DuplicateActionId",
        scene.id,
        'duplicate action id "' + action.id + '"',
        {
          actionId: action.id,
        },
      );
    }
    seen.add(action.id);
  }
}

function forwardLegacyLog(onLog: ((event: LogEvent) => void) | undefined, event: LogEvent): void {
  if (event.kind !== "scene-start" && event.kind !== "scene-complete") onLog?.(event);
}

function registerHooks(runner: ReturnType<typeof createSceneRunner>, hooks: HookRegistry): void {
  for (const [name, handler] of Object.entries(hooks.prepare)) runner.usePrepareHook(name, handler);
  for (const [name, handler] of Object.entries(hooks.publish)) runner.usePublishHook(name, handler);
}

function normalizeError(
  caught: unknown,
  sceneId: string,
  actionId: string | undefined,
): SceneRuntimeError | Error {
  const code = legacySceneErrorCode(errorCode(caught));
  if (isSceneErrorCode(code)) {
    const detail = code === "NoEntryAction" ? "scene declares no entry action" : code;
    return new SceneRuntimeError(
      code,
      sceneId,
      detail,
      actionId === undefined ? undefined : { actionId },
    );
  }
  return caught instanceof Error ? caught : new Error(String(caught));
}

function errorCode(caught: unknown): string | undefined {
  return typeof caught === "object" &&
    caught !== null &&
    "code" in caught &&
    typeof caught.code === "string"
    ? caught.code
    : undefined;
}

function legacySceneErrorCode(code: string | undefined): string | undefined {
  if (code === "ActionNotFound") return "UnknownAction";
  if (code === "SceneNotFound") return "UnknownAction";
  return code;
}

function isSceneErrorCode(code: string | undefined): code is SceneRuntimeError["code"] {
  return (
    code !== undefined &&
    [
      "UnknownAction",
      "MaxStepsExceeded",
      "UnknownFunction",
      "DuplicateActionId",
      "UnknownArgModel",
      "PublishHookFailed",
      "OutOfOrderBinding",
      "CompilerBug",
      "UnsupportedConstruct",
      "IncompleteScene",
      "NoEntryAction",
    ].includes(code)
  );
}

function actionIdFromError(caught: unknown): string | undefined {
  if (typeof caught !== "object" || caught === null) return undefined;
  if ("actionId" in caught && typeof caught.actionId === "string") return caught.actionId;
  if (!("context" in caught) || typeof caught.context !== "object" || caught.context === null) {
    return undefined;
  }
  return "actionId" in caught.context && typeof caught.context.actionId === "string"
    ? caught.context.actionId
    : undefined;
}

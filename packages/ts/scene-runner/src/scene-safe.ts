import type { SceneBlock } from "./types/turnout-model_pb.js";
import type { StateManager } from "./state/state-manager.js";
import type { HookRegistry, LogEvent, SceneTrace } from "./types/harness-types.js";
import { SceneRuntimeError, isSceneErrorCode } from "./errors.js";
import { createSceneRunner } from "./runner.js";
import { registerHooks } from "./register-hooks.js";
import { defined } from "./defined.js";
import {
  drainRunner,
  errorField,
  errorFieldOrContext,
  withoutLifecycleLogs,
} from "./safe-execution.js";

export type SceneExecutionResult = {
  sceneId: string;
  stateAfterScene: StateManager;
  trace: SceneTrace;
  /** Action IDs that reached a terminal state with no matching next rule. */
  terminatedAt: string[];
};

export type SceneExecutionOptions = {
  /** Maximum action steps allowed for this scene. */
  maxSceneSteps?: number | undefined;
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

/**
 * Run one scene through the Zig runtime and capture failures with their partial state.
 *
 * The step limit is `options.maxSceneSteps` rather than a positional argument:
 * it used to be the fourth parameter here and an option in `executeRouteSafe`,
 * so calling this with only a log handler read `executeSceneSafe(scene, state,
 * undefined, undefined, { onLog })`.
 */
export async function executeSceneSafe(
  scene: SceneBlock,
  state: StateManager,
  hooks: HookRegistry = { prepare: {}, extend: {}, publish: {} },
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
        ...defined({
          maxSceneSteps: options.maxSceneSteps,
          signal: options.signal,
          onLog: withoutLifecycleLogs(options.onLog, ["scene-start", "scene-complete"]),
          failOnPublishError: options.failOnPublishError,
        }),
      },
      state,
    );
    registerHooks(runner, hooks);
    await drainRunner(runner, (step) => {
      if (step.kind === "action") pendingActionId = step.trace.nextActionIds[0];
    });
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
    return {
      ok: false,
      error: normalizeError(caught, scene.id, pendingActionId),
      partialState: runner?.partialState() ?? state,
      failedActionId: errorFieldOrContext(caught, "actionId") ?? pendingActionId ?? "<none>",
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

function normalizeError(
  caught: unknown,
  sceneId: string,
  actionId: string | undefined,
): SceneRuntimeError | Error {
  const code = hostSceneErrorCode(errorField(caught, "code"));
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

/**
 * Maps an engine error name onto the host code that names the same condition.
 *
 * This is the rename site `spec/error-codes.json` points at, and its `renamed`
 * section is where each pair is recorded with the reason for the re-wording.
 * `scripts/check-error-codes.mjs` asserts that every pair listed there is
 * actually implemented here, so a mapping cannot be dropped from this function
 * without the gate noticing.
 *
 * It was called `legacySceneErrorCode`, which read as a compatibility shim left
 * over from an older vocabulary. It is the opposite: a deliberate, gated
 * translation, and deleting it would break the gate and lose the rename.
 */
function hostSceneErrorCode(code: string | undefined): string | undefined {
  if (code === "ActionNotFound") return "UnknownAction";
  if (code === "SceneNotFound") return "UnknownAction";
  return code;
}

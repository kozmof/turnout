import type { SceneBlock, ActionModel } from "../types/turnout-model_pb.js";
import type { StateManager } from "../state/state-manager.js";
import type {
  HookRegistry,
  ActionTrace,
  SceneTrace,
  ActionWarning,
  SceneWarning,
  LogEvent,
} from "../types/harness-types.js";
import { executeAction } from "./action-executor.js";
import { type ActionExecutionResult, UNABORTABLE } from "./types.js";
import { isPublishHookFailedError, SceneRuntimeError } from "./errors.js";
import { parseNextPolicy } from "./next-policy.js";
import { snapshotModel } from "../model-snapshot.js";
import { createRunState, enqueueNext } from "./run-state.js";
import { evaluateNextRules } from "./next-rules.js";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type SceneExecutionResult = {
  sceneId: string;
  stateAfterScene: StateManager;
  trace: SceneTrace;
  /** Action IDs that reached a terminal state (no matching next rule). */
  terminatedAt: string[];
};

export type StepResult = { done: false; trace: ActionTrace } | { done: true };

export type SceneExecutionOptions = {
  signal?: AbortSignal | undefined;
  onLog?: ((event: LogEvent) => void) | undefined;
  /**
   * When `true`, a publish hook that throws aborts execution with a
   * `SceneRuntimeError("PublishHookFailed")` instead of being recorded as a
   * failed `publishOutcome` and continuing. Defaults to `false`.
   */
  failOnPublishError?: boolean | undefined;
};

/**
 * Discriminated union returned by `executeSceneSafe`. Callers that prefer
 * throwing semantics should use `executeScene` instead.
 *
 * `error` is `SceneRuntimeError | Error`: expected executor errors arrive as
 * `SceneRuntimeError`; unexpected throws are wrapped in a plain `Error` so
 * `partialState` is always available on failure.
 */
export type SceneResult =
  | { ok: true; value: SceneExecutionResult }
  | {
      ok: false;
      error: SceneRuntimeError | Error;
      /** State at the point of failure (after any successfully completed actions). */
      partialState: StateManager;
      /** ID of the action that was executing when the error occurred. */
      failedActionId: string;
    };

// ─────────────────────────────────────────────────────────────────────────────
// Scene executor — manual stepping API
// ─────────────────────────────────────────────────────────────────────────────

export type SceneExecutor = {
  readonly isDone: () => boolean;
  /** Execute the next pending action. Returns `{ done: true }` when the queue is empty. */
  readonly next: () => Promise<StepResult>;
  /** Returns the final result. Throws if the scene is not yet complete. */
  readonly result: () => SceneExecutionResult;
  /** Returns the current accumulated state. Available at any point during execution. */
  readonly partialState: () => StateManager;
  /** ID of the action currently being attempted, if any. */
  readonly currentActionId: () => string | undefined;
  /**
   * Returns scene-level warnings accumulated so far (e.g. duplicate-enqueue warnings).
   * Safe to call at any time — before, during, or after execution.
   * Callers that exit early via `next()` without calling `result()` can use this
   * to surface warnings that would otherwise only appear in `SceneTrace.warnings`.
   */
  readonly currentWarnings: () => readonly SceneWarning[];
};

/** Default maximum number of action steps before aborting to prevent infinite loops. */
const DEFAULT_MAX_STEPS = 10_000;

// Module-level cache: SceneBlock is immutable once built, so the action map
// derived from it never changes. Keyed by object identity via WeakMap so the
// entry is GC'd when the scene is no longer referenced.
const actionMapCache = new WeakMap<SceneBlock, Record<string, ActionModel>>();

function getActionMap(scene: SceneBlock): Record<string, ActionModel> {
  let m = actionMapCache.get(scene);
  if (!m) {
    m = buildActionMap(scene.actions, scene.id);
    actionMapCache.set(scene, m);
  }
  return m;
}

/**
 * Creates a scene executor that advances one action at a time via `next()`.
 *
 * @param entryActions - Override which actions seed the initial queue.
 *   Defaults to `scene.entryActions`. Pass a single-element array for
 *   route-driven entry where only the first entry action should fire.
 * @param maxSteps - Abort after this many action executions to guard against
 *   infinite loops in hand-crafted or malformed JSON models. Defaults to 10 000.
 *   @example
 *   // Limit to 10 steps in a unit test to keep it fast.
 *   createSceneExecutor(scene, state, hooks, undefined, 10);
 *
 * `next()` throws `SceneRuntimeError` for: `MaxStepsExceeded`, `UnknownAction`,
 * `DuplicateActionId`, `UnknownFunction`, `UnknownArgModel`.
 * Use `executeSceneSafe` if you need to capture partial state on failure.
 *
 * @example
 * const executor = createSceneExecutor(scene, state, hooks);
 * while (!executor.isDone()) {
 *   const { trace } = executor.next();
 * }
 * const result = executor.result();
 */
export function createSceneExecutor(
  scene: SceneBlock,
  state: StateManager,
  hooks: HookRegistry = { prepare: {}, publish: {} },
  entryActions?: string[],
  maxSteps: number = DEFAULT_MAX_STEPS,
  signal: AbortSignal = UNABORTABLE,
  onLog?: (event: LogEvent) => void,
  failOnPublishError = false,
): SceneExecutor {
  const actionMap = getActionMap(scene);
  const policy = parseNextPolicy(scene.nextPolicy, scene.id);
  // Per-executor cache for next-rule contexts. Keyed by (ProgModel identity,
  // serialised prepared values) so identical (prog, prepare) pairs across
  // multiple action steps reuse the same BuiltContext and ValidatedContext
  // rather than rebuilding them on each step.
  const rs = createRunState(state, entryActions ?? scene.entryActions);

  function isDone(): boolean {
    return rs.queueHead >= rs.queue.length;
  }

  async function next(): Promise<StepResult> {
    if (rs.queueHead >= rs.queue.length) return { done: true };
    if (signal.aborted) throw new DOMException("Runner aborted", "AbortError");

    // Read the next action id before the maxSteps guard so currentActionId() is
    // accurate when MaxStepsExceeded is thrown — callers need it for error reporting.
    const actionId = rs.queue[rs.queueHead];
    if (actionId === undefined) return { done: true };
    rs.currentAction = actionId;

    rs.stepCount++;
    if (rs.stepCount > maxSteps) {
      throw new SceneRuntimeError(
        "MaxStepsExceeded",
        scene.id,
        `exceeded ${maxSteps} action steps — possible infinite loop in next-rule graph`,
      );
    }

    rs.queueHead++;
    rs.visited.add(actionId);

    const action = actionMap[actionId];
    if (!action)
      throw new SceneRuntimeError("UnknownAction", scene.id, `unknown action "${actionId}"`);

    // Confirm currentAction reflects an action that actually exists in the map,
    // so currentActionId() is unambiguous in error handlers below this point.
    rs.currentAction = actionId;

    onLog?.({ kind: "action-start", sceneId: scene.id, actionId, stepIndex: rs.stepCount });

    let execResult: ActionExecutionResult;
    try {
      execResult = await executeAction(
        action,
        rs.currentState,
        hooks,
        scene.id,
        signal,
        failOnPublishError,
      );
    } catch (err) {
      // Strict publish failures happen after merge. Preserve that committed
      // state before propagating the failure so partialState() matches the
      // state that publish hooks observed and callers can retry safely.
      if (isPublishHookFailedError(err)) {
        rs.currentState = err.stateAfterMerge;
      }
      throw err;
    }
    rs.currentState = execResult.stateAfterMerge;

    const { matches: nextIds, warnings: nextWarnings } = evaluateNextRules(
      action,
      rs.currentState,
      execResult,
      policy,
      signal,
      scene.id,
      rs.ruleCtxCache,
    );
    if (nextIds.length === 0) rs.terminatedAt.push(actionId);

    const allWarnings: ActionWarning[] = [
      ...(execResult.mergeWarnings ?? []).map(
        (message): ActionWarning => ({ kind: "merge_warning", message }),
      ),
      ...(execResult.uncheckedWritePaths === undefined
        ? []
        : [
            {
              kind: "unchecked_state_write" as const,
              writtenPaths: execResult.uncheckedWritePaths,
              message:
                `action "${actionId}": merge wrote to ${execResult.uncheckedWritePaths.length} path(s) ` +
                `(${execResult.uncheckedWritePaths.join(", ")}) on an unchecked StateManager — ` +
                `path and type correctness are not enforced; typo'd paths silently read as null`,
            } satisfies ActionWarning,
          ]),
      ...nextWarnings,
    ];
    for (const w of allWarnings) {
      onLog?.({ kind: "warning", sceneId: scene.id, actionId, message: w.message });
    }

    const prevSceneWarningCount = rs.sceneWarnings.length;
    const trace: ActionTrace = {
      actionId,
      computeRootValue: execResult.computeRootValue,
      nextActionIds: nextIds,
      ...(execResult.publishOutcomes.length > 0
        ? { publishOutcomes: execResult.publishOutcomes }
        : {}),
      ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
    };
    rs.actionTraces.push(trace);
    enqueueNext(nextIds, actionId, rs, policy);

    for (let i = prevSceneWarningCount; i < rs.sceneWarnings.length; i++) {
      const warning = rs.sceneWarnings[i];
      if (warning !== undefined) {
        onLog?.({ kind: "warning", sceneId: scene.id, message: warning.message });
      }
    }

    onLog?.({ kind: "action-complete", sceneId: scene.id, actionId, trace });

    rs.currentAction = undefined;
    return { done: false, trace };
  }

  function result(): SceneExecutionResult {
    if (!isDone())
      throw new SceneRuntimeError("IncompleteScene", scene.id, "execution is not complete");
    const trace: SceneTrace = { sceneId: scene.id, actions: rs.actionTraces };
    if (rs.sceneWarnings.length > 0) trace.warnings = rs.sceneWarnings;
    return {
      sceneId: scene.id,
      stateAfterScene: rs.currentState,
      trace,
      terminatedAt: rs.terminatedAt,
    };
  }

  function partialState(): StateManager {
    return rs.currentState;
  }
  function currentActionId(): string | undefined {
    return rs.currentAction;
  }
  function currentWarnings(): readonly SceneWarning[] {
    return rs.sceneWarnings;
  }

  return { isDone, next, result, partialState, currentActionId, currentWarnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience wrapper — runs the scene to completion in one call
// ─────────────────────────────────────────────────────────────────────────────

export async function executeScene(
  inputScene: SceneBlock,
  state: StateManager,
  hooks: HookRegistry = { prepare: {}, publish: {} },
  entryActions?: string[],
  maxSteps?: number,
  options: SceneExecutionOptions = {},
): Promise<SceneExecutionResult> {
  const scene = snapshotModel(inputScene);
  const executor = createSceneExecutor(
    scene,
    state,
    hooks,
    entryActions,
    maxSteps,
    options.signal,
    options.onLog,
    options.failOnPublishError,
  );
  while (!executor.isDone()) await executor.next();
  return executor.result();
}

/**
 * Like `executeScene` but catches `SceneRuntimeError` and returns a
 * discriminated union instead of throwing. Partial state at the point of
 * failure is preserved in `result.partialState`.
 */
export async function executeSceneSafe(
  inputScene: SceneBlock,
  state: StateManager,
  hooks: HookRegistry = { prepare: {}, publish: {} },
  entryActions?: string[],
  maxSteps?: number,
  options: SceneExecutionOptions = {},
): Promise<SceneResult> {
  const scene = snapshotModel(inputScene);
  let executor: SceneExecutor | null = null;
  try {
    executor = createSceneExecutor(
      scene,
      state,
      hooks,
      entryActions,
      maxSteps,
      options.signal,
      options.onLog,
      options.failOnPublishError,
    );
    while (!executor.isDone()) await executor.next();
    return { ok: true, value: executor.result() };
  } catch (err) {
    const error =
      err instanceof SceneRuntimeError ? err : err instanceof Error ? err : new Error(String(err));
    return {
      ok: false,
      error,
      // executor is null when construction itself threw (e.g. DuplicateActionId);
      // fall back to the pre-construction state and the structured context from
      // the error (if available) for a machine-readable action id.
      partialState: executor?.partialState() ?? state,
      failedActionId:
        executor?.currentActionId() ??
        (err instanceof SceneRuntimeError ? err.context?.actionId : undefined) ??
        "<none>",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildActionMap(actions: ActionModel[], sceneId: string): Record<string, ActionModel> {
  const map: Record<string, ActionModel> = {};
  for (const a of actions) {
    if (map[a.id] !== undefined) {
      throw new SceneRuntimeError("DuplicateActionId", sceneId, `duplicate action id "${a.id}"`, {
        actionId: a.id,
      });
    }
    map[a.id] = a;
  }
  return map;
}

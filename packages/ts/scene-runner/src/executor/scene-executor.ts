import { executeGraph, assertValidContext, isPureBoolean } from 'runtime';
import type { SceneBlock, ActionModel } from '../types/turnout-model_pb.js';
import type { StateManager } from '../state/state-manager.js';
import type { HookRegistry, ActionTrace, SceneTrace } from '../types/harness-types.js';
import { executeAction } from './action-executor.js';
import { buildContextFromProg } from './hcl-context-builder.js';
import type { BuiltContext } from './hcl-context-builder.js';
import { resolveNextPrepare } from './prepare-resolver.js';
import type { ActionExecutionResult } from './types.js';
import { SceneRuntimeError } from './errors.js';

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

export type StepResult =
  | { done: false; trace: ActionTrace }
  | { done: true };

/**
 * Discriminated union returned by `executeSceneSafe`. Callers that prefer
 * throwing semantics should use `executeScene` instead.
 *
 * `error` is `unknown` so that unexpected throws (non-`SceneRuntimeError`)
 * are also captured here rather than re-thrown bare, ensuring `partialState`
 * is always available on failure.
 */
export type SceneResult =
  | { ok: true; value: SceneExecutionResult }
  | {
      ok: false;
      error: unknown;
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
};

/** Default maximum number of action steps before aborting to prevent infinite loops. */
const DEFAULT_MAX_STEPS = 10_000;

// Produces a deterministic JSON string regardless of object key insertion order.
function stableKey(obj: unknown): string {
  return JSON.stringify(obj, (_k, v) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
      : v,
  );
}

/**
 * Creates a scene executor that advances one action at a time via `next()`.
 *
 * @param entryActions - Override which actions seed the initial queue.
 *   Defaults to `scene.entryActions`. Pass a single-element array for
 *   route-driven entry where only the first entry action should fire.
 * @param maxSteps - Abort after this many action executions to guard against
 *   infinite loops in hand-crafted or malformed JSON models. Defaults to 10 000.
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
): SceneExecutor {
  const actionMap = buildActionMap(scene.actions, scene.id);
  const policy: string = scene.nextPolicy ?? 'first-match';

  let currentState = state;
  const queue: string[] = [...(entryActions ?? scene.entryActions)];
  let queueHead = 0;
  const visited = new Set<string>();
  const actionTraces: ActionTrace[] = [];
  const terminatedAt: string[] = [];
  const sceneWarnings: string[] = [];
  let stepCount = 0;
  let currentAction: string | undefined;

  function drainVisited(): void {
    while (queueHead < queue.length && visited.has(queue[queueHead]!)) {
      // Under all-match policy the same action may be enqueued by multiple next
      // rules. The visited guard prevents re-execution, but silently dropping
      // the entry can surprise authors. Record a warning so it is visible in the trace.
      if (policy === 'all-match') {
        sceneWarnings.push(
          `action "${queue[queueHead]!}" was enqueued more than once (all-match) but ran only once`,
        );
      }
      queueHead++;
    }
  }

  function isDone(): boolean {
    return queueHead >= queue.length;
  }

  async function next(): Promise<StepResult> {
    if (queueHead >= queue.length) return { done: true };

    // Peek the next action id before any guard so currentActionId() is accurate
    // even when MaxStepsExceeded is thrown — callers need it for error reporting.
    currentAction = queue[queueHead]!;

    if (stepCount >= maxSteps) {
      throw new SceneRuntimeError(
        'MaxStepsExceeded',
        scene.id,
        `exceeded ${maxSteps} action steps — possible infinite loop in next-rule graph`,
      );
    }
    stepCount++;

    const actionId = queue[queueHead++]!;
    visited.add(actionId);

    const action = actionMap[actionId];
    if (!action) throw new SceneRuntimeError('UnknownAction', scene.id, `unknown action "${actionId}"`);

    const result = await executeAction(action, currentState, hooks);
    currentState = result.stateAfterMerge;

    const nextIds = evaluateNextRules(action, currentState, result, policy);
    if (nextIds.length === 0) terminatedAt.push(actionId);

    const trace: ActionTrace = {
      actionId,
      computeRootValue: result.computeRootValue,
      nextActionIds: nextIds,
    };
    actionTraces.push(trace);
    queue.push(...nextIds);
    drainVisited();

    currentAction = undefined;
    return { done: false, trace };
  }

  function result(): SceneExecutionResult {
    if (!isDone()) throw new SceneRuntimeError('IncompleteScene', scene.id, 'execution is not complete');
    const trace: SceneTrace = { sceneId: scene.id, actions: actionTraces };
    if (sceneWarnings.length > 0) trace.warnings = sceneWarnings;
    return {
      sceneId: scene.id,
      stateAfterScene: currentState,
      trace,
      terminatedAt,
    };
  }

  function partialState(): StateManager {
    return currentState;
  }

  function currentActionId(): string | undefined {
    return currentAction;
  }

  return { isDone, next, result, partialState, currentActionId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience wrapper — runs the scene to completion in one call
// ─────────────────────────────────────────────────────────────────────────────

export async function executeScene(
  scene: SceneBlock,
  state: StateManager,
  hooks: HookRegistry = { prepare: {}, publish: {} },
  entryActions?: string[],
  maxSteps?: number,
): Promise<SceneExecutionResult> {
  const executor = createSceneExecutor(scene, state, hooks, entryActions, maxSteps);
  while (!executor.isDone()) await executor.next();
  return executor.result();
}

/**
 * Like `executeScene` but catches `SceneRuntimeError` and returns a
 * discriminated union instead of throwing. Partial state at the point of
 * failure is preserved in `result.partialState`.
 */
export async function executeSceneSafe(
  scene: SceneBlock,
  state: StateManager,
  hooks: HookRegistry = { prepare: {}, publish: {} },
  entryActions?: string[],
  maxSteps?: number,
): Promise<SceneResult> {
  const executor = createSceneExecutor(scene, state, hooks, entryActions, maxSteps);
  try {
    while (!executor.isDone()) await executor.next();
    return { ok: true, value: executor.result() };
  } catch (err) {
    return {
      ok: false,
      error: err,
      partialState: executor.partialState(),
      // currentActionId() is set before any guard in next(), so it is always
      // the action that was being attempted when the error was thrown.
      failedActionId: executor.currentActionId() ?? '<none>',
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
      throw new SceneRuntimeError('DuplicateActionId', sceneId, `duplicate action id "${a.id}"`);
    }
    map[a.id] = a;
  }
  return map;
}

/**
 * Evaluate the next rules for a completed action and return the IDs of the
 * actions to enqueue, according to the scene's `next_policy`.
 *
 * Each next rule builds its own context unless an identical prog+prepare pair
 * appears more than once within a single action's rule list (in which case the
 * local ctxCache deduplicates the build). The cache is per-invocation so stale
 * injected values from previous actions (where state or result differ) are never
 * reused.
 */
function evaluateNextRules(
  action: ActionModel,
  state: StateManager,
  result: ActionExecutionResult,
  policy: string,
): string[] {
  // Cache is scoped per invocation: state and result are constant within one
  // action's next-rule evaluation, so identical progs safely share a context.
  // A scene-lifetime cache would reuse stale injected values after state mutates.
  const ctxCache = new Map<string, BuiltContext>();
  const rules = action.next ?? [];
  const matches: string[] = [];

  for (const rule of rules) {
    let condMet: boolean;

    if (!rule.compute) {
      // No compute block → unconditional match.
      condMet = true;
    } else if (!rule.compute.prog) {
      condMet = false;
    } else {
      const nextPrepared = resolveNextPrepare(rule.prepare ?? [], state, result);
      const fingerprint = `${stableKey(rule.compute.prog)}|${stableKey(rule.prepare ?? [])}`;
      let builtCtx = ctxCache.get(fingerprint);
      if (!builtCtx) {
        builtCtx = buildContextFromProg(rule.compute.prog, nextPrepared, action.id);
        ctxCache.set(fingerprint, builtCtx);
      }
      const validated = assertValidContext(builtCtx.exec);

      const conditionName = rule.compute.condition;
      const condFuncId = builtCtx.getFuncId(conditionName);
      let condValue;
      if (condFuncId != null) {
        condValue = executeGraph(condFuncId, validated).value;
      } else {
        const condValueId = builtCtx.nameToValueId[conditionName];
        condValue = validated.valueTable[condValueId];
      }

      condMet = isPureBoolean(condValue) && condValue.value;
    }

    if (condMet) {
      matches.push(rule.action);
      if (policy === 'first-match') break;
    }
  }

  return matches;
}

import { executeGraph, assertValidContext, isPureBoolean } from 'runtime';
import type { SceneBlock, ActionModel } from '../types/turnout-model_pb.js';
import type { StateManager } from '../state/state-manager.js';
import type { HookRegistry, ActionTrace, SceneTrace } from '../types/harness-types.js';
import { executeAction } from './action-executor.js';
import { buildContextFromProg } from './hcl-context-builder.js';
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
  | { done: true; trace?: undefined };

/**
 * Discriminated union returned by `executeSceneSafe`. Callers that prefer
 * throwing semantics should use `executeScene` instead.
 */
export type SceneResult =
  | { ok: true; value: SceneExecutionResult }
  | {
      ok: false;
      error: SceneRuntimeError;
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
};

/** Default maximum number of action steps before aborting to prevent infinite loops. */
const DEFAULT_MAX_STEPS = 10_000;

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
  hooks: HookRegistry = {},
  entryActions?: string[],
  maxSteps: number = DEFAULT_MAX_STEPS,
): SceneExecutor {
  const actionMap = buildActionMap(scene.actions);
  const policy: string = scene.nextPolicy ?? 'first-match';

  let currentState = state;
  const queue: string[] = [...(entryActions ?? scene.entryActions)];
  let queueHead = 0;
  const visited = new Set<string>();
  const actionTraces: ActionTrace[] = [];
  const terminatedAt: string[] = [];
  const sceneWarnings: string[] = [];
  let stepCount = 0;

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

  return { isDone, next, result, partialState };
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience wrapper — runs the scene to completion in one call
// ─────────────────────────────────────────────────────────────────────────────

export async function executeScene(
  scene: SceneBlock,
  state: StateManager,
  hooks: HookRegistry = {},
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
  hooks: HookRegistry = {},
  entryActions?: string[],
  maxSteps?: number,
): Promise<SceneResult> {
  const executor = createSceneExecutor(scene, state, hooks, entryActions, maxSteps);
  let lastActionId = scene.entryActions[0] ?? '';
  try {
    while (!executor.isDone()) {
      const step = await executor.next();
      if (!step.done) lastActionId = step.trace.actionId;
    }
    return { ok: true, value: executor.result() };
  } catch (err) {
    if (err instanceof SceneRuntimeError) {
      return {
        ok: false,
        error: err,
        partialState: executor.partialState(),
        failedActionId: lastActionId,
      };
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildActionMap(actions: ActionModel[]): Record<string, ActionModel> {
  const map: Record<string, ActionModel> = {};
  for (const a of actions) map[a.id] = a;
  return map;
}

/**
 * Evaluate the next rules for a completed action and return the IDs of the
 * actions to enqueue, according to the scene's `next_policy`.
 *
 * Each next rule builds its own context independently. The previous caching
 * by prog name was incorrect: each `next { compute { prog ... } }` block is
 * an independent prog object with its own bindings and prepare entries, so
 * sharing a context across rules with the same name produces wrong conditions.
 */
function evaluateNextRules(
  action: ActionModel,
  state: StateManager,
  result: ActionExecutionResult,
  policy: string,
): string[] {
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
      const builtCtx = buildContextFromProg(rule.compute.prog, nextPrepared, action.id);
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

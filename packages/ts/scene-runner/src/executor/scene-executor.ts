import { executeGraph, assertValidContext, isPureBoolean, buildNull } from 'runtime';

const UNABORTABLE = new AbortController().signal;
import type { AnyValue } from 'runtime';
import type { SceneBlock, ActionModel, NextRuleModel } from '../types/turnout-model_pb.js';
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
): SceneExecutor {
  const actionMap = getActionMap(scene);
  const policy: string = scene.nextPolicy ?? 'first-match';

  let currentState = state;
  const queue: string[] = [...(entryActions ?? scene.entryActions)];
  let queueHead = 0;
  const visited = new Set<string>();
  // Maps each action id to the first action that enqueued it. Used to produce
  // actionable duplicate-enqueue warnings that name the responsible enqueuer.
  const enqueueSource = new Map<string, string>();
  const actionTraces: ActionTrace[] = [];
  const terminatedAt: string[] = [];
  const sceneWarnings: string[] = [];
  let stepCount = 0;
  let currentAction: string | undefined;

  function drainVisited(): void {
    while (queueHead < queue.length && visited.has(queue[queueHead]!)) {
      const dup = queue[queueHead]!;
      const source = enqueueSource.get(dup) ?? '<entry>';
      // Under all-match policy the same action may be enqueued by multiple next
      // rules. The visited guard prevents re-execution, but silently dropping
      // the entry can surprise authors. Record a warning so it is visible in the trace.
      // Under first-match policy a duplicate entry indicates a next rule pointed
      // to an already-executed action, which is also worth surfacing.
      if (policy === 'all-match') {
        sceneWarnings.push(
          `action "${dup}" was enqueued more than once (all-match, first enqueued by "${source}") but ran only once`,
        );
      } else if (policy === 'first-match') {
        sceneWarnings.push(
          `action "${dup}" was enqueued by "${source}" but already ran (first-match); next rule points to an already-executed action`,
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

    const result = await executeAction(action, currentState, hooks, scene.id, signal);
    currentState = result.stateAfterMerge;

    const { matches: nextIds, warnings: nextWarnings } = evaluateNextRules(action, currentState, result, policy);
    if (nextIds.length === 0) terminatedAt.push(actionId);

    const trace: ActionTrace = {
      actionId,
      computeRootValue: result.computeRootValue,
      nextActionIds: nextIds,
      ...(result.publishOutcomes.length > 0 ? { publishOutcomes: result.publishOutcomes } : {}),
      ...(nextWarnings.length > 0 ? { warnings: nextWarnings } : {}),
    };
    actionTraces.push(trace);
    for (const nextId of nextIds) {
      if (!enqueueSource.has(nextId)) enqueueSource.set(nextId, actionId);
      queue.push(nextId);
    }
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

type NextRulesResult = { matches: string[]; warnings: string[] };

/**
 * Evaluate the next rules for a completed action and return the IDs of the
 * actions to enqueue, according to the scene's `next_policy`.
 *
 * Each next rule builds its own context, keyed by object identity so that rules
 * appearing more than once in the list (unusual but legal) share a context.
 * The cache is per-invocation so stale injected values from previous actions
 * (where state or result differ) are never reused.
 *
 * `warnings` contains a diagnostic message for any condition binding that did
 * not resolve to a pure boolean — the rule is skipped but no error is thrown.
 */
function evaluateNextRules(
  action: ActionModel,
  state: StateManager,
  result: ActionExecutionResult,
  policy: string,
): NextRulesResult {
  // Cache is scoped per invocation: state and result are constant within one
  // action's next-rule evaluation, so rules that share the same object identity
  // safely share a context. Object-identity keying avoids expensive JSON
  // serialisation; the WeakMap is released when this invocation returns.
  const ctxCache = new Map<NextRuleModel, BuiltContext>();
  const rules = action.next ?? [];
  const matches: string[] = [];
  const warnings: string[] = [];

  for (const rule of rules) {
    let condMet: boolean;

    if (!rule.compute) {
      // No compute block → unconditional match.
      condMet = true;
    } else if (!rule.compute.prog) {
      condMet = false;
    } else {
      const nextPrepared = resolveNextPrepare(rule.prepare ?? [], state, result);
      let builtCtx = ctxCache.get(rule);
      if (!builtCtx) {
        builtCtx = buildContextFromProg(rule.compute.prog, nextPrepared, action.id);
        ctxCache.set(rule, builtCtx);
      }
      const validated = assertValidContext(builtCtx.exec);

      const conditionName = rule.compute.condition;
      const condBinding = builtCtx.resolve(conditionName);
      let condValue: AnyValue;
      if (condBinding.kind === 'func') {
        condValue = executeGraph(condBinding.id, validated).value;
      } else if (condBinding.kind === 'value') {
        condValue = validated.valueTable[condBinding.id] as AnyValue ?? buildNull('missing');
      } else {
        // kind === 'missing': condition binding not found in context
        condValue = buildNull('missing');
      }

      if (!isPureBoolean(condValue)) {
        warnings.push(
          `action "${action.id}" next-rule condition "${conditionName}" resolved to ` +
          `${condValue?.symbol ?? 'undefined'} (expected pure boolean) — rule skipped`,
        );
      }
      condMet = isPureBoolean(condValue) && condValue.value;
    }

    if (condMet) {
      matches.push(rule.action);
      if (policy === 'first-match') break;
    }
  }

  return { matches, warnings };
}

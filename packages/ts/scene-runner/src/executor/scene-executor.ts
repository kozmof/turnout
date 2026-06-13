import { executeGraph, assertValidContext, isPureBoolean, buildNull } from 'runtime';

const UNABORTABLE = new AbortController().signal;
import type { AnyValue } from 'runtime';
import type { SceneBlock, ActionModel, ProgModel } from '../types/turnout-model_pb.js';
import type { StateManager, StateReader } from '../state/state-manager.js';
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
  readonly currentWarnings: () => readonly string[];
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

  function isDone(): boolean {
    return queueHead >= queue.length;
  }

  async function next(): Promise<StepResult> {
    if (queueHead >= queue.length) return { done: true };

    // Peek the next action id before any guard so currentActionId() is accurate
    // even when MaxStepsExceeded is thrown — callers need it for error reporting.
    currentAction = queue[queueHead]!;

    stepCount++;
    if (stepCount > maxSteps) {
      throw new SceneRuntimeError(
        'MaxStepsExceeded',
        scene.id,
        `exceeded ${maxSteps} action steps — possible infinite loop in next-rule graph`,
      );
    }

    const actionId = queue[queueHead++]!;
    visited.add(actionId);

    const action = actionMap[actionId];
    if (!action) throw new SceneRuntimeError('UnknownAction', scene.id, `unknown action "${actionId}"`);

    const result = await executeAction(action, currentState, hooks, scene.id, signal);
    currentState = result.stateAfterMerge;

    const { matches: nextIds, warnings: nextWarnings } = evaluateNextRules(action, currentState, result, policy, signal, scene.id);
    if (nextIds.length === 0) terminatedAt.push(actionId);

    const allWarnings = [...(result.mergeWarnings ?? []), ...nextWarnings];
    const trace: ActionTrace = {
      actionId,
      computeRootValue: result.computeRootValue,
      nextActionIds: nextIds,
      ...(result.publishOutcomes.length > 0 ? { publishOutcomes: result.publishOutcomes } : {}),
      ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
    };
    actionTraces.push(trace);
    for (const nextId of nextIds) {
      if (visited.has(nextId)) {
        // The action already ran; warn and skip.
        const source = enqueueSource.get(nextId) ?? '<entry>';
        if (policy === 'all-match') {
          sceneWarnings.push(
            `action "${nextId}" was enqueued more than once (all-match, first enqueued by "${source}") but ran only once`,
          );
        } else if (policy === 'first-match') {
          sceneWarnings.push(
            `action "${nextId}" was enqueued by "${source}" but already ran (first-match); next rule points to an already-executed action`,
          );
        }
        continue;
      }
      if (enqueueSource.has(nextId)) {
        // Already queued but not yet visited. For all-match, warn that it will
        // only run once. For first-match, silently de-dup (the item will run once).
        if (policy === 'all-match') {
          const source = enqueueSource.get(nextId)!;
          sceneWarnings.push(
            `action "${nextId}" was enqueued more than once (all-match, first enqueued by "${source}") but ran only once`,
          );
        }
        continue;
      }
      enqueueSource.set(nextId, actionId);
      queue.push(nextId);
    }

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

  function currentWarnings(): readonly string[] {
    return sceneWarnings;
  }

  return { isDone, next, result, partialState, currentActionId, currentWarnings };
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
  let executor: SceneExecutor | null = null;
  try {
    executor = createSceneExecutor(scene, state, hooks, entryActions, maxSteps);
    while (!executor.isDone()) await executor.next();
    return { ok: true, value: executor.result() };
  } catch (err) {
    const error =
      err instanceof SceneRuntimeError ? err
      : err instanceof Error ? err
      : new Error(String(err));
    return {
      ok: false,
      error,
      // executor is null when construction itself threw (e.g. DuplicateActionId);
      // fall back to the pre-construction state and '<none>' as the action id.
      partialState: executor?.partialState() ?? state,
      failedActionId: executor?.currentActionId() ?? '<none>',
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
 * For pure (no-inject) progs, `buildContextFromProg` handles caching via its
 * module-level `pureProgCtxCache`. For rules with prepare entries, a
 * per-invocation cache keyed by `(prog identity, serialised prepared values)`
 * avoids rebuilding identical contexts when multiple rules share the same prog
 * and produce equal prepared values (e.g. multiple guards on the same binding).
 * The cache is local to this call so stale values from previous actions are
 * never reused.
 *
 * `warnings` contains a diagnostic message for any condition binding that did
 * not resolve to a pure boolean — the rule is skipped but no error is thrown.
 */
function evaluateNextRules(
  action: ActionModel,
  state: StateReader,
  result: ActionExecutionResult,
  policy: string,
  signal: AbortSignal,
  sceneId: string,
): NextRulesResult {
  const rules = action.next ?? [];
  if (rules.length === 0) return { matches: [], warnings: [] };

  const matches: string[] = [];
  const warnings: string[] = [];
  // Per-invocation cache for rules with prepare entries. The inner key is the
  // JSON-serialised prepared-values map; the outer key is prog object identity.
  const ruleCtxCache = new Map<ProgModel, Map<string, BuiltContext>>();

  for (const rule of rules) {
    if (signal.aborted) throw new DOMException('Runner aborted', 'AbortError');
    let condMet: boolean;

    if (!rule.compute) {
      // No compute block → unconditional match.
      condMet = true;
    } else if (!rule.compute.prog) {
        warnings.push(
          `scene "${sceneId}" action "${action.id}" next-rule targeting "${rule.action}": ` +
          `compute block has no prog — rule skipped (model may be malformed)`,
        );
        condMet = false;
    } else {
      const prepare = rule.prepare ?? [];
      const nextPrepared = resolveNextPrepare(prepare, state, result);

      let builtCtx: BuiltContext;
      if (prepare.length > 0) {
        // Non-pure: check per-invocation cache before rebuilding.
        let byPrepare = ruleCtxCache.get(rule.compute.prog);
        // `resolveNextPrepare` iterates `rule.prepare` in proto declaration order,
        // so Object.entries(nextPrepared) is always in stable insertion order —
        // no sort needed.
        const prepKey = JSON.stringify(Object.entries(nextPrepared));
        const cached = byPrepare?.get(prepKey);
        if (cached) {
          builtCtx = cached;
        } else {
          builtCtx = buildContextFromProg(rule.compute.prog, nextPrepared, action.id);
          if (!byPrepare) {
            byPrepare = new Map();
            ruleCtxCache.set(rule.compute.prog, byPrepare);
          }
          byPrepare.set(prepKey, builtCtx);
        }
      } else {
        // Pure: buildContextFromProg already caches via pureProgCtxCache.
        builtCtx = buildContextFromProg(rule.compute.prog, nextPrepared, action.id);
      }
      const validated = assertValidContext(builtCtx.getExec());

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

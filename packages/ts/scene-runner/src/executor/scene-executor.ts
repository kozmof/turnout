import { executeGraph, isPureBoolean, buildNull } from "runtime";
import type { AnyValue, ValidatedContext } from "runtime";
import type { SceneBlock, ActionModel, ProgModel } from "../types/turnout-model_pb.js";
import type { StateManager, StateReader } from "../state/state-manager.js";
import type {
  HookRegistry,
  ActionTrace,
  SceneTrace,
  ActionWarning,
  SceneWarning,
  NextPolicy,
  LogEvent,
} from "../types/harness-types.js";
import { executeAction } from "./action-executor.js";
import { buildContextFromProg } from "./hcl-context-builder.js";
import type { BuiltContext } from "./hcl-context-builder.js";
import { resolveNextPrepare } from "./prepare-resolver.js";
import { type ActionExecutionResult, UNABORTABLE } from "./types.js";
import { SceneRuntimeError } from "./errors.js";
import { parseNextPolicy } from "./next-policy.js";

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
// Scene run state
// ─────────────────────────────────────────────────────────────────────────────

type SceneRunState = {
  currentState: StateManager;
  queue: string[];
  queueHead: number;
  readonly visited: Set<string>;
  readonly enqueueSource: Map<string, string>;
  readonly actionTraces: ActionTrace[];
  readonly terminatedAt: string[];
  readonly sceneWarnings: SceneWarning[];
  stepCount: number;
  currentAction: string | undefined;
  readonly ruleCtxCache: RuleCtxCache;
};

function createRunState(initialState: StateManager, entryActions: string[]): SceneRunState {
  return {
    currentState: initialState,
    queue: [...entryActions],
    queueHead: 0,
    visited: new Set(),
    enqueueSource: new Map(),
    actionTraces: [],
    terminatedAt: [],
    sceneWarnings: [],
    stepCount: 0,
    currentAction: undefined,
    ruleCtxCache: new RuleCtxCache(),
  };
}

function enqueueNext(
  nextIds: string[],
  fromActionId: string,
  rs: SceneRunState,
  policy: NextPolicy,
): void {
  for (const nextId of nextIds) {
    if (rs.visited.has(nextId)) {
      const source = rs.enqueueSource.get(nextId) ?? "<entry>";
      if (policy === "all-match") {
        rs.sceneWarnings.push({
          kind: "duplicate_enqueue",
          actionId: nextId,
          firstEnqueuedBy: source,
          policy,
          alreadyVisited: true,
          message: `action "${nextId}" was enqueued more than once (all-match, first enqueued by "${source}") but ran only once`,
        });
      } else if (policy === "first-match") {
        rs.sceneWarnings.push({
          kind: "duplicate_enqueue",
          actionId: nextId,
          firstEnqueuedBy: source,
          policy,
          alreadyVisited: true,
          message: `action "${nextId}" was enqueued by "${source}" but already ran (first-match); next rule points to an already-executed action`,
        });
      }
      continue;
    }
    if (rs.enqueueSource.has(nextId)) {
      const source = rs.enqueueSource.get(nextId)!;
      if (policy === "all-match") {
        rs.sceneWarnings.push({
          kind: "duplicate_enqueue",
          actionId: nextId,
          firstEnqueuedBy: source,
          policy,
          alreadyVisited: false,
          message: `action "${nextId}" was enqueued more than once (all-match, first enqueued by "${source}") but ran only once`,
        });
      } else if (policy === "first-match") {
        rs.sceneWarnings.push({
          kind: "duplicate_enqueue",
          actionId: nextId,
          firstEnqueuedBy: source,
          policy,
          alreadyVisited: false,
          message: `action "${nextId}" was enqueued by "${fromActionId}" but is already pending (first enqueued by "${source}", first-match); second enqueue ignored`,
        });
      }
      continue;
    }
    rs.enqueueSource.set(nextId, fromActionId);
    rs.queue.push(nextId);
  }
}

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

/** Maximum number of (prepared-values → context) entries kept per ProgModel in ruleCtxCache. */
const MAX_RULE_CTX_CACHE_ENTRIES = 256;

/** Maximum number of distinct ProgModel keys in the outer ruleCtxCache per executor. */
const MAX_RULE_CTX_CACHE_PROGS = 64;

/** Serialised prepare-key strings longer than this bypass the cache to avoid huge Map keys. */
const MAX_PREP_CACHE_KEY_BYTES = 65_536;

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

    // Peek the next action id before the maxSteps guard so currentActionId() is
    // accurate when MaxStepsExceeded is thrown — callers need it for error reporting.
    rs.currentAction = rs.queue[rs.queueHead]!;

    rs.stepCount++;
    if (rs.stepCount > maxSteps) {
      throw new SceneRuntimeError(
        "MaxStepsExceeded",
        scene.id,
        `exceeded ${maxSteps} action steps — possible infinite loop in next-rule graph`,
      );
    }

    const actionId = rs.queue[rs.queueHead++]!;
    rs.visited.add(actionId);

    const action = actionMap[actionId];
    if (!action)
      throw new SceneRuntimeError("UnknownAction", scene.id, `unknown action "${actionId}"`);

    // Confirm currentAction reflects an action that actually exists in the map,
    // so currentActionId() is unambiguous in error handlers below this point.
    rs.currentAction = actionId;

    onLog?.({ kind: "action-start", sceneId: scene.id, actionId, stepIndex: rs.stepCount });

    const result = await executeAction(
      action,
      rs.currentState,
      hooks,
      scene.id,
      signal,
      failOnPublishError,
    );
    rs.currentState = result.stateAfterMerge;

    const { matches: nextIds, warnings: nextWarnings } = evaluateNextRules(
      action,
      rs.currentState,
      result,
      policy,
      signal,
      scene.id,
      rs.ruleCtxCache,
    );
    if (nextIds.length === 0) rs.terminatedAt.push(actionId);

    const allWarnings: ActionWarning[] = [
      ...(result.mergeWarnings ?? []).map(
        (message): ActionWarning => ({ kind: "merge_warning", message }),
      ),
      ...(result.uncheckedWritePaths !== undefined
        ? [
            {
              kind: "unchecked_state_write" as const,
              writtenPaths: result.uncheckedWritePaths,
              message:
                `action "${actionId}": merge wrote to ${result.uncheckedWritePaths.length} path(s) ` +
                `(${result.uncheckedWritePaths.join(", ")}) on an unchecked StateManager — ` +
                `path and type correctness are not enforced; typo'd paths silently read as null`,
            } satisfies ActionWarning,
          ]
        : []),
      ...nextWarnings,
    ];
    for (const w of allWarnings) {
      onLog?.({ kind: "warning", sceneId: scene.id, actionId, message: w.message });
    }

    const prevSceneWarningCount = rs.sceneWarnings.length;
    const trace: ActionTrace = {
      actionId,
      computeRootValue: result.computeRootValue,
      nextActionIds: nextIds,
      ...(result.publishOutcomes.length > 0 ? { publishOutcomes: result.publishOutcomes } : {}),
      ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
    };
    rs.actionTraces.push(trace);
    enqueueNext(nextIds, actionId, rs, policy);

    for (let i = prevSceneWarningCount; i < rs.sceneWarnings.length; i++) {
      onLog?.({ kind: "warning", sceneId: scene.id, message: rs.sceneWarnings[i]!.message });
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
  scene: SceneBlock,
  state: StateManager,
  hooks: HookRegistry = { prepare: {}, publish: {} },
  entryActions?: string[],
  maxSteps?: number,
  options: SceneExecutionOptions = {},
): Promise<SceneExecutionResult> {
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
  scene: SceneBlock,
  state: StateManager,
  hooks: HookRegistry = { prepare: {}, publish: {} },
  entryActions?: string[],
  maxSteps?: number,
  options: SceneExecutionOptions = {},
): Promise<SceneResult> {
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

type NextRulesResult = { matches: string[]; warnings: ActionWarning[] };

type RuleCtxEntry = { builtCtx: BuiltContext; validCtx: ValidatedContext };

/**
 * Two-level FIFO cache for next-rule execution contexts, keyed by
 * (ProgModel identity, serialised prepared-values string).
 *
 * The inner Map evicts at MAX_RULE_CTX_CACHE_ENTRIES entries per ProgModel;
 * the outer Map evicts at MAX_RULE_CTX_CACHE_PROGS distinct ProgModels.
 * Eviction fires before the cap is exceeded so the size never exceeds the limit.
 */
class RuleCtxCache {
  private readonly outer = new Map<ProgModel, Map<string, RuleCtxEntry>>();

  get(prog: ProgModel, key: string): RuleCtxEntry | undefined {
    return this.outer.get(prog)?.get(key);
  }

  set(prog: ProgModel, key: string, value: RuleCtxEntry): void {
    let inner = this.outer.get(prog);
    if (!inner) {
      inner = new Map();
      this.outer.set(prog, inner);
    }
    inner.set(key, value);
    // Evict the oldest inner entry (FIFO) so the size drops back to the cap.
    // The check fires after insertion, so size briefly reaches cap+1 before eviction.
    if (inner.size > MAX_RULE_CTX_CACHE_ENTRIES) {
      inner.delete(inner.keys().next().value!);
    }
    // Evict the oldest outer entry when the distinct-ProgModel count exceeds the cap.
    if (this.outer.size > MAX_RULE_CTX_CACHE_PROGS) {
      this.outer.delete(this.outer.keys().next().value!);
    }
  }
}

function makePreparedKey(prepared: Record<string, AnyValue>): string | null {
  const parts: string[] = [];
  // Object.keys() returns keys in insertion order (the proto's NextPrepareEntry
  // declaration order, which is stable and deterministic). No sort needed.
  for (const k of Object.keys(prepared)) {
    const v = prepared[k];
    let serialized: string;
    try {
      serialized = JSON.stringify(v?.value ?? null);
    } catch {
      // AnyValue.value should always be JSON-serializable (number, string,
      // boolean, or array). If serialization fails for a given entry, bypass
      // the cache so stale entries are never reused.
      return null;
    }
    parts.push(`${k}\x00${v?.symbol ?? "null"}\x00${serialized}`);
  }
  return parts.join("\x1f");
}

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
  policy: NextPolicy,
  signal: AbortSignal,
  sceneId: string,
  ruleCtxCache: RuleCtxCache,
): NextRulesResult {
  const rules = action.next ?? [];
  if (rules.length === 0) return { matches: [], warnings: [] };

  const matches: string[] = [];
  const warnings: ActionWarning[] = [];

  for (const rule of rules) {
    if (signal.aborted) throw new DOMException("Runner aborted", "AbortError");
    let condMet: boolean;

    if (!rule.compute) {
      // No compute block → unconditional match.
      condMet = true;
    } else if (!rule.compute.prog) {
      warnings.push({
        kind: "missing_next_compute_prog",
        sceneId,
        actionId: action.id,
        targetActionId: rule.action,
        message:
          `scene "${sceneId}" action "${action.id}" next-rule targeting "${rule.action}": ` +
          `compute block has no prog — rule skipped (model may be malformed)`,
      });
      condMet = false;
    } else {
      const prepare = rule.prepare ?? [];
      const nextPrepared = resolveNextPrepare(prepare, state, result);

      let builtCtx: BuiltContext;
      let validated: ValidatedContext;
      if (prepare.length > 0) {
        // Non-pure: check per-executor cache before rebuilding. The key is a
        // compact encoding of the prepared-values map (see makePreparedKey).
        // Returns null when serialisation fails or the key is too large — bypass
        // the cache in those cases so stale entries are never reused.
        const prepKey = makePreparedKey(nextPrepared);
        const bypassCache = prepKey === null || prepKey.length > MAX_PREP_CACHE_KEY_BYTES;
        const cached = bypassCache ? undefined : ruleCtxCache.get(rule.compute.prog, prepKey!);
        if (cached) {
          ({ builtCtx, validCtx: validated } = cached);
        } else {
          builtCtx = buildContextFromProg(rule.compute.prog, nextPrepared, action.id);
          validated = builtCtx.getValidatedExec();
          if (!bypassCache) {
            ruleCtxCache.set(rule.compute.prog, prepKey!, { builtCtx, validCtx: validated });
          }
        }
      } else {
        // Pure: buildContextFromProg already caches via pureProgCtxCache.
        builtCtx = buildContextFromProg(rule.compute.prog, nextPrepared, action.id);
        validated = builtCtx.getValidatedExec();
      }

      const conditionName = rule.compute.condition;
      const condBinding = builtCtx.resolve(conditionName);
      let condValue: AnyValue;
      if (condBinding.kind === "func") {
        condValue = executeGraph(condBinding.id, validated).value;
      } else if (condBinding.kind === "value") {
        condValue = (validated.valueTable[condBinding.id] as AnyValue) ?? buildNull("missing");
      } else {
        // kind === 'missing': condition binding not found in context
        condValue = buildNull("missing");
      }

      if (!isPureBoolean(condValue)) {
        const actualType = condValue?.symbol ?? "undefined";
        warnings.push({
          kind: "invalid_next_condition",
          actionId: action.id,
          conditionName,
          actualType,
          message:
            `action "${action.id}" next-rule condition "${conditionName}" resolved to ` +
            `${actualType} (expected pure boolean) — rule skipped`,
        });
      }
      condMet = isPureBoolean(condValue) && condValue.value;
    }

    if (condMet) {
      matches.push(rule.action);
      if (policy === "first-match") break;
    }
  }

  return { matches, warnings };
}

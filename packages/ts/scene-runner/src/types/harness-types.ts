import type { AnyValue } from "runtime";
import type { TurnModel } from "./turnout-model_pb.js";

// ─────────────────────────────────────────────────────────────────────────────
// Hook registry
// ─────────────────────────────────────────────────────────────────────────────

export interface PrepareHookContext {
  readonly actionId: string;
  readonly hookName: string;
  /** Read the value of a binding already resolved via from_state in this prepare pass. */
  get(binding: string): unknown;
}

export interface PublishHookContext {
  readonly actionId: string;
  readonly hookName: string;
  /** Read the complete final state snapshot after merge. */
  state(): Readonly<Record<string, AnyValue>>;
}

export type PublishHookOutcome =
  | { hookName: string; status: "ok" }
  | { hookName: string; status: "error"; message: string };

export type PrepareHookImpl = (
  ctx: PrepareHookContext,
  signal: AbortSignal,
) => Record<string, unknown> | Promise<Record<string, unknown>>;
export type PublishHookImpl = (
  ctx: PublishHookContext,
  signal: AbortSignal,
) => PublishHookOutcome | void | Promise<PublishHookOutcome | void>;

export type NextPolicy = "first-match" | "all-match";

export type ActionWarning =
  | {
      kind: "missing_next_compute_prog";
      sceneId: string;
      actionId: string;
      targetActionId: string;
      message: string;
    }
  | {
      kind: "invalid_next_condition";
      actionId: string;
      conditionName: string;
      actualType: string;
      message: string;
    }
  | { kind: "merge_warning"; message: string };

export type SceneWarning = {
  kind: "duplicate_enqueue";
  actionId: string;
  firstEnqueuedBy: string;
  policy: NextPolicy;
  alreadyVisited: boolean;
  message: string;
};

export type HookRegistry = {
  prepare: Record<string, PrepareHookImpl>;
  publish: Record<string, PublishHookImpl>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared execution options — fields common to both Runner and Harness
// ─────────────────────────────────────────────────────────────────────────────

export type ExecutionOptions = {
  /** ID of the scene or route to execute. */
  entryId: string;
  /** Initial STATE values, keyed by dotted path ("namespace.field"). */
  initialState: Record<string, AnyValue>;
  /** Maximum action steps allowed per scene execution. */
  maxSceneSteps?: number;
  /** Maximum scene transitions allowed during route execution. Defaults to 1,000. */
  maxRouteTransitions?: number;
  /**
   * Optional cancellation signal. When aborted, `next()`, `run()`, and `runAsync()`
   * throw a `DOMException` with `name === 'AbortError'`. The signal is also forwarded
   * to prepare and publish hooks so long-running async hooks can respect it.
   */
  signal?: AbortSignal;
  /**
   * Optional callback invoked for non-fatal runner warnings (e.g. missing STATE schema).
   * Defaults to no-op. Pass `console.warn` to restore console logging.
   */
  onWarning?: (msg: string) => void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Harness options — universal (client + server)
// ─────────────────────────────────────────────────────────────────────────────

export type HarnessOptions = ExecutionOptions & {
  /** Pre-parsed TurnModel. Use ServerHarnessOptions to load from a file. */
  model: TurnModel;
  /** Optional hook implementations for from_hook prepare entries. */
  hooks?: HookRegistry;
};

// ─────────────────────────────────────────────────────────────────────────────
// Execution trace
// ─────────────────────────────────────────────────────────────────────────────

export type ActionTrace = {
  actionId: string;
  computeRootValue: AnyValue;
  nextActionIds: string[];
  publishOutcomes?: PublishHookOutcome[];
  /** Non-fatal warnings produced while evaluating this action's next rules. */
  warnings?: ActionWarning[];
};

export type SceneTrace = {
  sceneId: string;
  actions: ActionTrace[];
  /** Non-fatal warnings produced during scene execution (e.g. skipped duplicate actions). */
  warnings?: SceneWarning[];
};

export type RouteTrace = {
  routeId: string;
  scenes: SceneTrace[];
};

export type ExecutionTrace =
  | { kind: "scene"; scene: SceneTrace }
  | { kind: "route"; route: RouteTrace };

// ─────────────────────────────────────────────────────────────────────────────
// Harness result
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result returned by full-model factories (`createRunner`, `runHarness`).
 * `model` is always present because the factory received a complete `TurnModel`.
 */
export type FullHarnessResult = {
  finalState: Record<string, AnyValue>;
  trace: ExecutionTrace;
  model: TurnModel;
};

/**
 * Result returned by fragment factories (`createSceneRunner`, `createRouteRunner`).
 * `model` is absent — the factory received only a scene or route fragment, not
 * a complete `TurnModel`.
 */
export type FragmentHarnessResult = {
  finalState: Record<string, AnyValue>;
  trace: ExecutionTrace;
};

/**
 * Union of all harness result types. Use `FullHarnessResult` or
 * `FragmentHarnessResult` when the factory is known at the call site.
 */
export type HarnessResult = FullHarnessResult | FragmentHarnessResult;

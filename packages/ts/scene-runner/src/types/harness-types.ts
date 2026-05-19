import type { AnyValue } from 'runtime';
import type { TurnModel } from './turnout-model_pb.js';

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
  state(): Record<string, unknown>;
}

export type PublishHookOutcome =
  | { hookName: string; status: 'ok' }
  | { hookName: string; status: 'error'; message: string };

export type PrepareHookImpl = (ctx: PrepareHookContext) => Record<string, unknown> | Promise<Record<string, unknown>>;
export type PublishHookImpl  = (ctx: PublishHookContext) => PublishHookOutcome | void | Promise<PublishHookOutcome | void>;
export type HookImpl         = PrepareHookImpl | PublishHookImpl;

export type HookRegistry = {
  prepare: Record<string, PrepareHookImpl>;
  publish: Record<string, PublishHookImpl>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Harness options — universal (client + server)
// ─────────────────────────────────────────────────────────────────────────────

export type HarnessOptions = {
  /** Pre-parsed TurnModel. Use ServerHarnessOptions to load from a file. */
  model: TurnModel;
  /**
   * ID of the scene or route to execute.
   * If it matches a route.id, the route executor is used.
   * If it matches a scene.id, the scene executor is used directly.
   */
  entryId: string;
  /** Initial STATE values, keyed by dotted path ("namespace.field"). */
  initialState: Record<string, AnyValue>;
  /** Optional hook implementations for from_hook prepare entries. */
  hooks?: HookRegistry;
  /** Maximum action steps allowed per scene execution. */
  maxSceneSteps?: number;
  /** Maximum scene transitions allowed during route execution. */
  maxRouteTransitions?: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Execution trace
// ─────────────────────────────────────────────────────────────────────────────

export type ActionTrace = {
  actionId: string;
  computeRootValue: AnyValue;
  nextActionIds: string[];
};

export type SceneTrace = {
  sceneId: string;
  actions: ActionTrace[];
  /** Non-fatal warnings produced during scene execution (e.g. skipped duplicate actions). */
  warnings?: string[];
};

export type RouteTrace = {
  routeId: string;
  scenes: SceneTrace[];
};

export type ExecutionTrace =
  | { kind: 'scene'; scene: SceneTrace }
  | { kind: 'route'; route: RouteTrace };

// ─────────────────────────────────────────────────────────────────────────────
// Harness result
// ─────────────────────────────────────────────────────────────────────────────

export type HarnessResult = {
  finalState: Record<string, AnyValue>;
  trace: ExecutionTrace;
  model: TurnModel;
};

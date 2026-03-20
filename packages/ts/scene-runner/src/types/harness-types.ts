import type { AnyValue } from 'runtime';
import type { TurnModel } from './scene-model.js';

// ─────────────────────────────────────────────────────────────────────────────
// Hook registry
// ─────────────────────────────────────────────────────────────────────────────

export type HookContext = {
  readState: (path: string) => AnyValue | undefined;
};

export type HookHandler = (ctx: HookContext) => Record<string, AnyValue>;

export type HookRegistry = Record<string, HookHandler>;

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

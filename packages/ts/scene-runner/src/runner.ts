import type { AnyValue } from 'runtime';
import type { TurnModel, RouteModel, SceneBlock } from './types/scene-model.js';
import type {
  HookRegistry,
  HookHandler,
  HarnessResult,
  ActionTrace,
  SceneTrace,
} from './types/harness-types.js';
import { StateManager } from './state/state-manager.js';
import {
  createSceneExecutor,
  type SceneExecutor,
} from './executor/scene-executor.js';
import { selectNextScene } from './executor/route-pattern.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type RunnerOptions = {
  /** ID of the scene or route to execute. */
  entryId: string;
  /** Initial STATE values, keyed by dotted path ("namespace.field"). */
  initialState: Record<string, AnyValue>;
};

export type RunnerStepResult =
  | { done: true }
  | { done: false; sceneId: string; actionId: string; trace: ActionTrace };

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Step-by-step execution controller for a TurnModel.
 *
 * Works in both server and client environments — it operates on an already-
 * parsed `TurnModel`. To load a model from disk, use the server utilities
 * (`runConverter`, `loadJsonModel`) before constructing a Runner.
 *
 * @example
 * const runner = createRunner(model, { entryId: 'checkout', initialState: {} });
 * runner.registerHook('get_cart', (ctx) => ({ items: buildString('a,b') }));
 *
 * // Manual stepping
 * while (!runner.isDone()) {
 *   const [step] = runner.next();
 * }
 * const result = runner.result();
 *
 * // Or run to completion in one call
 * const result = runner.run();
 */
export class Runner {
  private readonly model: TurnModel;
  private readonly sceneMap: Record<string, SceneBlock>;
  private readonly route: RouteModel | null;
  private readonly hooks: HookRegistry = {};

  private state: StateManager;
  private executor: SceneExecutor;
  private currentSceneId: string;

  // Route mode accumulation
  private readonly routeHistory: string[] = [];
  private readonly routeSceneTraces: SceneTrace[] = [];

  private _done = false;

  constructor(model: TurnModel, options: RunnerOptions) {
    this.model = model;
    this.sceneMap = Object.fromEntries(model.scenes.map((s) => [s.id, s]));
    const routeMap = Object.fromEntries((model.routes ?? []).map((r) => [r.id, r]));

    this.state = model.state
      ? StateManager.fromSchema(model.state, options.initialState)
      : StateManager.from(options.initialState);

    const route = routeMap[options.entryId];
    const scene = this.sceneMap[options.entryId];

    if (route) {
      const entrySceneId = model.scenes[0]?.id;
      if (!entrySceneId) {
        throw new Error(
          `Runner: route "${options.entryId}" found but model has no scenes`,
        );
      }
      this.route = route;
      this.currentSceneId = entrySceneId;
    } else if (scene) {
      this.route = null;
      this.currentSceneId = options.entryId;
    } else {
      throw new Error(
        `Runner: entryId "${options.entryId}" not found as route or scene in the model`,
      );
    }

    // hooks is passed by reference so registerHook() mutations are visible
    // to the executor without needing to recreate it.
    this.executor = createSceneExecutor(
      this.sceneMap[this.currentSceneId]!,
      this.state,
      this.hooks,
    );
  }

  // ── Hook registration ───────────────────────────────────────────────────────

  /**
   * Register a hook handler.
   * Can be called before or between steps — mutations are picked up immediately.
   * Returns `this` for chaining.
   */
  registerHook(name: string, handler: HookHandler): this {
    this.hooks[name] = handler;
    return this;
  }

  // ── Step control ────────────────────────────────────────────────────────────

  /** True when all actions have completed (scene or route finished). */
  isDone(): boolean {
    return this._done;
  }

  /**
   * Advance by `steps` actions (default: 1).
   * Scene transitions in route mode are handled automatically and do not
   * consume a step — each entry in the returned array represents one
   * completed action.
   *
   * Returns fewer than `steps` entries if execution finishes early.
   */
  next(steps = 1): RunnerStepResult[] {
    const results: RunnerStepResult[] = [];
    for (let i = 0; i < steps; i++) {
      const r = this._advance();
      results.push(r);
      if (r.done) break;
    }
    return results;
  }

  /**
   * Run to completion and return the final result.
   * Equivalent to calling `next()` in a loop until done.
   */
  run(): HarnessResult {
    while (!this._done) this._advance();
    return this.result();
  }

  /**
   * Return the final `HarnessResult`.
   * Throws if execution is not yet complete.
   */
  result(): HarnessResult {
    if (!this._done) {
      throw new Error(
        'Runner: execution is not complete — call run() or step until isDone()',
      );
    }

    if (this.route) {
      return {
        finalState: this.state.snapshot(),
        trace: {
          kind: 'route',
          route: { routeId: this.route.id, scenes: this.routeSceneTraces },
        },
        model: this.model,
      };
    }

    const sceneTrace = this.executor.result().trace;
    return {
      finalState: this.state.snapshot(),
      trace: { kind: 'scene', scene: sceneTrace },
      model: this.model,
    };
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  /**
   * Advance one action, handling scene transitions in route mode transparently.
   * Loops past empty scenes or exhausted executors until an action runs or
   * execution reaches a terminal state.
   */
  private _advance(): RunnerStepResult {
    for (;;) {
      // Try to execute the next pending action in the current scene.
      if (!this.executor.isDone()) {
        const step = this.executor.next();
        if (step.done) continue; // queue became empty mid-loop (shouldn't happen)

        if (this.route) {
          this.routeHistory.push(`${this.currentSceneId}.${step.trace.actionId}`);
        }
        return { done: false, sceneId: this.currentSceneId, actionId: step.trace.actionId, trace: step.trace };
      }

      // Current scene is exhausted — finalise it.
      const sceneResult = this.executor.result();
      this.state = sceneResult.stateAfterScene;

      if (!this.route) {
        // Scene mode: we're done.
        this._done = true;
        return { done: true };
      }

      // Route mode: save the scene trace and find the next scene.
      this.routeSceneTraces.push(sceneResult.trace);

      const nextSceneId = selectNextScene(
        this.routeHistory,
        this.route.match,
        this.currentSceneId,
      );

      if (nextSceneId === null) {
        this._done = true;
        return { done: true };
      }

      const nextScene = this.sceneMap[nextSceneId];
      if (!nextScene) {
        throw new Error(`Runner: unknown scene "${nextSceneId}" referenced by route`);
      }

      this.currentSceneId = nextSceneId;
      this.executor = createSceneExecutor(nextScene, this.state, this.hooks);
      // Loop again to execute the first action of the new scene.
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a Runner for the given model and options.
 *
 * The Runner is the primary execution interface:
 *   - `.registerHook(name, handler)` — register hooks before or between steps
 *   - `.next(steps?)` — advance by N actions (default 1)
 *   - `.run()` — run to completion
 *   - `.isDone()` — check if finished
 *   - `.result()` — get the final HarnessResult
 */
export function createRunner(model: TurnModel, options: RunnerOptions): Runner {
  return new Runner(model, options);
}

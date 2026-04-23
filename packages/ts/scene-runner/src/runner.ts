import type { AnyValue } from 'runtime';
import type { TurnModel } from './types/turnout-model_pb.js';
import type {
  HookRegistry,
  HookImpl,
  HarnessResult,
  ActionTrace,
  SceneTrace,
} from './types/harness-types.js';
import { stateManagerFrom, stateManagerFromSchema } from './state/state-manager.js';
import type { StateManager } from './state/state-manager.js';
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

/**
 * Step-by-step execution controller for a TurnModel.
 *
 * Works in both server and client environments — it operates on an already-
 * parsed `TurnModel`. To load a model from disk, use the server utilities
 * (`runConverter`, `loadJsonModel`) before constructing a Runner.
 *
 * @example
 * const runner = createRunner(model, { entryId: 'checkout', initialState: {} });
 * runner.useHook('get_cart', (ctx) => ({ items: buildString('a,b') }));
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
export type Runner = {
  /**
   * Register a hook handler.
   * Can be called before or between steps — mutations are picked up immediately.
   * Returns the runner for chaining.
   */
  useHook(name: string, handler: HookImpl): Runner;
  /** True when all actions have completed (scene or route finished). */
  isDone(): boolean;
  /**
   * Advance by `steps` actions (default: 1).
   * Scene transitions in route mode are handled automatically and do not
   * consume a step — each entry in the returned array represents one
   * completed action.
   *
   * Returns fewer than `steps` entries if execution finishes early.
   */
  next(steps?: number): Promise<RunnerStepResult[]>;
  /**
   * Run to completion and return the final result.
   * Equivalent to calling `next()` in a loop until done.
   */
  run(): Promise<HarnessResult>;
  /**
   * Async generator that yields one `RunnerStepResult` per completed action.
   * Terminates when execution is complete, allowing the caller to observe
   * each action incrementally and yield control between steps.
   *
   * @example
   * for await (const step of runner.runAsync()) {
   *   console.log(step.actionId, step.trace);
   * }
   * const result = runner.result();
   */
  runAsync(): AsyncGenerator<RunnerStepResult>;
  /**
   * Return the final `HarnessResult`.
   * Throws if execution is not yet complete.
   */
  result(): HarnessResult;
};

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a Runner for the given model and options.
 *
 * The Runner is the primary execution interface:
 *   - `.useHook(name, handler)` — register hooks before or between steps
 *   - `.next(steps?)` — advance by N actions (default 1)
 *   - `.run()` — run to completion
 *   - `.isDone()` — check if finished
 *   - `.result()` — get the final HarnessResult
 */
export function createRunner(model: TurnModel, options: RunnerOptions): Runner {
  const sceneMap = Object.fromEntries(model.scenes.map((s) => [s.id, s]));
  const routeMap = Object.fromEntries((model.routes ?? []).map((r) => [r.id, r]));
  const hooks: HookRegistry = {};

  let state: StateManager = model.state
    ? stateManagerFromSchema(model.state, options.initialState)
    : stateManagerFrom(options.initialState);

  const route = routeMap[options.entryId] ?? null;
  let currentSceneId: string;

  if (route) {
    const entrySceneId = model.scenes[0]?.id;
    if (!entrySceneId) {
      throw new Error(
        `Runner: route "${options.entryId}" found but model has no scenes`,
      );
    }
    currentSceneId = entrySceneId;
  } else if (sceneMap[options.entryId]) {
    currentSceneId = options.entryId;
  } else {
    throw new Error(
      `Runner: entryId "${options.entryId}" not found as route or scene in the model`,
    );
  }

  // Route mode accumulation
  const routeHistory: string[] = [];
  const routeSceneTraces: SceneTrace[] = [];

  // hooks is passed by reference so useHook() mutations are visible
  // to the executor without needing to recreate it.
  // In route mode, only the first entry action fires per scene (spec §route-entry).
  const initialScene = sceneMap[currentSceneId]!;
  let executor: SceneExecutor = createSceneExecutor(
    initialScene,
    state,
    hooks,
    route ? [initialScene.entryActions[0]!] : undefined,
  );

  let done = false;

  /**
   * Advance one action, handling scene transitions in route mode transparently.
   * Loops past empty scenes or exhausted executors until an action runs or
   * execution reaches a terminal state.
   */
  async function advance(): Promise<RunnerStepResult> {
    for (;;) {
      // Try to execute the next pending action in the current scene.
      if (!executor.isDone()) {
        const step = await executor.next();
        if (step.done) continue; // queue became empty mid-loop (shouldn't happen)

        if (route) {
          routeHistory.push(`${currentSceneId}.${step.trace.actionId}`);
        }
        return { done: false, sceneId: currentSceneId, actionId: step.trace.actionId, trace: step.trace };
      }

      // Current scene is exhausted — finalise it.
      const sceneResult = executor.result();
      state = sceneResult.stateAfterScene;

      if (!route) {
        // Scene mode: we're done.
        done = true;
        return { done: true };
      }

      // Route mode: save the scene trace and find the next scene.
      routeSceneTraces.push(sceneResult.trace);

      const nextSceneId = selectNextScene(
        routeHistory,
        route.match,
        currentSceneId,
      );

      if (nextSceneId === null) {
        done = true;
        return { done: true };
      }

      const nextScene = sceneMap[nextSceneId];
      if (!nextScene) {
        throw new Error(`Runner: unknown scene "${nextSceneId}" referenced by route`);
      }

      currentSceneId = nextSceneId;
      // Route-driven entry: only the first entry action fires (spec §route-entry).
      executor = createSceneExecutor(nextScene, state, hooks, [nextScene.entryActions[0]!]);
      // Loop again to execute the first action of the new scene.
    }
  }

  return {
    useHook(name, handler) {
      hooks[name] = handler;
      return this;
    },

    isDone() {
      return done;
    },

    async next(steps = 1) {
      const results: RunnerStepResult[] = [];
      for (let i = 0; i < steps; i++) {
        const r = await advance();
        results.push(r);
        if (r.done) break;
      }
      return results;
    },

    async run() {
      while (!done) await advance();
      return this.result();
    },

    async *runAsync() {
      while (!done) {
        const r = await advance();
        if (r.done) break;
        yield r;
      }
    },

    result() {
      if (!done) {
        throw new Error(
          'Runner: execution is not complete — call run() or step until isDone()',
        );
      }

      if (route) {
        return {
          finalState: state.snapshot(),
          trace: {
            kind: 'route',
            route: { routeId: route.id, scenes: routeSceneTraces },
          },
          model,
        };
      }

      const sceneTrace = executor.result().trace;
      return {
        finalState: state.snapshot(),
        trace: { kind: 'scene', scene: sceneTrace },
        model,
      };
    },
  };
}

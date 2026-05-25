import type { TurnModel } from './types/turnout-model_pb.js';
import type {
  ExecutionOptions,
  HookRegistry,
  PrepareHookImpl,
  PublishHookImpl,
  HarnessResult,
  ActionTrace,
} from './types/harness-types.js';
import { stateManagerFromUnchecked, stateManagerFromSchema } from './state/state-manager.js';
import type { StateManager } from './state/state-manager.js';
import { migrateModel } from './migration.js';
import {
  createSceneExecutor,
  type SceneExecutor,
} from './executor/scene-executor.js';
import { parseMatchArms } from './executor/route-pattern.js';
import type { ParsedMatchArm } from './executor/route-pattern.js';
import { createRouteStepper } from './executor/route-stepper.js';
import type { RouteStepper } from './executor/route-stepper.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type RunnerOptions = ExecutionOptions;

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
 * runner.usePrepareHook('get_cart', (ctx) => ({ items: buildString('a,b') }));
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
  /** Register a prepare hook. Returns the runner for chaining. */
  usePrepareHook(name: string, handler: PrepareHookImpl): Runner;
  /** Register a publish hook. Returns the runner for chaining. */
  usePublishHook(name: string, handler: PublishHookImpl): Runner;
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
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

type RouteEntry = { id: string; entrySceneId?: string; parsedArms: ParsedMatchArm[] };

function buildSceneMap(model: ReturnType<typeof migrateModel>) {
  return Object.fromEntries(model.scenes.map((s) => [s.id, s]));
}

function buildRouteMap(model: ReturnType<typeof migrateModel>): Record<string, RouteEntry> {
  return Object.fromEntries(
    (model.routes ?? []).map((r): [string, RouteEntry] => [
      r.id,
      { id: r.id, entrySceneId: r.entrySceneId, parsedArms: parseMatchArms(r.match) },
    ]),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a Runner for the given model and options.
 *
 * The Runner is the primary execution interface:
 *   - `.usePrepareHook(name, handler)` — register a prepare hook
 *   - `.usePublishHook(name, handler)` — register a publish hook
 *   - `.next(steps?)` — advance by N actions (default 1)
 *   - `.run()` — run to completion
 *   - `.isDone()` — check if finished
 *   - `.result()` — get the final HarnessResult
 */
export function createRunner(model: TurnModel, options: RunnerOptions): Runner {
  const migratedModel = migrateModel(model);
  const sceneMap = buildSceneMap(migratedModel);
  const routeMap = buildRouteMap(migratedModel);

  // hooks is passed by reference so registrations after construction are visible
  // to the executor without needing to recreate it.
  const hooks: HookRegistry = { prepare: {}, publish: {} };

  const initialState: StateManager = migratedModel.state
    ? stateManagerFromSchema(migratedModel.state, options.initialState)
    : stateManagerFromUnchecked(options.initialState);

  // ── Determine execution mode (route vs scene) ─────────────────────────────

  const routeEntry = routeMap[options.entryId] ?? null;
  let done = false;

  // Route mode
  if (routeEntry) {
    const entrySceneId = routeEntry.entrySceneId;
    if (!entrySceneId) {
      throw new Error(`Runner: route "${options.entryId}" has no entry scene declared`);
    }
    if (!sceneMap[entrySceneId]) {
      throw new Error(
        `Runner: route "${options.entryId}" entry scene "${entrySceneId}" is not in the model`,
      );
    }

    const routeStepper: RouteStepper = createRouteStepper(
      routeEntry.id,
      routeEntry.parsedArms,
      entrySceneId,
      sceneMap,
      initialState,
      hooks,
      options.maxSceneSteps,
      options.maxRouteTransitions,
    );

    async function advanceRoute(): Promise<RunnerStepResult> {
      const step = await routeStepper.next();
      if (step.done) {
        done = true;
        return { done: true };
      }
      return { done: false, sceneId: step.sceneId, actionId: step.trace.actionId, trace: step.trace };
    }

    return {
      usePrepareHook(name, handler) { hooks.prepare[name] = handler; return this; },
      usePublishHook(name, handler) { hooks.publish[name] = handler; return this; },
      isDone: () => done,
      async next(steps = 1) {
        const results: RunnerStepResult[] = [];
        for (let i = 0; i < steps; i++) {
          const r = await advanceRoute();
          results.push(r);
          if (r.done) break;
        }
        return results;
      },
      async run() {
        while (!done) await advanceRoute();
        return this.result();
      },
      async *runAsync() {
        while (!done) {
          const r = await advanceRoute();
          if (r.done) break;
          yield r;
        }
      },
      result() {
        if (!done) throw new Error('Runner: execution is not complete — call run() or step until isDone()');
        const { finalState, trace } = routeStepper.result();
        return {
          finalState: finalState.snapshot(),
          trace: { kind: 'route', route: trace },
          model: migratedModel,
        };
      },
    };
  }

  // Scene mode
  const scene = sceneMap[options.entryId];
  if (!scene) {
    throw new Error(`Runner: entryId "${options.entryId}" not found as route or scene in the model`);
  }

  const sceneExecutor: SceneExecutor = createSceneExecutor(
    scene,
    initialState,
    hooks,
    undefined,
    options.maxSceneSteps,
  );

  async function advanceScene(): Promise<RunnerStepResult> {
    if (sceneExecutor.isDone()) {
      done = true;
      return { done: true };
    }
    const step = await sceneExecutor.next();
    if (step.done) {
      done = true;
      return { done: true };
    }
    return { done: false, sceneId: options.entryId, actionId: step.trace.actionId, trace: step.trace };
  }

  return {
    usePrepareHook(name, handler) { hooks.prepare[name] = handler; return this; },
    usePublishHook(name, handler) { hooks.publish[name] = handler; return this; },
    isDone: () => done,
    async next(steps = 1) {
      const results: RunnerStepResult[] = [];
      for (let i = 0; i < steps; i++) {
        const r = await advanceScene();
        results.push(r);
        if (r.done) break;
      }
      return results;
    },
    async run() {
      while (!done) await advanceScene();
      return this.result();
    },
    async *runAsync() {
      while (!done) {
        const r = await advanceScene();
        if (r.done) break;
        yield r;
      }
    },
    result() {
      if (!done) throw new Error('Runner: execution is not complete — call run() or step until isDone()');
      const sceneTrace = sceneExecutor.result().trace;
      return {
        finalState: sceneExecutor.result().stateAfterScene.snapshot(),
        trace: { kind: 'scene', scene: sceneTrace },
        model: migratedModel,
      };
    },
  };
}

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
import { createRouteStepper } from './executor/route-stepper.js';
import type { RouteStepper } from './executor/route-stepper.js';
import { resolveDispatchTarget } from './executor/dispatch.js';

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
  /**
   * Return the StateManager at the current point of execution.
   * Safe to call at any time — before, during, or after execution, including
   * after a thrown `SceneRuntimeError`. Returns the state as of the last
   * successfully completed action (or the initial state if none has run yet).
   */
  partialState(): StateManager;
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the shared Runner methods (usePrepareHook, usePublishHook, isDone, next,
 * run, runAsync, result) from three mode-specific callbacks.
 * Both route and scene execution branches call this to avoid duplicating the
 * step-loop, async-generator, and result-accessor logic.
 */
function makeRunnerMethods(
  hooks: HookRegistry,
  advanceFn: () => Promise<RunnerStepResult>,
  doneFn: () => boolean,
  resultFn: () => HarnessResult,
  partialStateFn: () => StateManager,
): Runner {
  return {
    usePrepareHook(name, handler) { hooks.prepare[name] = handler; return this; },
    usePublishHook(name, handler) { hooks.publish[name] = handler; return this; },
    isDone: doneFn,
    async next(steps = 1) {
      const results: RunnerStepResult[] = [];
      for (let i = 0; i < steps; i++) {
        const r = await advanceFn();
        results.push(r);
        if (r.done) break;
      }
      return results;
    },
    async run() {
      while (!doneFn()) await advanceFn();
      return resultFn();
    },
    async *runAsync() {
      while (!doneFn()) {
        const r = await advanceFn();
        if (r.done) break;
        yield r;
      }
    },
    result: resultFn,
    partialState: partialStateFn,
  };
}

function buildSceneMap(model: ReturnType<typeof migrateModel>) {
  return Object.fromEntries(model.scenes.map((s) => [s.id, s]));
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

  // hooks is passed by reference so registrations after construction are visible
  // to the executor without needing to recreate it.
  const hooks: HookRegistry = { prepare: {}, publish: {} };

  const initialState: StateManager = migratedModel.state
    ? stateManagerFromSchema(migratedModel.state, options.initialState)
    : stateManagerFromUnchecked(options.initialState);

  // ── Determine execution mode (route vs scene) ─────────────────────────────

  const target = resolveDispatchTarget(migratedModel, options.entryId, sceneMap);
  let done = false;

  // Route mode
  if (target.kind === 'route') {
    const routeStepper: RouteStepper = createRouteStepper(
      target.route.id,
      parseMatchArms(target.route.match),
      target.entryScene.id,
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

    return makeRunnerMethods(
      hooks,
      advanceRoute,
      () => done,
      () => {
        if (!done) throw new Error('Runner: execution is not complete — call run() or step until isDone()');
        const { finalState, trace } = routeStepper.result();
        return {
          finalState: finalState.snapshot(),
          trace: { kind: 'route', route: trace },
          model: migratedModel,
        };
      },
      () => routeStepper.partialState(),
    );
  }

  // Scene mode
  const sceneExecutor: SceneExecutor = createSceneExecutor(
    target.scene,
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

  return makeRunnerMethods(
    hooks,
    advanceScene,
    () => done,
    () => {
      if (!done) throw new Error('Runner: execution is not complete — call run() or step until isDone()');
      const sceneTrace = sceneExecutor.result().trace;
      return {
        finalState: sceneExecutor.result().stateAfterScene.snapshot(),
        trace: { kind: 'scene', scene: sceneTrace },
        model: migratedModel,
      };
    },
    () => sceneExecutor.partialState(),
  );
}

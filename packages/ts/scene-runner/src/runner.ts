import type { TurnModel, RouteModel, SceneBlock } from './types/turnout-model_pb.js';
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
  | { done: false; kind: 'action'; sceneId: string; actionId: string; trace: ActionTrace }
  | { done: false; kind: 'scene-transition'; fromSceneId: string; toSceneId: string };

/**
 * Step-by-step execution controller for a TurnModel.
 *
 * Works in both server and client environments — it operates on an already-
 * parsed `TurnModel`. To load a model from disk, use the server utilities
 * (`runConverter`, `loadJsonModel`) before constructing a Runner.
 *
 * **Error handling:** `next()` and `run()` can throw `SceneRuntimeError` or
 * `RouteRuntimeError` for unrecoverable runtime faults. Known `SceneRuntimeError`
 * codes: `MaxStepsExceeded`, `UnknownAction`, `DuplicateActionId`, `UnknownFunction`,
 * `UnknownArgModel`. Use `executeSceneSafe` directly if you need partial-state
 * recovery on failure.
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
   * In route mode, `scene-transition` events are interleaved in the returned
   * array but do not count against the `steps` budget. Only `kind: 'action'`
   * results consume a step. The returned array may therefore contain more than
   * `steps` entries when scene transitions occur.
   *
   * Returns fewer than `steps` action entries if execution finishes early.
   *
   * @throws {SceneRuntimeError} `MaxStepsExceeded` | `UnknownAction` | `UnknownFunction` | `UnknownArgModel`
   * @throws {RouteRuntimeError} `MaxRouteTransitionsExceeded` | `UnknownScene`
   */
  next(steps?: number): Promise<RunnerStepResult[]>;
  /**
   * Run to completion and return the final result.
   * Equivalent to calling `next()` in a loop until done.
   *
   * @throws {SceneRuntimeError} `MaxStepsExceeded` | `UnknownAction` | `UnknownFunction` | `UnknownArgModel`
   * @throws {RouteRuntimeError} `MaxRouteTransitionsExceeded` | `UnknownScene`
   */
  run(): Promise<HarnessResult>;
  /**
   * Async generator that yields one `RunnerStepResult` per completed action or
   * scene transition. In route mode, `scene-transition` events are yielded
   * between the last action of one scene and the first action of the next.
   * Terminates when execution is complete.
   *
   * @example
   * for await (const step of runner.runAsync()) {
   *   if (step.kind === 'scene-transition') { ... }
   *   else { console.log(step.actionId, step.trace); }
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
  signal: AbortSignal,
): Runner {
  function checkAborted(): void {
    if (signal.aborted) throw new DOMException('Runner aborted', 'AbortError');
  }
  return {
    usePrepareHook(name, handler) { hooks.prepare[name] = handler; return this; },
    usePublishHook(name, handler) { hooks.publish[name] = handler; return this; },
    isDone: doneFn,
    async next(steps = 1) {
      const results: RunnerStepResult[] = [];
      let actionCount = 0;
      while (actionCount < steps) {
        checkAborted();
        const r = await advanceFn();
        results.push(r);
        if (r.done) break;
        if (r.kind === 'action') actionCount++;
      }
      return results;
    },
    async run() {
      while (!doneFn()) {
        checkAborted();
        await advanceFn();
      }
      return resultFn();
    },
    async *runAsync() {
      while (!doneFn()) {
        checkAborted();
        const r = await advanceFn();
        if (r.done) break;
        yield r;
      }
    },
    result: resultFn,
    partialState: partialStateFn,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a Runner that executes a single scene.
 *
 * Lower-level than `createRunner`: takes a resolved `SceneBlock` directly, so
 * model migration and dispatch resolution are the caller's responsibility.
 * Useful for tests that want to exercise a specific scene in isolation.
 *
 * `initialState` may be passed pre-built (e.g. from `stateManagerFromSchema`)
 * to preserve schema validation. When absent, `options.initialState` is used
 * with `stateManagerFromUnchecked`.
 */
export function createSceneRunner(
  scene: SceneBlock,
  options: RunnerOptions,
  initialState?: StateManager,
): Runner {
  const signal = options.signal ?? new AbortController().signal;
  const hooks: HookRegistry = { prepare: {}, publish: {} };
  const state = initialState ?? stateManagerFromUnchecked(options.initialState);

  const sceneExecutor: SceneExecutor = createSceneExecutor(
    scene,
    state,
    hooks,
    undefined,
    options.maxSceneSteps,
    signal,
  );

  let done = false;

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
    return { done: false, kind: 'action', sceneId: scene.id, actionId: step.trace.actionId, trace: step.trace };
  }

  return makeRunnerMethods(
    hooks,
    advanceScene,
    () => done,
    () => {
      if (!done) throw new Error('Runner: execution is not complete — call run() or step until isDone()');
      const res = sceneExecutor.result();
      return {
        finalState: res.stateAfterScene.snapshot(),
        trace: { kind: 'scene', scene: res.trace },
      };
    },
    () => sceneExecutor.partialState(),
    signal,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Route factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a Runner that executes a route across multiple scenes.
 *
 * Lower-level than `createRunner`: takes a resolved `RouteModel`, the entry
 * scene, and a pre-built scene map. Useful for tests that want to exercise a
 * specific route without constructing a full `TurnModel`.
 *
 * `initialState` may be passed pre-built (e.g. from `stateManagerFromSchema`)
 * to preserve schema validation. When absent, `options.initialState` is used
 * with `stateManagerFromUnchecked`.
 */
export function createRouteRunner(
  route: RouteModel,
  entryScene: SceneBlock,
  sceneMap: Record<string, SceneBlock>,
  options: RunnerOptions,
  initialState?: StateManager,
): Runner {
  const signal = options.signal ?? new AbortController().signal;
  const hooks: HookRegistry = { prepare: {}, publish: {} };
  const state = initialState ?? stateManagerFromUnchecked(options.initialState);

  const routeStepper: RouteStepper = createRouteStepper(
    route.id,
    parseMatchArms(route.match),
    entryScene.id,
    sceneMap,
    state,
    hooks,
    options.maxSceneSteps,
    options.maxRouteTransitions,
    signal,
  );

  let done = false;
  let prevSceneId = entryScene.id;
  let pendingStep: { sceneId: string; trace: ActionTrace } | null = null;

  async function advanceRoute(): Promise<RunnerStepResult> {
    if (signal.aborted) throw new DOMException('Runner aborted', 'AbortError');
    if (done) return { done: true };
    // Return a deferred action step that was stashed while emitting a transition.
    if (pendingStep !== null) {
      const step = pendingStep;
      pendingStep = null;
      return { done: false, kind: 'action', sceneId: step.sceneId, actionId: step.trace.actionId, trace: step.trace };
    }

    const step = await routeStepper.next();
    if (step.done) {
      done = true;
      return { done: true };
    }

    // Emit a scene-transition event before the first action of a new scene.
    if (step.sceneId !== prevSceneId) {
      const fromSceneId = prevSceneId;
      prevSceneId = step.sceneId;
      pendingStep = { sceneId: step.sceneId, trace: step.trace };
      return { done: false, kind: 'scene-transition', fromSceneId, toSceneId: step.sceneId };
    }

    return { done: false, kind: 'action', sceneId: step.sceneId, actionId: step.trace.actionId, trace: step.trace };
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
      };
    },
    () => routeStepper.partialState(),
    signal,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Full-model factory (thin dispatcher)
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
 *
 * `next()` and `run()` may throw `SceneRuntimeError` or `RouteRuntimeError`.
 * Use `executeSceneSafe` if you need partial-state recovery on failure.
 *
 * For testing individual modes without a full model, use `createSceneRunner` or
 * `createRouteRunner` directly.
 */
export function createRunner(model: TurnModel, options: RunnerOptions): Runner {
  const migratedModel = migrateModel(model);
  const sceneMap = Object.fromEntries(migratedModel.scenes.map((s) => [s.id, s]));

  if (!migratedModel.state) {
    (options.onWarning ?? console.warn)(
      '[turnout] No STATE schema in model — using unchecked StateManager. ' +
      'Merge typos will silently produce null values.',
    );
  }
  const initialState: StateManager = migratedModel.state
    ? stateManagerFromSchema(migratedModel.state, options.initialState)
    : stateManagerFromUnchecked(options.initialState);

  const target = resolveDispatchTarget(migratedModel, options.entryId);

  if (target.kind === 'route') {
    return createRouteRunner(target.route, target.entryScene, sceneMap, options, initialState);
  }
  return createSceneRunner(target.scene, options, initialState);
}

import type { TurnModel, RouteModel, SceneBlock } from "./types/turnout-model_pb.js";
import type {
  ExecutionOptions,
  HookRegistry,
  PrepareHookImpl,
  PublishHookImpl,
  HarnessResult,
  FullHarnessResult,
  FragmentHarnessResult,
  ActionTrace,
} from "./types/harness-types.js";
import { stateManagerFromUnchecked, stateManagerFromSchema } from "./state/state-manager.js";
import type { StateManager } from "./state/state-manager.js";
import { migrateModel, checkSceneForExtExpr } from "./migration.js";
import { createSceneExecutor, type SceneExecutor } from "./executor/scene-executor.js";
import { parseMatchArms } from "./executor/route-pattern.js";
import { createRouteStepper } from "./executor/route-stepper.js";
import type { RouteStepper } from "./executor/route-stepper.js";
import { resolveDispatchTarget } from "./executor/dispatch.js";
import { validateModel } from "./executor/validate-model.js";
import { ModelValidationError, RunnerError } from "./executor/errors.js";
import { snapshotModel } from "./model-snapshot.js";
import { makeRunnerMethods } from "./runner-methods.js";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type RunnerOptions = ExecutionOptions;

export type RunnerStepResult =
  | { done: true }
  | { done: false; kind: "action"; sceneId: string; actionId: string; trace: ActionTrace }
  | { done: false; kind: "scene-transition"; fromSceneId: string; toSceneId: string };

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
 *   const [step] = await runner.next();
 * }
 * const result = runner.result();
 *
 * // Or run to completion in one call
 * const result = await runner.run();
 */
export type Runner<R extends HarnessResult = HarnessResult> = {
  /**
   * Register a prepare hook. Returns the runner for chaining.
   * Must be called before the first `next()` or `run()` invocation.
   * Hook registrations after execution has started throw RunnerError with code `LateHookRegistration`.
   */
  usePrepareHook(name: string, handler: PrepareHookImpl): Runner<R>;
  /**
   * Register a publish hook. Returns the runner for chaining.
   * Must be called before the first `next()` or `run()` invocation.
   * Hook registrations after execution has started throw RunnerError with code `LateHookRegistration`.
   */
  usePublishHook(name: string, handler: PublishHookImpl): Runner<R>;
  /** True when all actions have completed (scene or route finished). */
  isDone(): boolean;
  /**
   * Advance by `steps` actions (default: 1). Returns an array of non-terminal
   * step results — the `{ done: true }` sentinel is never included. Call
   * `isDone()` to check whether execution completed within this call.
   *
   * In route mode, `scene-transition` events are interleaved in the returned
   * array but do not count against the `steps` budget. Only `kind: 'action'`
   * results consume a step. The returned array may therefore contain more than
   * `steps` entries when scene transitions occur.
   *
   * Returns fewer than `steps` action entries if execution finishes early.
   *
   * @throws {RunnerError} `InvalidStepCount` when `steps` is not a positive safe integer.
   * @throws {SceneRuntimeError} `MaxStepsExceeded` | `UnknownAction` | `UnknownFunction` | `UnknownArgModel`
   * @throws {RouteRuntimeError} `MaxRouteTransitionsExceeded` | `UnknownScene`
   */
  next(steps?: number): Promise<Array<Exclude<RunnerStepResult, { done: true }>>>;
  /**
   * Run to completion and return the final result.
   * Equivalent to calling `next()` in a loop until done.
   *
   * @throws {SceneRuntimeError} `MaxStepsExceeded` | `UnknownAction` | `UnknownFunction` | `UnknownArgModel`
   * @throws {RouteRuntimeError} `MaxRouteTransitionsExceeded` | `UnknownScene`
   */
  run(): Promise<R>;
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
  result(): R;
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

function assertUncheckedStateAllowed(options: RunnerOptions, detail: string): void {
  if (options.allowUncheckedState === true) return;
  throw new RunnerError(
    "UncheckedStateNotAllowed",
    detail + ". Pass allowUncheckedState: true to run without STATE schema.",
  );
}

function warnUncheckedState(options: RunnerOptions, detail: string): void {
  options.onWarning?.(
    "[turnout] " +
      detail +
      " - using unchecked StateManager. " +
      "All merge writes succeed regardless of path; typo'd paths silently read as null " +
      'on subsequent steps. An "unchecked_state_write" ActionWarning is emitted in the ' +
      "trace for each action that writes to state.",
  );
}

function validateExecutionLimits(options: RunnerOptions): void {
  for (const [name, value] of [
    ["maxSceneSteps", options.maxSceneSteps],
    ["maxRouteTransitions", options.maxRouteTransitions],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new RunnerError(
        "InvalidExecutionLimit",
        `${name} requires a non-negative safe integer, got ${value}`,
      );
    }
  }
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
  inputScene: SceneBlock,
  options: RunnerOptions,
  initialState?: StateManager,
): Runner<FragmentHarnessResult> {
  const scene = snapshotModel(inputScene);
  validateExecutionLimits(options);
  const signal = options.signal ?? new AbortController().signal;
  const hooks: HookRegistry = { prepare: {}, publish: {} };
  let state: StateManager;
  if (initialState === undefined) {
    const detail = "No STATE schema supplied to createSceneRunner";
    assertUncheckedStateAllowed(options, detail);
    warnUncheckedState(options, detail);
    state = stateManagerFromUnchecked(options.initialState);
  } else {
    state = initialState;
  }

  checkSceneForExtExpr(scene);

  const { onLog } = options;

  const sceneExecutor: SceneExecutor = createSceneExecutor(
    scene,
    state,
    hooks,
    undefined,
    options.maxSceneSteps,
    signal,
    onLog,
    options.failOnPublishError,
  );

  let done = false;
  let sceneStartEmitted = false;
  let sceneCompleteEmitted = false;

  function finishScene(): void {
    done = true;
    if (!sceneCompleteEmitted) {
      sceneCompleteEmitted = true;
      const res = sceneExecutor.result();
      onLog?.({ kind: "scene-complete", sceneId: scene.id, terminatedAt: res.terminatedAt });
    }
  }

  async function advanceScene(): Promise<RunnerStepResult> {
    if (!sceneStartEmitted) {
      sceneStartEmitted = true;
      onLog?.({ kind: "scene-start", sceneId: scene.id, entryActions: scene.entryActions });
    }
    if (sceneExecutor.isDone()) {
      finishScene();
      return { done: true };
    }
    const step = await sceneExecutor.next();
    if (step.done) {
      finishScene();
      return { done: true };
    }
    const result: RunnerStepResult = {
      done: false,
      kind: "action",
      sceneId: scene.id,
      actionId: step.trace.actionId,
      trace: step.trace,
    };
    if (sceneExecutor.isDone()) finishScene();
    return result;
  }

  return makeRunnerMethods(
    hooks,
    advanceScene,
    () => done,
    () => {
      if (!done)
        throw new RunnerError(
          "IncompleteExecution",
          "execution is not complete — call run() or step until isDone()",
        );
      const res = sceneExecutor.result();
      return {
        finalState: res.stateAfterScene.snapshot(),
        trace: { kind: "scene", scene: res.trace },
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
  inputRoute: RouteModel,
  inputEntryScene: SceneBlock,
  inputSceneMap: Record<string, SceneBlock>,
  options: RunnerOptions,
  initialState?: StateManager,
): Runner<FragmentHarnessResult> {
  const { route, entryScene, sceneMap } = snapshotModel({
    route: inputRoute,
    entryScene: inputEntryScene,
    sceneMap: inputSceneMap,
  });
  validateExecutionLimits(options);
  const signal = options.signal ?? new AbortController().signal;
  const hooks: HookRegistry = { prepare: {}, publish: {} };
  let state: StateManager;
  if (initialState === undefined) {
    const detail = "No STATE schema supplied to createRouteRunner";
    assertUncheckedStateAllowed(options, detail);
    warnUncheckedState(options, detail);
    state = stateManagerFromUnchecked(options.initialState);
  } else {
    state = initialState;
  }

  checkSceneForExtExpr(entryScene);
  for (const s of Object.values(sceneMap)) checkSceneForExtExpr(s);

  const { onLog } = options;

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
    onLog,
    options.failOnPublishError,
  );

  type RouteAdvanceState =
    | { kind: "advancing"; prevSceneId: string }
    | { kind: "transition-emitted"; pendingAction: { sceneId: string; trace: ActionTrace } }
    | { kind: "done" };

  let advState: RouteAdvanceState = { kind: "advancing", prevSceneId: entryScene.id };

  async function advanceRoute(): Promise<RunnerStepResult> {
    // Abort is checked by makeRunnerMethods before every advanceFn() call.
    if (advState.kind === "done") return { done: true };

    // Return a deferred action step that was stashed while emitting a transition.
    if (advState.kind === "transition-emitted") {
      const { pendingAction } = advState;
      advState = routeStepper.isDone()
        ? { kind: "done" }
        : { kind: "advancing", prevSceneId: pendingAction.sceneId };
      return {
        done: false,
        kind: "action",
        sceneId: pendingAction.sceneId,
        actionId: pendingAction.trace.actionId,
        trace: pendingAction.trace,
      };
    }

    const step = await routeStepper.next();
    if (step.done) {
      advState = { kind: "done" };
      return { done: true };
    }

    // Emit a scene-transition event before the first action of a new scene.
    if (step.sceneId !== advState.prevSceneId) {
      const fromSceneId = advState.prevSceneId;
      onLog?.({ kind: "route-transition", fromSceneId, toSceneId: step.sceneId });
      advState = {
        kind: "transition-emitted",
        pendingAction: { sceneId: step.sceneId, trace: step.trace },
      };
      return { done: false, kind: "scene-transition", fromSceneId, toSceneId: step.sceneId };
    }

    if (routeStepper.isDone()) advState = { kind: "done" };
    return {
      done: false,
      kind: "action",
      sceneId: step.sceneId,
      actionId: step.trace.actionId,
      trace: step.trace,
    };
  }

  return makeRunnerMethods(
    hooks,
    advanceRoute,
    () => advState.kind === "done",
    () => {
      if (advState.kind !== "done")
        throw new RunnerError(
          "IncompleteExecution",
          "execution is not complete — call run() or step until isDone()",
        );
      const { finalState, trace } = routeStepper.result();
      return {
        finalState: finalState.snapshot(),
        trace: { kind: "route", route: trace },
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
 * @throws {Error} When the model's version constraints are incompatible with the
 *   current runtime (version too old, too new, or out of min/max bounds).
 *   Thrown synchronously before any execution begins.
 *
 * For testing individual modes without a full model, use `createSceneRunner` or
 * `createRouteRunner` directly.
 */
/**
 * Adapts a `Runner<A>` into a `Runner<B>` by applying `transform` to every
 * result produced by `run()` and `result()`. The hook-registration methods
 * delegate to the inner runner and return the outer runner for chaining.
 * `runAsync`, `next`, `isDone`, and `partialState` are forwarded unchanged.
 */
function mapRunnerResult<A extends HarnessResult, B extends HarnessResult>(
  inner: Runner<A>,
  transform: (a: A) => B,
): Runner<B> {
  const outer: Runner<B> = {
    usePrepareHook: (name, handler) => {
      inner.usePrepareHook(name, handler);
      return outer;
    },
    usePublishHook: (name, handler) => {
      inner.usePublishHook(name, handler);
      return outer;
    },
    isDone: () => inner.isDone(),
    next: (steps) => inner.next(steps),
    run: async () => transform(await inner.run()),
    runAsync: () => inner.runAsync(),
    result: () => transform(inner.result()),
    partialState: () => inner.partialState(),
  };
  return outer;
}

export function createRunner(
  inputModel: TurnModel,
  options: RunnerOptions,
): Runner<FullHarnessResult> {
  const migratedModel = migrateModel(snapshotModel(inputModel));
  const validationErrors = validateModel(migratedModel);
  if (validationErrors.length > 0) {
    throw new ModelValidationError(validationErrors);
  }
  const sceneMap = Object.fromEntries(migratedModel.scenes.map((s) => [s.id, s]));

  const target = resolveDispatchTarget(migratedModel, options.entryId);

  let initialState: StateManager;
  if (migratedModel.state) {
    initialState = stateManagerFromSchema(migratedModel.state, options.initialState);
  } else {
    const detail = "No STATE schema in model";
    assertUncheckedStateAllowed(options, detail);
    warnUncheckedState(options, detail);
    initialState = stateManagerFromUnchecked(options.initialState);
  }

  const inner: Runner<FragmentHarnessResult> =
    target.kind === "route"
      ? createRouteRunner(target.route, target.entryScene, sceneMap, options, initialState)
      : createSceneRunner(target.scene, options, initialState);

  return mapRunnerResult(inner, (r) => ({ ...r, model: migratedModel }));
}

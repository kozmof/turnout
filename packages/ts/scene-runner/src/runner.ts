import type { TurnModel, RouteModel, SceneBlock } from "./types/turnout-model_pb.js";
import type {
  ActionTrace,
  HookRegistry,
  HarnessResult,
  FullHarnessResult,
  FragmentHarnessResult,
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
import { snapshotModel, snapshotRecord } from "./model-snapshot.js";
import { makeRunnerMethods } from "./runner-methods.js";
import { collectSceneWarnings } from "./executor/collect-warnings.js";
import { safeLog } from "./executor/logging.js";

import type { Runner, RunnerOptions, RunnerStepResult } from "./runner-types.js";
import {
  assertUncheckedStateAllowed,
  validateExecutionLimits,
  warnUncheckedState,
} from "./runner-validation.js";

export type { Runner, RunnerOptions, RunnerStepResult } from "./runner-types.js";

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
  const hooks: HookRegistry = {
    prepare: Object.create(null) as HookRegistry["prepare"],
    publish: Object.create(null) as HookRegistry["publish"],
  };
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
      safeLog(onLog, {
        kind: "scene-complete",
        sceneId: scene.id,
        terminatedAt: res.terminatedAt,
      });
    }
  }

  async function advanceScene(): Promise<RunnerStepResult> {
    if (!sceneStartEmitted) {
      sceneStartEmitted = true;
      safeLog(onLog, {
        kind: "scene-start",
        sceneId: scene.id,
        entryAction: scene.entryAction,
      });
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
      const warnings = collectSceneWarnings([res.trace]);
      return {
        finalState: res.stateAfterScene.snapshot(),
        trace: { kind: "scene", scene: res.trace },
        ...(warnings.length > 0 ? { warnings } : {}),
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
  // Snapshotted per argument rather than as one wrapper object: the wrapper is
  // always fresh, so snapshotting it would deep-clone scenes that `createRunner`
  // has already snapshotted — and change their identity out from under the
  // executor's per-`ProgModel` context cache.
  const route = snapshotModel(inputRoute);
  const entryScene = snapshotModel(inputEntryScene);
  const sceneMap = snapshotRecord(inputSceneMap);
  validateExecutionLimits(options);
  const signal = options.signal ?? new AbortController().signal;
  const hooks: HookRegistry = {
    prepare: Object.create(null) as HookRegistry["prepare"],
    publish: Object.create(null) as HookRegistry["publish"],
  };
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
      safeLog(onLog, { kind: "route-transition", fromSceneId, toSceneId: step.sceneId });
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
      const { finalState, trace, warnings } = routeStepper.result();
      return {
        finalState: finalState.snapshot(),
        trace: { kind: "route", route: trace },
        ...(warnings ? { warnings } : {}),
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

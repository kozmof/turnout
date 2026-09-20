import { fromJson, type JsonObject } from "@bufbuild/protobuf";
import type { TurnModel, RouteModel, SceneBlock } from "./types/turnout-model_pb.js";
import { RouteModelSchema, SceneBlockSchema, TurnModelSchema } from "./types/turnout-model_pb.js";
import type {
  HarnessResult,
  FullHarnessResult,
  FragmentHarnessResult,
} from "./types/harness-types.js";
import type { StateManager } from "./state/state-manager.js";
import { migrateModel, checkSceneForExtExpr } from "./migration.js";
import { resolveDispatchTarget } from "./dispatch.js";
import { validateModel } from "./validate-model.js";
import { ModelValidationError } from "./errors.js";
import { encodeZigRuntimeModel, protoJson } from "./model-encoding.js";
import { snapshotModel, snapshotRecord } from "./model-snapshot.js";
import type { Runner, RunnerOptions } from "./runner-types.js";
import {
  assertUncheckedStateAllowed,
  validateExecutionLimits,
  warnUncheckedState,
} from "./runner-validation.js";
import { defaultZigRuntimeClient } from "./zig-runtime/default-client.js";
import {
  createZigRouteRunner,
  createZigSceneRunner,
  modelSourceFromHandle,
  type RuntimeModelSource,
} from "./zig-runtime/runner-adapter.js";

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
  checkSceneForExtExpr(scene);
  if (initialState === undefined) {
    const detail = "No STATE schema supplied to createSceneRunner";
    assertUncheckedStateAllowed(options, detail);
    warnUncheckedState(options, detail);
  }
  const model = syntheticModel([scene], []);
  return createZigSceneRunner(defaultZigRuntimeClient, encodeZigRuntimeModel(model), scene.id, {
    ...options,
    initialState: initialState?.snapshot() ?? options.initialState,
  });
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
  const route = { ...snapshotModel(inputRoute), entrySceneId: inputEntryScene.id };
  const entryScene = snapshotModel(inputEntryScene);
  const sceneMap = snapshotRecord(inputSceneMap);
  validateExecutionLimits(options);
  checkSceneForExtExpr(entryScene);
  for (const scene of Object.values(sceneMap)) checkSceneForExtExpr(scene);
  if (initialState === undefined) {
    const detail = "No STATE schema supplied to createRouteRunner";
    assertUncheckedStateAllowed(options, detail);
    warnUncheckedState(options, detail);
  }
  const scenes = Object.values(sceneMap);
  if (!scenes.some((scene) => scene.id === entryScene.id)) scenes.unshift(entryScene);
  const model = syntheticModel(scenes, [route]);
  return createZigRouteRunner(defaultZigRuntimeClient, encodeZigRuntimeModel(model), route.id, {
    ...options,
    initialState: initialState?.snapshot() ?? options.initialState,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Full-model factory (thin dispatcher)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a Runner for the given model and options.
 *
 * The Runner is the primary execution interface:
 *   - `.usePrepareHook(name, handler)` — register a prepare hook
 *   - `.useExtendHook(name, handler)` — register an extend hook
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
    useExtendHook: (name, handler) => {
      inner.useExtendHook(name, handler);
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
  inputModel: TurnModel | PreparedModel,
  options: RunnerOptions,
): Runner<FullHarnessResult> {
  return createZigRunner(inputModel, options);
}

/**
 * Wrap loose scenes and routes in the one-model shape the runtime loads.
 *
 * Each fragment goes through `protoJson` rather than a `JSON.stringify` round
 * trip. A decoded `SceneBlock` holds its literals as `google.protobuf.Value`
 * wrapper objects, and stringifying one renders the wrapper; re-parsing that
 * would turn every literal binding, STATE default, and `fromLiteral` entry into
 * a record — silently, because the result is still a structurally valid model.
 */
function syntheticModel(scenes: SceneBlock[], routes: RouteModel[]): TurnModel {
  const json: JsonObject = {
    version: 2,
    scenes: scenes.map((scene) => protoJson(SceneBlockSchema, scene)),
    routes: routes.map((route) => protoJson(RouteModelSchema, route)),
  };
  return fromJson(TurnModelSchema, json, { ignoreUnknownFields: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Prepared models
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A model that has been through everything `createRunner` would otherwise redo
 * on every call: snapshotting, migration, validation, encoding, and the
 * runtime's own parse, validate, index, and lower.
 *
 * None of that depends on the run, and it is the larger part of what creating a
 * runner costs. Preparing a model once and creating runners from it leaves only
 * the per-run setup.
 *
 * A prepared model holds a handle inside the WASM runtime. Call {@link release}
 * when finished with it; runners already created stay valid, because the model
 * lives until the last of them is done.
 */
export class PreparedModel {
  /** @internal */ readonly model: TurnModel;
  /** @internal */ readonly source: RuntimeModelSource;
  readonly #handle: number;
  #released = false;

  /** @internal */
  constructor(model: TurnModel, handle: number, source: RuntimeModelSource) {
    this.model = model;
    this.#handle = handle;
    this.source = source;
  }

  /** True once {@link release} has been called. */
  get released(): boolean {
    return this.#released;
  }

  /**
   * Release the runtime's copy of this model. Idempotent. Runners already
   * created against it continue to work; creating new ones does not.
   */
  release(): void {
    if (this.#released) return;
    this.#released = true;
    defaultZigRuntimeClient.destroyModel(this.#handle);
  }
}

/**
 * Prepare a model for repeated execution.
 *
 * Validates exactly as `createRunner` does, so a malformed model throws here
 * rather than on first use.
 */
export function prepareModel(inputModel: TurnModel): PreparedModel {
  const migratedModel = migrateModel(snapshotModel(inputModel));
  const validationErrors = validateModel(migratedModel);
  if (validationErrors.length > 0) throw new ModelValidationError(validationErrors);
  const encoded = encodeZigRuntimeModel(migratedModel);
  const prepared = defaultZigRuntimeClient.prepareModel(encoded);
  if (prepared.status !== "ok") {
    throw new ModelValidationError([`runtime rejected the model: ${String(prepared.status)}`]);
  }
  const handle = prepared.payload.handle;
  return new PreparedModel(
    migratedModel,
    handle,
    modelSourceFromHandle((request) => defaultZigRuntimeClient.createWithModel(handle, request)),
  );
}

function createZigRunner(
  inputModel: TurnModel | PreparedModel,
  options: RunnerOptions,
): Runner<FullHarnessResult> {
  const prepared = inputModel instanceof PreparedModel ? inputModel : undefined;
  const migratedModel = prepared?.model ?? runValidation(inputModel as TurnModel);
  validateExecutionLimits(options);
  const target = resolveDispatchTarget(migratedModel, options.entryId);
  if (!migratedModel.state) {
    const detail = "No STATE schema in model";
    assertUncheckedStateAllowed(options, detail);
    warnUncheckedState(options, detail);
  }
  // A prepared model already carries its runtime handle and prepare index; an
  // unprepared one is encoded here and re-read by the runtime on creation.
  const source = prepared?.source ?? encodeZigRuntimeModel(migratedModel);
  const inner =
    target.kind === "route"
      ? createZigRouteRunner(defaultZigRuntimeClient, source, target.route.id, options)
      : createZigSceneRunner(defaultZigRuntimeClient, source, target.scene.id, options);
  return mapRunnerResult(inner, (result) => ({ ...result, model: migratedModel }));
}

function runValidation(inputModel: TurnModel): TurnModel {
  const migratedModel = migrateModel(snapshotModel(inputModel));
  const validationErrors = validateModel(migratedModel);
  if (validationErrors.length > 0) throw new ModelValidationError(validationErrors);
  return migratedModel;
}

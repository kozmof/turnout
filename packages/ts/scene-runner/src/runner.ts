import { toJson } from "@bufbuild/protobuf";
import type { TurnModel, RouteModel, SceneBlock } from "./types/turnout-model_pb.js";
import { TurnModelSchema } from "./types/turnout-model_pb.js";
import type {
  HarnessResult,
  FullHarnessResult,
  FragmentHarnessResult,
} from "./types/harness-types.js";
import type { StateManager } from "./state/state-manager.js";
import { migrateModel, checkSceneForExtExpr } from "./migration.js";
import { resolveDispatchTarget } from "./executor/dispatch.js";
import { validateModel } from "./executor/validate-model.js";
import { ModelValidationError } from "./executor/errors.js";
import { snapshotModel, snapshotRecord } from "./model-snapshot.js";
import type { Runner, RunnerOptions } from "./runner-types.js";
import {
  assertUncheckedStateAllowed,
  validateExecutionLimits,
  warnUncheckedState,
} from "./runner-validation.js";
import { defaultZigRuntimeClient } from "./zig-runtime/default-client.js";
import { createZigRouteRunner, createZigSceneRunner } from "./zig-runtime/runner-adapter.js";

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
  const model = { version: 2, scenes: [scene], routes: [] } as unknown as TurnModel;
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
  const model = { version: 2, scenes, routes: [route] } as unknown as TurnModel;
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
  return createZigRunner(inputModel, options);
}

function encodeZigRuntimeModel(model: TurnModel): Uint8Array {
  let protobufJson: unknown;
  try {
    protobufJson = toJson(TurnModelSchema, model);
  } catch {
    protobufJson = model;
  }
  const json = runtimeProjection(protobufJson);
  return new TextEncoder().encode(JSON.stringify({ ...json, version: 2 }));
}

function runtimeProjection(input: unknown): Record<string, unknown> {
  const root = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  delete root.annotations;
  for (const declaration of arrayRecords(root.typeDecls)) delete declaration.sourcePos;
  for (const scene of arrayRecords(root.scenes)) {
    const view = objectRecord(scene.view);
    if (view !== undefined) {
      delete view.nodes;
      delete view.edges;
      delete view.sourcePos;
    }
    for (const action of arrayRecords(scene.actions)) {
      stripComputeMetadata(action.compute);
      for (const rule of arrayRecords(action.next)) stripComputeMetadata(rule.compute);
    }
  }
  return root;
}

function stripComputeMetadata(input: unknown): void {
  const compute = objectRecord(input);
  const prog = objectRecord(compute?.prog);
  if (prog === undefined) return;
  delete prog.sigils;
  for (const binding of arrayRecords(prog.bindings)) {
    delete binding.extExpr;
    delete binding.sourcePos;
    delete binding.declaredType;
  }
}

function arrayRecords(input: unknown): Record<string, unknown>[] {
  return Array.isArray(input)
    ? input.filter((entry): entry is Record<string, unknown> => objectRecord(entry) !== undefined)
    : [];
}

function objectRecord(input: unknown): Record<string, unknown> | undefined {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}

function createZigRunner(inputModel: TurnModel, options: RunnerOptions): Runner<FullHarnessResult> {
  const migratedModel = migrateModel(snapshotModel(inputModel));
  const validationErrors = validateModel(migratedModel);
  if (validationErrors.length > 0) throw new ModelValidationError(validationErrors);
  validateExecutionLimits(options);
  const target = resolveDispatchTarget(migratedModel, options.entryId);
  if (!migratedModel.state) {
    const detail = "No STATE schema in model";
    assertUncheckedStateAllowed(options, detail);
    warnUncheckedState(options, detail);
  }
  const encodedModel = encodeZigRuntimeModel(migratedModel);
  const inner =
    target.kind === "route"
      ? createZigRouteRunner(defaultZigRuntimeClient, encodedModel, target.route.id, options)
      : createZigSceneRunner(defaultZigRuntimeClient, encodedModel, target.scene.id, options);
  return mapRunnerResult(inner, (result) => ({ ...result, model: migratedModel }));
}

import type {
  ActionTrace,
  ActionWarning,
  ExecutionWarning,
  HookRegistry,
  PublishHookOutcome,
  SceneTrace,
  SceneWarning,
} from "../types/harness-types.js";
import type { FragmentHarnessResult } from "../types/harness-types.js";
import type { Runner, RunnerOptions, RunnerStepResult } from "../runner-types.js";
import { makeRunnerMethods } from "../runner-methods.js";
import {
  PrepareError,
  PublishHookFailedError,
  RouteRuntimeError,
  RunnerError,
  SceneRuntimeError,
} from "../errors.js";
import { ModelMergeError } from "../merge-models.js";
import { safeLog, safeWarn } from "../logging.js";
import { stateManagerFromUnchecked } from "../state/state-manager.js";
import type { ZigResponse, CreatedRuntime } from "./client.js";
import {
  dispatchZigEffect,
  type ZigEffectRequest,
  type ZigEffectResult,
} from "./effect-dispatcher.js";
import { fromCanonicalValue, toCanonicalValue } from "./value-codec.js";

type ZigWarning =
  | { kind: "merge"; binding: string; toState: string }
  | { kind: "uncheckedStateWrite"; writtenPaths: string[] }
  | { kind: "invalid_condition"; ruleIndex: number; conditionName: string; actualType: string }
  | { kind: "missing_program"; ruleIndex: number; conditionName: string; targetActionId: string };

type ZigSceneWarning = {
  kind: "duplicate_enqueue";
  actionId: string;
  fromActionId: string;
  firstEnqueuedBy: string | null;
};

type ZigRuntimeEvent =
  | ZigEffectRequest
  | {
      event: "actionComplete";
      sceneId: string;
      actionId: string;
      computeRoot: unknown;
      nextActionIds: string[];
      publishOutcomes: Array<{
        hookName: string;
        status: "ok" | "error";
        message?: string | null;
      }>;
      warnings: ZigWarning[];
      sceneWarnings: ZigSceneWarning[];
    }
  | { event: "sceneChanged"; from: string; to: string }
  | { event: "complete" | "cancelled" };

class ZigRuntimeStatusError extends Error {
  sceneId?: string;
  actionId?: string;
  publishOutcomes?: PublishHookOutcome[];

  constructor(
    readonly status: ZigResponse["status"],
    readonly code: string,
  ) {
    super(`Zig runtime returned ${status}: ${code}`);
    this.name = "ZigRuntimeStatusError";
  }
}

export interface ZigRuntimeTransport {
  step<T>(handle: number): ZigResponse<T>;
  resume(handle: number, result: unknown): ZigResponse<{ resumed: number }>;
}

/** Consume internal effect events until one caller-visible Runner event is reached. */
export async function advanceZigRuntime(
  client: ZigRuntimeTransport,
  handle: number,
  hooks: HookRegistry,
  signal: AbortSignal,
): Promise<RunnerStepResult> {
  let activeSceneId: string | undefined;
  let activeActionId: string | undefined;
  const publishOutcomes: PublishHookOutcome[] = [];
  while (true) {
    throwIfAborted(signal);
    const response = client.step<ZigRuntimeEvent>(handle);
    // A rejected merge is a conflict report, not a runtime fault, and reads far
    // better as one than as the raw status payload it arrives in.
    const conflicts = mergeConflictsOf(response);
    if (conflicts !== undefined) throw new ModelMergeError(conflicts);
    try {
      assertOk(response);
    } catch (error) {
      if (error instanceof ZigRuntimeStatusError) {
        if (activeSceneId !== undefined) error.sceneId = activeSceneId;
        if (activeActionId !== undefined) error.actionId = activeActionId;
        error.publishOutcomes = publishOutcomes;
      }
      throw error;
    }
    const event = response.payload;
    switch (event.event) {
      case "needEffect": {
        activeSceneId = event.sceneId;
        activeActionId = event.actionId;
        const result = await dispatchZigEffect(event, hooks, signal);
        recordPublishOutcome(event, result, publishOutcomes);
        if (result.kind === "prepare" && result.status === "missing") {
          // The engine's names for the two, so a host reporting one is
          // reporting what the engine raised rather than a name of its own.
          throw new PrepareError(
            event.role === "extend" ? "MissingExtendHook" : "UnregisteredHook",
            event.actionId,
            `${event.role === "extend" ? "extend" : "prepare"} hook "${event.hook}" is not registered`,
          );
        }
        if (result.kind === "prepare" && result.status === "failed") {
          throw result.hostError;
        }
        const resumed = client.resume(handle, result);
        assertOk(resumed);
        if (resumed.payload.resumed !== event.id) {
          throw new Error("Zig runtime resumed a different effect ID");
        }
        break;
      }
      case "actionComplete": {
        const trace = actionTrace(event);
        const step: RunnerStepResult = {
          done: false,
          kind: "action",
          sceneId: event.sceneId,
          actionId: event.actionId,
          trace,
        };
        const sceneWarnings = (event.sceneWarnings ?? []).map(sceneWarning);
        if (sceneWarnings.length > 0) {
          Object.defineProperty(step, "sceneWarnings", { value: sceneWarnings });
        }
        return step;
      }
      case "sceneChanged":
        return {
          done: false,
          kind: "scene-transition",
          fromSceneId: event.from,
          toSceneId: event.to,
        };
      case "complete":
      case "cancelled":
        return { done: true };
    }
  }
}

function recordPublishOutcome(
  request: ZigEffectRequest,
  result: ZigEffectResult,
  outcomes: PublishHookOutcome[],
): void {
  if (result.kind !== "publish" || result.status === "missing") return;
  if (result.status === "failed") {
    outcomes.push({ hookName: request.hook, status: "error", message: result.message });
  } else {
    outcomes.push({ hookName: request.hook, status: "ok" });
  }
}

function mapPublishHookFailed(
  error: ZigRuntimeStatusError,
  fallbackSceneId: string,
  readState: () => Record<string, ReturnType<typeof fromCanonicalValue>>,
): PublishHookFailedError | undefined {
  if (error.code !== "PublishHookFailed" || error.actionId === undefined) return undefined;
  const outcomes = error.publishOutcomes ?? [];
  const failed = outcomes.filter((outcome) => outcome.status === "error");
  const summary = failed.map((outcome) => `${outcome.hookName}: ${outcome.message}`).join("; ");
  return new PublishHookFailedError(
    error.sceneId ?? fallbackSceneId,
    `action "${error.actionId}": ${failed.length} publish hook(s) failed — ${summary}`,
    error.actionId,
    stateManagerFromUnchecked(readState()),
    outcomes,
  );
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}

function sceneWarning(warning: ZigSceneWarning): SceneWarning {
  const firstEnqueuedBy = warning.firstEnqueuedBy ?? "<entry>";
  return {
    kind: "duplicate_enqueue",
    actionId: warning.actionId,
    firstEnqueuedBy,
    message:
      `action "` +
      warning.actionId +
      `" was enqueued by "` +
      warning.fromActionId +
      `" but already ran (first enqueued by "` +
      firstEnqueuedBy +
      `"); next rule points to an already-executed action`,
  };
}

function internalSceneWarnings(result: RunnerStepResult): readonly SceneWarning[] {
  return (
    (result as RunnerStepResult & { sceneWarnings?: readonly SceneWarning[] }).sceneWarnings ?? []
  );
}

function actionTrace(event: Extract<ZigRuntimeEvent, { event: "actionComplete" }>): ActionTrace {
  const publishOutcomes: PublishHookOutcome[] = event.publishOutcomes.map((outcome) =>
    outcome.status === "ok"
      ? { hookName: outcome.hookName, status: "ok" }
      : {
          hookName: outcome.hookName,
          status: "error",
          message: outcome.message ?? "",
        },
  );
  const warnings = event.warnings.map((warning): ActionWarning => {
    switch (warning.kind) {
      case "merge":
        return {
          kind: "merge_warning",
          message: `merge binding "${warning.binding}" could not be written to STATE path "${warning.toState}"`,
        };
      case "uncheckedStateWrite":
        return {
          kind: "unchecked_state_write",
          writtenPaths: warning.writtenPaths,
          message:
            `action "${event.actionId}": merge wrote to ${warning.writtenPaths.length} path(s) ` +
            `(${warning.writtenPaths.join(", ")}) on an unchecked StateManager — ` +
            `path and type correctness are not enforced; typo'd paths silently read as null`,
        };
      case "invalid_condition":
        return {
          kind: "invalid_next_condition",
          actionId: event.actionId,
          conditionName: warning.conditionName,
          actualType: warning.actualType,
          message: `action "${event.actionId}": next condition "${warning.conditionName}" resolved to ${warning.actualType} (expected pure boolean) — rule skipped`,
        };
      case "missing_program":
        return {
          kind: "missing_next_compute_prog",
          sceneId: event.sceneId,
          actionId: event.actionId,
          targetActionId: warning.targetActionId,
          message: `scene "${event.sceneId}" action "${event.actionId}" next-rule targeting "${warning.targetActionId}": compute block has no prog — rule skipped (model may be malformed)`,
        };
    }
  });
  return {
    actionId: event.actionId,
    computeRootValue: fromCanonicalValue(event.computeRoot),
    nextActionIds: event.nextActionIds,
    ...(publishOutcomes.length > 0 ? { publishOutcomes } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/**
 * The conflicts from a merge the runtime rejected, or undefined for anything
 * else. An `extend` hook brought in a model that collided with the running one.
 */
function mergeConflictsOf(response: ZigResponse<unknown>): string[] | undefined {
  if (response.status === "ok") return undefined;
  const payload = asRecord(response.payload);
  if (payload?.event !== "mergeConflict") return undefined;
  const conflicts = payload.conflicts;
  return Array.isArray(conflicts) ? conflicts.map(String) : ["the runtime rejected the merge"];
}

function assertOk<T>(
  response: ZigResponse<T>,
): asserts response is ZigResponse<T> & { status: "ok" } {
  if (response.status !== "ok") {
    const payload = response.payload;
    const code =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : JSON.stringify(payload);
    const error = new ZigRuntimeStatusError(response.status, code);
    if (
      typeof payload === "object" &&
      payload !== null &&
      "sceneId" in payload &&
      typeof payload.sceneId === "string"
    ) {
      error.sceneId = payload.sceneId;
    }
    throw error;
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Runner aborted", "AbortError");
}

export interface ZigRuntimeLifecycleTransport extends ZigRuntimeTransport {
  create(model: Uint8Array, request: unknown): ZigResponse<CreatedRuntime>;
  destroy(handle: number): ZigResponse<{ destroyed: number }>;
  snapshot<T>(handle: number): ZigResponse<{ state: T; done: boolean }>;
}

/**
 * Where a runner gets its Zig runtime from.
 *
 * Model bytes can be handed over on every creation, which makes the runtime
 * parse, validate, index, and lower them again each time, or once through
 * `prepareModel`, after which creation is just the run's own setup.
 */
export interface RuntimeModelSource {
  create(request: unknown): ZigResponse<CreatedRuntime>;
}

/** A source that re-sends the model bytes on every creation. */
export function modelSourceFromBytes(
  client: ZigRuntimeLifecycleTransport,
  model: Uint8Array,
): RuntimeModelSource {
  return { create: (request) => client.create(model, request) };
}

/** A source backed by a model the runtime has already prepared under a handle. */
export function modelSourceFromHandle(
  create: (request: unknown) => ZigResponse<CreatedRuntime>,
): RuntimeModelSource {
  return { create };
}

function toModelSource(
  client: ZigRuntimeLifecycleTransport,
  model: Uint8Array | RuntimeModelSource,
): RuntimeModelSource {
  return model instanceof Uint8Array ? modelSourceFromBytes(client, model) : model;
}

type StateSnapshot = Record<string, ReturnType<typeof fromCanonicalValue>>;

/**
 * One runtime handle and the lifecycle a runner wraps around it.
 *
 * Scene and route runners differ in what they ask the runtime for and in the
 * trace they assemble. They do not differ in how the handle is opened, read,
 * closed, or surrendered when the caller aborts, so that lives here once — and
 * those are precisely the paths where two copies drifting apart would leak a
 * handle without any test noticing.
 */
interface ZigRuntimeSession {
  readonly hooks: HookRegistry;
  readonly handle: number;
  readonly created: CreatedRuntime;
  readonly signal: AbortSignal;
  isDone(): boolean;
  /** Whether the handle has been given back, however the run ended. */
  isClosed(): boolean;
  /** STATE as it stands, or the state captured when the handle closed. */
  readState(): StateSnapshot;
  /** Capture the final state, close the handle, and stop listening for abort. */
  finish(): void;
  /**
   * Close the handle for a run that ended without completing.
   *
   * The caller is already throwing. This exists so the throw does not also cost
   * a handle, and so `partialState()` still has something to answer with.
   */
  abandon(): void;
  /** The final state, or `IncompleteExecution` when the run has not ended. */
  requireFinalState(): StateSnapshot;
  /** The final state when there is one, otherwise a live read. */
  finalStateOrRead(): StateSnapshot;
}

/**
 * Create a runtime against `model` and wrap its handle in a session.
 *
 * `entryRequest` carries what is specific to the kind of run — the scene or
 * route id, and any limit only that kind accepts. Everything else in the
 * create request is common and is filled in here.
 */
function openZigRuntimeSession(
  client: ZigRuntimeLifecycleTransport,
  model: Uint8Array | RuntimeModelSource,
  options: RunnerOptions,
  entryRequest: Record<string, unknown>,
): ZigRuntimeSession {
  const hooks: HookRegistry = {
    prepare: Object.create(null) as HookRegistry["prepare"],
    extend: Object.create(null) as HookRegistry["extend"],
    publish: Object.create(null) as HookRegistry["publish"],
  };
  const source = toModelSource(client, model);
  const signal = options.signal ?? new AbortController().signal;
  const initialState = Object.fromEntries(
    Object.entries(options.initialState).map(([path, entry]) => [path, toCanonicalValue(entry)]),
  );
  const created = source.create({
    ...entryRequest,
    initialState,
    failOnPublishError: options.failOnPublishError ?? false,
    ...(options.maxSceneSteps !== undefined && { maxSceneSteps: options.maxSceneSteps }),
  });
  assertOk(created);
  const handle = created.payload.handle;

  let completed = false;
  let handleOpen = true;
  let finalState: StateSnapshot | undefined;

  function readState(): StateSnapshot {
    if (!handleOpen) {
      if (finalState !== undefined) return finalState;
      throw new Error("Zig runtime handle is closed");
    }
    const snapshot = client.snapshot<Record<string, unknown>>(handle);
    assertOk(snapshot);
    return Object.fromEntries(
      Object.entries(snapshot.payload.state).map(([path, entry]) => [
        path,
        fromCanonicalValue(entry),
      ]),
    );
  }

  /**
   * Capture what STATE holds and give the handle back.
   *
   * `strict` is the completion path, where a runtime that will not answer is
   * itself the failure and has to surface. Every other caller already carries
   * an error — an abort, or a step that threw — and one raised from the cleanup
   * would displace it, so those take the state they can get and report a handle
   * they could not reclaim as a warning instead.
   *
   * The destroy sits in a `finally` because it is the runtime's only chance to
   * reclaim the handle: a read that throws on the way past must not take the
   * handle with it.
   */
  function closeHandle(strict: boolean): void {
    if (!handleOpen) return;

    let readError: unknown;
    let readFailed = false;
    try {
      finalState = readState();
    } catch (error) {
      // The run is over either way. An unreadable handle costs the caller the
      // partial state, not the outcome that got us here.
      finalState = undefined;
      readError = error;
      readFailed = true;
    }

    // Destroy regardless of how the read went: this is the runtime's only
    // chance to reclaim the handle, and a read that failed on the way past
    // must not take the handle down with it.
    let destroyError: unknown;
    let destroyFailed = false;
    try {
      const destroyed = client.destroy(handle);
      if (strict) assertOk(destroyed);
    } catch (error) {
      destroyError = error;
      destroyFailed = true;
    }

    handleOpen = false;
    signal.removeEventListener("abort", releaseOnAbort);

    if (strict) {
      // The read failing is the more informative of the two, so it wins.
      if (readFailed) throw readError;
      if (destroyFailed) throw destroyError;
      return;
    }
    if (destroyFailed) {
      // Failing here leaks a handle. There is nothing to retry and nothing that
      // should displace the error already in flight — but it is the caller's
      // memory, so say so.
      safeWarn(
        options.onWarning,
        `[turnout] Zig runtime handle ${handle} could not be destroyed and has ` +
          `leaked: ${errorMessage(destroyError)}`,
      );
    }
  }

  function finish(): void {
    if (completed || !handleOpen) return;
    closeHandle(true);
    completed = true;
  }

  function abandon(): void {
    closeHandle(false);
  }

  function releaseOnAbort(): void {
    closeHandle(false);
  }

  signal.addEventListener("abort", releaseOnAbort, { once: true });
  if (signal.aborted) releaseOnAbort();

  return {
    hooks,
    handle,
    created: created.payload,
    signal,
    isDone: () => completed,
    isClosed: () => !handleOpen,
    readState,
    finish,
    abandon,
    requireFinalState: () => {
      if (!completed || finalState === undefined) {
        throw new RunnerError(
          "IncompleteExecution",
          "execution is not complete — call run() or step until isDone()",
        );
      }
      return finalState;
    },
    finalStateOrRead: () => finalState ?? readState(),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Wrap a step function so the runtime handle goes back on every exit, not only
 * the one where the run reaches its end.
 *
 * `finish()` covers completion. Nothing covered the paths where a run stops
 * without completing — a hook that throws, a step limit that trips, a publish
 * failure under `failOnPublishError` — and each of those left the handle open
 * with no one holding a reference to close it. The WASM instance is
 * process-wide, so the STATE behind an abandoned handle is never reclaimed;
 * `executeSceneSafe`, whose whole purpose is to return from exactly those
 * failures, leaked one per failed run.
 *
 * The partial state is captured before the handle goes, so `partialState()`
 * still answers afterwards. Stepping again is refused rather than passed
 * through to a handle that no longer exists.
 */
function closingOnThrow(
  session: ZigRuntimeSession,
  advance: () => Promise<RunnerStepResult>,
): () => Promise<RunnerStepResult> {
  return async () => {
    if (session.isClosed() && !session.isDone()) {
      throw new RunnerError(
        "ExecutionEnded",
        "the run ended without completing — create a new runner to run again",
      );
    }
    try {
      return await advance();
    } catch (error) {
      session.abandon();
      throw error;
    }
  };
}

/** Build the existing scene Runner API around one Zig WASM runtime handle. */
export function createZigSceneRunner(
  client: ZigRuntimeLifecycleTransport,
  model: Uint8Array | RuntimeModelSource,
  sceneId: string,
  options: RunnerOptions,
): Runner<FragmentHarnessResult> {
  const session = openZigRuntimeSession(client, model, options, { sceneId });
  const { hooks, handle, signal } = session;
  // Zig reports the limits it applied, so the message below never restates them.
  const maxSceneSteps = session.created.maxSceneSteps;
  const actions: ActionTrace[] = [];
  const sceneWarnings: SceneWarning[] = [];

  async function advance(): Promise<RunnerStepResult> {
    if (session.isDone()) return { done: true };
    let result: RunnerStepResult;
    try {
      result = await advanceZigRuntime(client, handle, hooks, signal);
    } catch (error) {
      if (error instanceof ZigRuntimeStatusError) {
        const publishError = mapPublishHookFailed(error, sceneId, session.readState);
        if (publishError !== undefined) throw publishError;
      }
      if (error instanceof ZigRuntimeStatusError && error.code === "MaxStepsExceeded") {
        throw new SceneRuntimeError(
          "MaxStepsExceeded",
          sceneId,
          `exceeded ${maxSceneSteps} action steps — possible infinite loop in next-rule graph`,
        );
      }
      throw error;
    }
    if (result.done) {
      session.finish();
      return result;
    }
    if (result.kind === "action") {
      if (actions.length === 0) {
        safeLog(options.onLog, {
          kind: "scene-start",
          sceneId,
          entryAction: result.actionId,
        });
      }
      safeLog(options.onLog, {
        kind: "action-start",
        sceneId,
        actionId: result.actionId,
        stepIndex: actions.length + 1,
      });
      for (const warning of result.trace.warnings ?? []) {
        safeLog(options.onLog, {
          kind: "warning",
          sceneId,
          actionId: result.actionId,
          message: warning.message,
        });
      }
      sceneWarnings.push(...internalSceneWarnings(result));
      actions.push(result.trace);
      safeLog(options.onLog, {
        kind: "action-complete",
        sceneId,
        actionId: result.actionId,
        trace: result.trace,
      });
      if (result.trace.nextActionIds.length === 0) {
        safeLog(options.onLog, {
          kind: "scene-complete",
          sceneId,
          terminatedAt: [result.actionId],
        });
        session.finish();
      }
    }
    return result;
  }

  return makeRunnerMethods(
    hooks,
    closingOnThrow(session, advance),
    session.isDone,
    () => ({
      finalState: session.requireFinalState(),
      trace: {
        kind: "scene",
        scene: {
          sceneId,
          actions,
          ...(sceneWarnings.length > 0 ? { warnings: sceneWarnings } : {}),
        },
      },
      ...(sceneWarnings.length > 0
        ? {
            warnings: sceneWarnings.map(
              (warning): ExecutionWarning => ({ kind: "scene_warning", sceneId, warning }),
            ),
          }
        : {}),
    }),
    () => stateManagerFromUnchecked(session.finalStateOrRead()),
    signal,
  );
}

/** Build the existing route Runner API around one Zig WASM runtime handle. */
export function createZigRouteRunner(
  client: ZigRuntimeLifecycleTransport,
  model: Uint8Array | RuntimeModelSource,
  routeId: string,
  options: RunnerOptions,
): Runner<FragmentHarnessResult> {
  const session = openZigRuntimeSession(client, model, options, {
    routeId,
    ...(options.maxRouteTransitions !== undefined && {
      maxRouteTransitions: options.maxRouteTransitions,
    }),
  });
  const { hooks, handle, signal } = session;
  const maxRouteTransitions = session.created.maxRouteTransitions;
  const scenes: SceneTrace[] = [];
  const pending: RunnerStepResult[] = [];
  const preprocessedActions = new WeakSet<object>();
  const finishAfterActions = new WeakSet<object>();
  let activeSceneId: string | undefined;

  function appendAction(
    sceneId: string,
    trace: ActionTrace,
    sceneWarnings: readonly SceneWarning[],
  ): void {
    let scene = scenes.at(-1);
    if (scene?.sceneId !== sceneId) {
      scene = { sceneId, actions: [] };
      scenes.push(scene);
      safeLog(options.onLog, {
        kind: "scene-start",
        sceneId,
        entryAction: trace.actionId,
      });
    }
    safeLog(options.onLog, {
      kind: "action-start",
      sceneId,
      actionId: trace.actionId,
      stepIndex: scene.actions.length + 1,
    });
    for (const warning of trace.warnings ?? []) {
      safeLog(options.onLog, {
        kind: "warning",
        sceneId,
        actionId: trace.actionId,
        message: warning.message,
      });
    }
    if (sceneWarnings.length > 0) {
      scene.warnings = [...(scene.warnings ?? []), ...sceneWarnings];
    }
    scene.actions.push(trace);
    safeLog(options.onLog, {
      kind: "action-complete",
      sceneId,
      actionId: trace.actionId,
      trace,
    });
    if (trace.nextActionIds.length === 0) {
      safeLog(options.onLog, {
        kind: "scene-complete",
        sceneId,
        terminatedAt: [trace.actionId],
      });
    }
  }

  async function advanceRouteRuntime(): Promise<RunnerStepResult> {
    try {
      return await advanceZigRuntime(client, handle, hooks, signal);
    } catch (error) {
      if (
        error instanceof ZigRuntimeStatusError &&
        error.sceneId === undefined &&
        activeSceneId !== undefined
      ) {
        error.sceneId = activeSceneId;
      }
      if (error instanceof ZigRuntimeStatusError) {
        const publishError = mapPublishHookFailed(
          error,
          error.sceneId ?? routeId,
          session.readState,
        );
        if (publishError !== undefined) throw publishError;
      }
      if (error instanceof ZigRuntimeStatusError && error.code === "MaxRouteTransitionsExceeded") {
        throw new RouteRuntimeError(
          "MaxRouteTransitionsExceeded",
          routeId,
          `exceeded ${maxRouteTransitions} scene transitions — possible infinite loop`,
        );
      }
      throw error;
    }
  }

  async function nextEvent(): Promise<RunnerStepResult> {
    const queued = pending.shift();
    return queued ?? advanceRouteRuntime();
  }

  async function advance(): Promise<RunnerStepResult> {
    if (session.isDone()) return { done: true };
    const result = await nextEvent();
    if (result.done) {
      session.finish();
      return result;
    }
    if (result.kind === "scene-transition") {
      activeSceneId = result.toSceneId;
      const following = await advanceRouteRuntime();
      if (following.done || following.kind !== "action") {
        throw new Error("Zig route transition was not followed by an action");
      }
      appendAction(following.sceneId, following.trace, internalSceneWarnings(following));
      preprocessedActions.add(following);
      pending.push(following);
      if (following.trace.nextActionIds.length === 0) {
        const afterAction = await advanceRouteRuntime();
        if (afterAction.done) finishAfterActions.add(following);
        else pending.push(afterAction);
      }
      safeLog(options.onLog, {
        kind: "route-transition",
        fromSceneId: result.fromSceneId,
        toSceneId: result.toSceneId,
      });
      return result;
    }
    if (result.kind === "action") {
      if (preprocessedActions.delete(result)) {
        if (finishAfterActions.delete(result)) session.finish();
        return result;
      }
      appendAction(result.sceneId, result.trace, internalSceneWarnings(result));
      if (result.trace.nextActionIds.length === 0) {
        const following = await advanceRouteRuntime();
        if (following.done) session.finish();
        else pending.push(following);
      }
    }
    return result;
  }

  return makeRunnerMethods(
    hooks,
    closingOnThrow(session, advance),
    session.isDone,
    () => ({
      finalState: session.requireFinalState(),
      trace: { kind: "route", route: { routeId, scenes } },
      ...(() => {
        const warnings = scenes.flatMap((scene) =>
          (scene.warnings ?? []).map(
            (warning): ExecutionWarning => ({
              kind: "scene_warning",
              sceneId: scene.sceneId,
              warning,
            }),
          ),
        );
        return warnings.length > 0 ? { warnings } : {};
      })(),
    }),
    () => stateManagerFromUnchecked(session.finalStateOrRead()),
    signal,
  );
}

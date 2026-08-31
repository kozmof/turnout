import type {
  ActionTrace,
  ActionWarning,
  HookRegistry,
  PublishHookOutcome,
  SceneTrace,
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
} from "../executor/errors.js";
import { safeLog } from "../executor/logging.js";
import { stateManagerFromUnchecked } from "../state/state-manager.js";
import type { ZigResponse } from "./client.js";
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
          throw new PrepareError(
            "UnregisteredHook",
            event.actionId,
            `prepare hook "${event.hook}" is not registered`,
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
        return {
          done: false,
          kind: "action",
          sceneId: event.sceneId,
          actionId: event.actionId,
          trace,
        };
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
    throw new ZigRuntimeStatusError(response.status, code);
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Runner aborted", "AbortError");
}

export interface ZigRuntimeLifecycleTransport extends ZigRuntimeTransport {
  create(model: Uint8Array, request: unknown): ZigResponse<{ handle: number }>;
  destroy(handle: number): ZigResponse<{ destroyed: number }>;
  snapshot<T>(handle: number): ZigResponse<{ state: T; done: boolean }>;
}

/** Build the existing scene Runner API around one Zig WASM runtime handle. */
export function createZigSceneRunner(
  client: ZigRuntimeLifecycleTransport,
  model: Uint8Array,
  sceneId: string,
  options: RunnerOptions,
): Runner<FragmentHarnessResult> {
  const hooks: HookRegistry = {
    prepare: Object.create(null) as HookRegistry["prepare"],
    publish: Object.create(null) as HookRegistry["publish"],
  };
  const signal = options.signal ?? new AbortController().signal;
  const initialState = Object.fromEntries(
    Object.entries(options.initialState).map(([path, entry]) => [path, toCanonicalValue(entry)]),
  );
  const created = client.create(model, {
    sceneId,
    initialState,
    failOnPublishError: options.failOnPublishError ?? false,
    maxSceneSteps: options.maxSceneSteps ?? 10_000,
  });
  assertOk(created);
  const handle = created.payload.handle;
  const actions: ActionTrace[] = [];
  let done = false;
  let handleOpen = true;
  let finalState: Record<string, ReturnType<typeof fromCanonicalValue>> | undefined;

  function readState(): Record<string, ReturnType<typeof fromCanonicalValue>> {
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

  function finish(): void {
    if (done) return;
    finalState = readState();
    const destroyed = client.destroy(handle);
    assertOk(destroyed);
    handleOpen = false;
    signal.removeEventListener("abort", releaseOnAbort);
    done = true;
  }

  function releaseOnAbort(): void {
    if (!handleOpen) return;
    try {
      finalState = readState();
    } catch {
      finalState = undefined;
    }
    try {
      client.destroy(handle);
    } catch {}
    handleOpen = false;
  }

  signal.addEventListener("abort", releaseOnAbort, { once: true });
  if (signal.aborted) releaseOnAbort();

  async function advance(): Promise<RunnerStepResult> {
    let result: RunnerStepResult;
    try {
      result = await advanceZigRuntime(client, handle, hooks, signal);
    } catch (error) {
      if (error instanceof ZigRuntimeStatusError) {
        const publishError = mapPublishHookFailed(error, sceneId, readState);
        if (publishError !== undefined) throw publishError;
      }
      if (error instanceof ZigRuntimeStatusError && error.code === "MaxStepsExceeded") {
        throw new SceneRuntimeError(
          "MaxStepsExceeded",
          sceneId,
          `exceeded ${options.maxSceneSteps ?? 10_000} action steps — possible infinite loop in next-rule graph`,
        );
      }
      throw error;
    }
    if (result.done) {
      finish();
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
        finish();
      }
    }
    return result;
  }

  return makeRunnerMethods(
    hooks,
    advance,
    () => done,
    () => {
      if (!done || finalState === undefined) {
        throw new RunnerError(
          "IncompleteExecution",
          "execution is not complete — call run() or step until isDone()",
        );
      }
      return {
        finalState,
        trace: { kind: "scene", scene: { sceneId, actions } },
      };
    },
    () => stateManagerFromUnchecked(finalState ?? readState()),
    signal,
  );
}

/** Build the existing route Runner API around one Zig WASM runtime handle. */
export function createZigRouteRunner(
  client: ZigRuntimeLifecycleTransport,
  model: Uint8Array,
  routeId: string,
  options: RunnerOptions,
): Runner<FragmentHarnessResult> {
  const hooks: HookRegistry = {
    prepare: Object.create(null) as HookRegistry["prepare"],
    publish: Object.create(null) as HookRegistry["publish"],
  };
  const signal = options.signal ?? new AbortController().signal;
  const initialState = Object.fromEntries(
    Object.entries(options.initialState).map(([path, entry]) => [path, toCanonicalValue(entry)]),
  );
  const created = client.create(model, {
    routeId,
    initialState,
    failOnPublishError: options.failOnPublishError ?? false,
    maxSceneSteps: options.maxSceneSteps ?? 10_000,
    maxRouteTransitions: options.maxRouteTransitions ?? 1_000,
  });
  assertOk(created);
  const handle = created.payload.handle;
  const scenes: SceneTrace[] = [];
  const pending: RunnerStepResult[] = [];
  const preprocessedActions = new WeakSet<object>();
  const finishAfterActions = new WeakSet<object>();
  let done = false;
  let handleOpen = true;
  let finalState: Record<string, ReturnType<typeof fromCanonicalValue>> | undefined;

  function readState(): Record<string, ReturnType<typeof fromCanonicalValue>> {
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

  function finish(): void {
    if (done) return;
    finalState = readState();
    const destroyed = client.destroy(handle);
    assertOk(destroyed);
    handleOpen = false;
    signal.removeEventListener("abort", releaseOnAbort);
    done = true;
  }

  function releaseOnAbort(): void {
    if (!handleOpen) return;
    try {
      finalState = readState();
    } catch {
      finalState = undefined;
    }
    try {
      client.destroy(handle);
    } catch {}
    handleOpen = false;
  }

  signal.addEventListener("abort", releaseOnAbort, { once: true });
  if (signal.aborted) releaseOnAbort();

  function appendAction(sceneId: string, trace: ActionTrace): void {
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
      if (error instanceof ZigRuntimeStatusError) {
        const publishError = mapPublishHookFailed(error, error.sceneId ?? routeId, readState);
        if (publishError !== undefined) throw publishError;
      }
      if (error instanceof ZigRuntimeStatusError && error.code === "MaxRouteTransitionsExceeded") {
        throw new RouteRuntimeError(
          "MaxRouteTransitionsExceeded",
          routeId,
          `exceeded ${options.maxRouteTransitions ?? 1_000} scene transitions — possible infinite loop`,
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
    const result = await nextEvent();
    if (result.done) {
      finish();
      return result;
    }
    if (result.kind === "scene-transition") {
      const following = await advanceRouteRuntime();
      if (following.done || following.kind !== "action") {
        throw new Error("Zig route transition was not followed by an action");
      }
      appendAction(following.sceneId, following.trace);
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
        if (finishAfterActions.delete(result)) finish();
        return result;
      }
      appendAction(result.sceneId, result.trace);
      if (result.trace.nextActionIds.length === 0) {
        const following = await advanceRouteRuntime();
        if (following.done) finish();
        else pending.push(following);
      }
    }
    return result;
  }

  return makeRunnerMethods(
    hooks,
    advance,
    () => done,
    () => {
      if (!done || finalState === undefined) {
        throw new RunnerError(
          "IncompleteExecution",
          "execution is not complete — call run() or step until isDone()",
        );
      }
      return {
        finalState,
        trace: { kind: "route", route: { routeId, scenes } },
      };
    },
    () => stateManagerFromUnchecked(finalState ?? readState()),
    signal,
  );
}

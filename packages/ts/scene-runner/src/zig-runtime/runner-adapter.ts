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
import { RunnerError } from "../executor/errors.js";
import { stateManagerFromUnchecked } from "../state/state-manager.js";
import type { ZigResponse } from "./client.js";
import { dispatchZigEffect, type ZigEffectRequest } from "./effect-dispatcher.js";
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
      publishOutcomes: PublishHookOutcome[];
      warnings: ZigWarning[];
    }
  | { event: "sceneChanged"; from: string; to: string }
  | { event: "complete" | "cancelled" };

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
  while (true) {
    throwIfAborted(signal);
    const response = client.step<ZigRuntimeEvent>(handle);
    assertOk(response);
    const event = response.payload;
    switch (event.event) {
      case "needEffect": {
        const result = await dispatchZigEffect(event, hooks, signal);
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

function actionTrace(event: Extract<ZigRuntimeEvent, { event: "actionComplete" }>): ActionTrace {
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
    ...(event.publishOutcomes.length > 0 ? { publishOutcomes: event.publishOutcomes } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

function assertOk<T>(
  response: ZigResponse<T>,
): asserts response is ZigResponse<T> & { status: "ok" } {
  if (response.status !== "ok") {
    throw new Error(`Zig runtime returned ${response.status}: ${JSON.stringify(response.payload)}`);
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
  let finalState: Record<string, ReturnType<typeof fromCanonicalValue>> | undefined;

  function readState(): Record<string, ReturnType<typeof fromCanonicalValue>> {
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
    done = true;
  }

  async function advance(): Promise<RunnerStepResult> {
    const result = await advanceZigRuntime(client, handle, hooks, signal);
    if (result.done) {
      finish();
      return result;
    }
    if (result.kind === "action") {
      actions.push(result.trace);
      if (result.trace.nextActionIds.length === 0) finish();
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
    () => stateManagerFromUnchecked(done && finalState !== undefined ? finalState : readState()),
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
  let done = false;
  let finalState: Record<string, ReturnType<typeof fromCanonicalValue>> | undefined;

  function readState(): Record<string, ReturnType<typeof fromCanonicalValue>> {
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
    done = true;
  }

  function appendAction(sceneId: string, trace: ActionTrace): void {
    let scene = scenes.at(-1);
    if (scene?.sceneId !== sceneId) {
      scene = { sceneId, actions: [] };
      scenes.push(scene);
    }
    scene.actions.push(trace);
  }

  async function nextEvent(): Promise<RunnerStepResult> {
    const queued = pending.shift();
    if (queued !== undefined) return queued;
    return advanceZigRuntime(client, handle, hooks, signal);
  }

  async function advance(): Promise<RunnerStepResult> {
    const result = await nextEvent();
    if (result.done) {
      finish();
      return result;
    }
    if (result.kind === "action") {
      appendAction(result.sceneId, result.trace);
      if (result.trace.nextActionIds.length === 0) {
        const following = await advanceZigRuntime(client, handle, hooks, signal);
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
    () => stateManagerFromUnchecked(done && finalState !== undefined ? finalState : readState()),
    signal,
  );
}

import type { AnyValue } from "runtime";
import { PrepareError } from "../errors.js";
import { mergeModels } from "../merge-models.js";
import { zigRuntimeModelJson } from "../model-encoding.js";
import type {
  ExtendHookContext,
  HookRegistry,
  PrepareHookContext,
  PublishHookContext,
} from "../types/harness-types.js";
import type { TurnModel } from "../types/turnout-model_pb.js";
import { fromCanonicalValue, toCanonicalValue } from "./value-codec.js";

export type ZigEffectRequest = {
  event: "needEffect";
  id: number;
  kind: "prepare" | "publish";
  /**
   * What the payload is for. An `extend` request fires in the prepare phase but
   * answers with a model to merge rather than values to bind.
   */
  role?: "binding" | "extend";
  hook: string;
  sceneId: string;
  actionId: string;
  callbackIndex: number;
  binding: string | null;
  contextJson: string;
};

export type ZigEffectResult =
  | {
      id: number;
      kind: "prepare";
      status: "ok";
      value: unknown;
    }
  | { id: number; kind: "prepare"; status: "missing" }
  | {
      id: number;
      kind: "prepare";
      status: "failed";
      message: string;
      readonly hostError?: unknown;
    }
  | { id: number; kind: "publish"; status: "ok" | "missing" }
  | {
      id: number;
      kind: "publish";
      status: "failed";
      source: "returned" | "thrown";
      message: string;
    };

export async function dispatchZigEffect(
  request: ZigEffectRequest,
  hooks: HookRegistry,
  signal: AbortSignal,
  requiredPrepareBindings: readonly string[] = [],
  prepareContext?: Record<string, AnyValue>,
): Promise<ZigEffectResult> {
  throwIfAborted(signal);
  if (request.kind !== "prepare") return dispatchPublish(request, hooks, signal);
  return request.role === "extend"
    ? dispatchExtend(request, hooks, signal)
    : dispatchPrepare(request, hooks, signal, requiredPrepareBindings, prepareContext);
}

/**
 * Run an `extend` hook and hand back the model it returned.
 *
 * The payload crosses the boundary as the runtime's own projection of a model,
 * so what the runtime merges is exactly what it would have loaded. Returning
 * several models is the same as declaring several hooks; they merge in order.
 *
 * An unregistered hook reports `missing`, which fails the action — the same
 * policy as an unregistered prepare hook, and for the same reason: an action
 * that asked for a model and did not get one cannot run.
 */
async function dispatchExtend(
  request: ZigEffectRequest,
  hooks: HookRegistry,
  signal: AbortSignal,
): Promise<ZigEffectResult> {
  const hook = Object.hasOwn(hooks.extend, request.hook) ? hooks.extend[request.hook] : undefined;
  if (hook === undefined) {
    return { id: request.id, kind: "prepare", status: "missing" };
  }
  const context: ExtendHookContext = { actionId: request.actionId, hookName: request.hook };
  let result: unknown;
  try {
    result = await hook(context, signal);
  } catch (error) {
    if (isAbortError(error) || signal.aborted) throwAbort();
    const failed: Extract<ZigEffectResult, { kind: "prepare"; status: "failed" }> = {
      id: request.id,
      kind: "prepare",
      status: "failed",
      message: String(error),
    };
    Object.defineProperty(failed, "hostError", { value: error });
    return failed;
  }
  const models = Array.isArray(result) ? (result as TurnModel[]) : [result as TurnModel];
  for (const model of models) {
    if (!isRecord(model)) {
      throw new PrepareError(
        "InvalidHookValue",
        request.actionId,
        `extend hook "${request.hook}" returned something that is not a model: ` +
          `${JSON.stringify(model)}`,
      );
    }
  }
  return {
    id: request.id,
    kind: "prepare",
    status: "ok",
    value: mergeExtendModels(models),
  };
}

/**
 * Several models from one hook become one payload, because a payload is one
 * model. Merging them here is the same merge the runtime is about to do, so the
 * conflict rules are unchanged; it just happens a step earlier.
 */
function mergeExtendModels(models: readonly TurnModel[]): unknown {
  // A hook that returned nothing still has to answer with a model, so it
  // answers with one that adds nothing.
  if (models.length === 0) return { version: 2 };
  if (models.length === 1 && models[0] !== undefined) return zigRuntimeModelJson(models[0]);
  return zigRuntimeModelJson(mergeModels(models));
}

async function dispatchPrepare(
  request: ZigEffectRequest,
  hooks: HookRegistry,
  signal: AbortSignal,
  requiredPrepareBindings: readonly string[],
  prepareContext: Record<string, AnyValue> | undefined,
): Promise<ZigEffectResult> {
  const hook = Object.hasOwn(hooks.prepare, request.hook) ? hooks.prepare[request.hook] : undefined;
  if (hook === undefined) {
    return { id: request.id, kind: "prepare", status: "missing" };
  }
  const prepared = prepareContext ?? decodeContext(request.contextJson);
  const context: PrepareHookContext = {
    actionId: request.actionId,
    hookName: request.hook,
    get: (binding) => prepared[binding],
  };
  let result: unknown;
  try {
    result = await hook(context, signal);
  } catch (error) {
    if (isAbortError(error) || signal.aborted) throwAbort();
    const failed: Extract<ZigEffectResult, { kind: "prepare"; status: "failed" }> = {
      id: request.id,
      kind: "prepare",
      status: "failed",
      message: String(error),
    };
    Object.defineProperty(failed, "hostError", { value: error });
    return failed;
  }
  if (!isRecord(result)) {
    throw new PrepareError(
      "InvalidHookValue",
      request.actionId,
      `prepare hook "${request.hook}" returned a non-object result: got ${JSON.stringify(result)}`,
    );
  }
  const bindings = request.binding === null ? requiredPrepareBindings : [request.binding];
  for (const binding of bindings) {
    const value = Object.hasOwn(result, binding) ? result[binding] : undefined;
    if (value === undefined) {
      throw new PrepareError(
        "MissingHookField",
        request.actionId,
        `prepare hook "${request.hook}" did not return field "${binding}"`,
      );
    }
    if (!isRecord(value) || typeof value.symbol !== "string") {
      throw new PrepareError(
        "InvalidHookValue",
        request.actionId,
        `prepare hook "${request.hook}" returned a non-AnyValue for field "${binding}": ` +
          `expected a typed value (built with buildString/buildNumber/etc), got ${JSON.stringify(value)}`,
      );
    }
  }
  if (request.binding !== null) {
    return {
      id: request.id,
      kind: "prepare",
      status: "ok",
      value: toCanonicalValue(result[request.binding]),
    };
  }
  return {
    id: request.id,
    kind: "prepare",
    status: "ok",
    value: mapRecord(result, toCanonicalValue),
  };
}

async function dispatchPublish(
  request: ZigEffectRequest,
  hooks: HookRegistry,
  signal: AbortSignal,
): Promise<ZigEffectResult> {
  const hook = Object.hasOwn(hooks.publish, request.hook) ? hooks.publish[request.hook] : undefined;
  if (hook === undefined) {
    return { id: request.id, kind: "publish", status: "missing" };
  }
  const state = decodeContext(request.contextJson);
  const context: PublishHookContext = {
    actionId: request.actionId,
    hookName: request.hook,
    state: () => state,
  };
  try {
    const result = await hook(context, signal);
    if (result?.status === "error") {
      return {
        id: request.id,
        kind: "publish",
        status: "failed",
        source: "returned",
        message: result.message,
      };
    }
    return { id: request.id, kind: "publish", status: "ok" };
  } catch (error) {
    if (isAbortError(error) || signal.aborted) throwAbort();
    return {
      id: request.id,
      kind: "publish",
      status: "failed",
      source: "thrown",
      message: String(error),
    };
  }
}

function decodeContext(source: string): Record<string, AnyValue> {
  const parsed: unknown = JSON.parse(source);
  if (!isRecord(parsed)) throw new TypeError("effect context must be an object");
  return mapRecord(parsed, fromCanonicalValue);
}

function mapRecord<T>(
  input: Record<string, unknown>,
  convert: (value: unknown) => T,
): Record<string, T> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, convert(value)]));
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throwAbort();
}

function throwAbort(): never {
  throw new DOMException("Runner aborted", "AbortError");
}

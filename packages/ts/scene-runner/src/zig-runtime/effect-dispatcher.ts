import type { AnyValue } from "runtime";
import type {
  HookRegistry,
  PrepareHookContext,
  PublishHookContext,
} from "../types/harness-types.js";
import { fromCanonicalValue, toCanonicalValue } from "./value-codec.js";

export type ZigEffectRequest = {
  event: "needEffect";
  id: number;
  kind: "prepare" | "publish";
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
      value: Record<string, unknown>;
    }
  | { id: number; kind: "prepare"; status: "missing" | "failed"; message?: string }
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
): Promise<ZigEffectResult> {
  throwIfAborted(signal);
  return request.kind === "prepare"
    ? dispatchPrepare(request, hooks, signal)
    : dispatchPublish(request, hooks, signal);
}

async function dispatchPrepare(
  request: ZigEffectRequest,
  hooks: HookRegistry,
  signal: AbortSignal,
): Promise<ZigEffectResult> {
  const hook = Object.hasOwn(hooks.prepare, request.hook) ? hooks.prepare[request.hook] : undefined;
  if (hook === undefined) {
    return { id: request.id, kind: "prepare", status: "missing" };
  }
  const prepared = decodeContext(request.contextJson);
  const context: PrepareHookContext = {
    actionId: request.actionId,
    hookName: request.hook,
    get: (binding) => prepared[binding],
  };
  try {
    const result = await hook(context, signal);
    if (!isRecord(result)) throw new TypeError("prepare hook returned a non-object result");
    return {
      id: request.id,
      kind: "prepare",
      status: "ok",
      value: mapRecord(result, toCanonicalValue),
    };
  } catch (error) {
    if (isAbortError(error) || signal.aborted) throwAbort();
    return {
      id: request.id,
      kind: "prepare",
      status: "failed",
      message: String(error),
    };
  }
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

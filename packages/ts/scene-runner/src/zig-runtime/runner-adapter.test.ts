import { buildNumber } from "runtime";
import { describe, expect, it, vi } from "vitest";
import type { HookRegistry } from "../types/harness-types.js";
import { advanceZigRuntime, type ZigRuntimeTransport } from "./runner-adapter.js";

function hooks(): HookRegistry {
  return {
    prepare: Object.create(null) as HookRegistry["prepare"],
    publish: Object.create(null) as HookRegistry["publish"],
  };
}

describe("advanceZigRuntime", () => {
  it("consumes effects before returning one action-level step", async () => {
    const events: unknown[] = [
      {
        event: "needEffect",
        id: 7,
        kind: "prepare",
        hook: "load",
        sceneId: "main",
        actionId: "start",
        callbackIndex: 0,
        binding: "input",
        contextJson: "{}",
      },
      {
        event: "actionComplete",
        sceneId: "main",
        actionId: "start",
        computeRoot: { symbol: "number", value: 5, tags: [] },
        nextActionIds: ["finish"],
        publishOutcomes: [{ hookName: "save", status: "ok" }],
        warnings: [],
      },
    ];
    const resume = vi.fn(() => ({ status: "ok" as const, payload: { resumed: 7 } }));
    const client: ZigRuntimeTransport = {
      step: <T>() => ({ status: "ok", payload: events.shift() as T }),
      resume,
    };
    const registry = hooks();
    registry.prepare.load = () => ({ input: buildNumber(5) });

    await expect(
      advanceZigRuntime(client, 3, registry, new AbortController().signal),
    ).resolves.toEqual({
      done: false,
      kind: "action",
      sceneId: "main",
      actionId: "start",
      trace: {
        actionId: "start",
        computeRootValue: buildNumber(5),
        nextActionIds: ["finish"],
        publishOutcomes: [{ hookName: "save", status: "ok" }],
      },
    });
    expect(resume).toHaveBeenCalledWith(3, {
      id: 7,
      kind: "prepare",
      status: "ok",
      value: { input: { symbol: "number", value: 5, tags: [] } },
    });
  });

  it("returns transitions and terminal events without exposing internal effects", async () => {
    const transition: ZigRuntimeTransport = {
      step: <T>() => ({
        status: "ok",
        payload: { event: "sceneChanged", from: "one", to: "two" } as T,
      }),
      resume: vi.fn(),
    };
    await expect(
      advanceZigRuntime(transition, 1, hooks(), new AbortController().signal),
    ).resolves.toEqual({
      done: false,
      kind: "scene-transition",
      fromSceneId: "one",
      toSceneId: "two",
    });

    const complete: ZigRuntimeTransport = {
      step: <T>() => ({ status: "ok", payload: { event: "complete" } as T }),
      resume: vi.fn(),
    };
    await expect(
      advanceZigRuntime(complete, 1, hooks(), new AbortController().signal),
    ).resolves.toEqual({ done: true });
  });

  it("propagates abort and non-ok runtime statuses", async () => {
    const client: ZigRuntimeTransport = {
      step: <T>() => ({ status: "runtime_error", payload: { error: "boom" } as T }),
      resume: vi.fn(),
    };
    await expect(
      advanceZigRuntime(client, 1, hooks(), new AbortController().signal),
    ).rejects.toThrow("runtime_error");

    const controller = new AbortController();
    controller.abort();
    await expect(advanceZigRuntime(client, 1, hooks(), controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

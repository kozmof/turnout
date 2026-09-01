import { buildNumber } from "runtime";
import { describe, expect, it, vi } from "vitest";
import type { HookRegistry } from "../types/harness-types.js";
import {
  advanceZigRuntime,
  createZigRouteRunner,
  createZigSceneRunner,
  type ZigRuntimeLifecycleTransport,
  type ZigRuntimeTransport,
} from "./runner-adapter.js";

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
      value: { symbol: "number", value: 5, tags: [] },
    });
  });

  it("maps a missing prepare hook to PrepareError", async () => {
    const client: ZigRuntimeTransport = {
      step: <T>() => ({
        status: "ok",
        payload: {
          event: "needEffect",
          id: 8,
          kind: "prepare",
          hook: "load",
          sceneId: "main",
          actionId: "start",
          callbackIndex: 0,
          binding: "input",
          contextJson: "{}",
        } as T,
      }),
      resume: vi.fn(),
    };

    await expect(
      advanceZigRuntime(client, 3, hooks(), new AbortController().signal),
    ).rejects.toMatchObject({
      name: "PrepareError",
      code: "UnregisteredHook",
      actionId: "start",
      message: '[action: start] prepare hook "load" is not registered',
    });
    expect(client.resume).not.toHaveBeenCalled();
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

  it("wraps a Zig handle with Runner lifecycle and snapshots", async () => {
    const actionEvent = {
      event: "actionComplete",
      sceneId: "main",
      actionId: "start",
      computeRoot: { symbol: "number", value: 9, tags: [] },
      nextActionIds: [],
      publishOutcomes: [],
      warnings: [],
    };
    const create = vi.fn(() => ({ status: "ok" as const, payload: { handle: 12 } }));
    const destroy = vi.fn(() => ({ status: "ok" as const, payload: { destroyed: 12 } }));
    const client: ZigRuntimeLifecycleTransport = {
      create,
      destroy,
      step: <T>() => ({ status: "ok", payload: actionEvent as T }),
      resume: vi.fn(),
      snapshot: <T>() => ({
        status: "ok",
        payload: {
          state: { score: { symbol: "number", value: 9, tags: [] } } as T,
          done: false,
        },
      }),
    };
    const logs: string[] = [];
    const runner = createZigSceneRunner(client, new Uint8Array([1, 2]), "main", {
      entryId: "main",
      initialState: { score: buildNumber(1) },
      onLog: (event) => logs.push(event.kind),
    });

    await expect(runner.next(2)).resolves.toHaveLength(1);
    expect(runner.isDone()).toBe(true);
    expect(runner.partialState().snapshot()).toEqual({ score: buildNumber(9) });
    expect(runner.result()).toEqual({
      finalState: { score: buildNumber(9) },
      trace: {
        kind: "scene",
        scene: {
          sceneId: "main",
          actions: [
            {
              actionId: "start",
              computeRootValue: buildNumber(9),
              nextActionIds: [],
            },
          ],
        },
      },
    });
    expect(create).toHaveBeenCalledWith(new Uint8Array([1, 2]), {
      sceneId: "main",
      initialState: { score: { symbol: "number", value: 1, tags: [] } },
      failOnPublishError: false,
      maxSceneSteps: 10_000,
    });
    expect(destroy).toHaveBeenCalledOnce();
    expect(logs).toEqual(["scene-start", "action-start", "action-complete", "scene-complete"]);
  });

  it("maps strict publish failures with committed state and hook outcomes", async () => {
    const events: unknown[] = [
      {
        event: "needEffect",
        id: 9,
        kind: "publish",
        hook: "save",
        sceneId: "main",
        actionId: "start",
        callbackIndex: 0,
        binding: null,
        contextJson: '{"score":{"symbol":"number","value":7,"tags":[]}}',
      },
    ];
    const client: ZigRuntimeLifecycleTransport = {
      create: () => ({ status: "ok" as const, payload: { handle: 13 } }),
      destroy: vi.fn(() => ({ status: "ok" as const, payload: { destroyed: 13 } })),
      step: <T>() =>
        events.length > 0
          ? { status: "ok", payload: events.shift() as T }
          : { status: "runtime_error", payload: { error: "PublishHookFailed" } as T },
      resume: () => ({ status: "ok", payload: { resumed: 9 } }),
      snapshot: <T>() => ({
        status: "ok",
        payload: {
          state: { score: { symbol: "number", value: 7, tags: [] } } as T,
          done: false,
        },
      }),
    };
    const runner = createZigSceneRunner(client, new Uint8Array([1]), "main", {
      entryId: "main",
      initialState: {},
      failOnPublishError: true,
    });
    runner.usePublishHook("save", async () => ({
      hookName: "save",
      status: "error",
      message: "rejected",
    }));

    const error = await runner.run().then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toMatchObject({
      name: "SceneRuntimeError",
      code: "PublishHookFailed",
      sceneId: "main",
      context: { actionId: "start" },
      publishOutcomes: [{ hookName: "save", status: "error", message: "rejected" }],
    });
    expect(error).toHaveProperty(
      "message",
      'Scene "main": action "start": 1 publish hook(s) failed — save: rejected',
    );
    expect(error).toHaveProperty("stateAfterMerge");
    expect(
      (error as { stateAfterMerge: { snapshot(): unknown } }).stateAfterMerge.snapshot(),
    ).toEqual({
      score: buildNumber(7),
    });
    expect(runner.partialState().snapshot()).toEqual({ score: buildNumber(7) });
  });

  it("preserves route transition order and final-action completion", async () => {
    const events: unknown[] = [
      {
        event: "actionComplete",
        sceneId: "one",
        actionId: "start",
        computeRoot: { symbol: "number", value: 1, tags: [] },
        nextActionIds: [],
        publishOutcomes: [],
        warnings: [],
      },
      { event: "sceneChanged", from: "one", to: "two" },
      {
        event: "actionComplete",
        sceneId: "two",
        actionId: "finish",
        computeRoot: { symbol: "number", value: 2, tags: [] },
        nextActionIds: [],
        publishOutcomes: [],
        warnings: [],
      },
      { event: "complete" },
    ];
    const destroy = vi.fn(() => ({ status: "ok" as const, payload: { destroyed: 8 } }));
    const client: ZigRuntimeLifecycleTransport = {
      create: () => ({ status: "ok", payload: { handle: 8 } }),
      destroy,
      step: <T>() => ({ status: "ok", payload: events.shift() as T }),
      resume: vi.fn(),
      snapshot: <T>() => ({ status: "ok", payload: { state: {} as T, done: false } }),
    };
    const logs: string[] = [];
    const runner = createZigRouteRunner(client, new Uint8Array([1]), "route", {
      entryId: "route",
      initialState: {},
      onLog: (event) => logs.push(event.kind),
    });

    await expect(runner.next()).resolves.toMatchObject([
      { kind: "action", sceneId: "one", actionId: "start" },
    ]);
    expect(runner.isDone()).toBe(false);
    await expect(runner.next()).resolves.toMatchObject([
      { kind: "scene-transition", fromSceneId: "one", toSceneId: "two" },
      { kind: "action", sceneId: "two", actionId: "finish" },
    ]);
    expect(runner.isDone()).toBe(true);
    expect(runner.result().trace).toMatchObject({
      kind: "route",
      route: {
        routeId: "route",
        scenes: [
          { sceneId: "one", actions: [{ actionId: "start" }] },
          { sceneId: "two", actions: [{ actionId: "finish" }] },
        ],
      },
    });
    expect(destroy).toHaveBeenCalledOnce();
    expect(logs).toEqual([
      "scene-start",
      "action-start",
      "action-complete",
      "scene-complete",
      "scene-start",
      "action-start",
      "action-complete",
      "scene-complete",
      "route-transition",
    ]);
  });

  it("captures partial state and destroys the handle when aborted between steps", async () => {
    const controller = new AbortController();
    const destroy = vi.fn(() => ({ status: "ok" as const, payload: { destroyed: 30 } }));
    const client: ZigRuntimeLifecycleTransport = {
      create: () => ({ status: "ok", payload: { handle: 30 } }),
      destroy,
      step: <T>() => ({
        status: "ok",
        payload: {
          event: "actionComplete",
          sceneId: "main",
          actionId: "first",
          computeRoot: { symbol: "number", value: 1, tags: [] },
          nextActionIds: ["second"],
          publishOutcomes: [],
          warnings: [],
        } as T,
      }),
      resume: vi.fn(),
      snapshot: <T>() => ({
        status: "ok",
        payload: {
          state: { score: { symbol: "number", value: 1, tags: [] } } as T,
          done: false,
        },
      }),
    };
    const runner = createZigSceneRunner(client, new Uint8Array([1]), "main", {
      entryId: "main",
      initialState: {},
      signal: controller.signal,
    });

    await runner.next();
    controller.abort();

    expect(destroy).toHaveBeenCalledOnce();
    expect(runner.isDone()).toBe(false);
    expect(runner.partialState().snapshot()).toEqual({ score: buildNumber(1) });
    await expect(runner.next()).rejects.toMatchObject({ name: "AbortError" });
  });
});

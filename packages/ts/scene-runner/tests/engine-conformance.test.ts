import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildNumber } from "runtime";
import { createRunnerWithEngine } from "../src/runner.js";
import type { RunnerOptions } from "../src/runner-types.js";
import type { TurnModel } from "../src/types/turnout-model_pb.js";
import { instantiateZigRuntime, type ZigRuntimeClient } from "../src/zig-runtime/client.js";

type Engine = "typescript" | "zig";

let zigClient: ZigRuntimeClient;

beforeAll(async () => {
  const wasm = await readFile(
    new URL("../../../zig/zig-out/bin/turnout-runtime.wasm", import.meta.url),
  );
  zigClient = await instantiateZigRuntime(wasm);
});

function create(engine: Engine, model: TurnModel, options: RunnerOptions) {
  return createRunnerWithEngine(
    model,
    options,
    engine === "typescript" ? { kind: "typescript" } : { kind: "zig", client: zigClient },
  );
}

function asModel(input: unknown): TurnModel {
  return input as TurnModel;
}

describe.each(["typescript", "zig"] as const)("Runner public conformance — %s", (engine) => {
  it("preserves hooks, next batching, result, partial state, and logs", async () => {
    const model = asModel({
      version: 2,
      scenes: [
        {
          id: "main",
          entryAction: "write",
          actions: [
            {
              id: "write",
              prepare: [{ binding: "input", fromHook: "load" }],
              compute: {
                root: "output",
                prog: {
                  bindings: [
                    { name: "input", type: "number", value: 0 },
                    {
                      name: "output",
                      type: "number",
                      expr: { combine: { fn: "add", args: [{ ref: "input" }, { lit: 1 }] } },
                    },
                  ],
                },
              },
              merge: [{ binding: "output", toState: "result.value" }],
              publish: ["save"],
            },
          ],
        },
      ],
      routes: [],
    });
    const publish = vi.fn();
    const logs: unknown[] = [];
    const runner = create(engine, model, {
      entryId: "main",
      initialState: {},
      allowUncheckedState: true,
      onLog: (event) => logs.push(event),
    })
      .usePrepareHook("load", () => ({ input: buildNumber(4) }))
      .usePublishHook("save", publish);

    expect(() => runner.result()).toThrowError(
      expect.objectContaining({ name: "RunnerError", code: "IncompleteExecution" }),
    );
    expect(runner.partialState().snapshot()).toEqual({});

    await expect(runner.next(2)).resolves.toMatchObject([
      { done: false, kind: "action", sceneId: "main", actionId: "write" },
    ]);
    expect(runner.isDone()).toBe(true);
    expect(publish).toHaveBeenCalledOnce();
    expect(runner.partialState().snapshot()).toEqual({ "result.value": buildNumber(5) });
    expect(runner.result()).toMatchObject({
      finalState: { "result.value": buildNumber(5) },
      trace: {
        kind: "scene",
        scene: { sceneId: "main", actions: [{ actionId: "write" }] },
      },
    });
    expect(logs).toMatchObject([
      { kind: "scene-start" },
      { kind: "action-start" },
      { kind: "warning" },
      { kind: "action-complete" },
      { kind: "scene-complete" },
    ]);
  });

  it("preserves runAsync action stepping and route transitions", async () => {
    const model = asModel({
      version: 2,
      scenes: [
        {
          id: "one",
          entryAction: "first",
          actions: [{ id: "first" }],
        },
        { id: "two", entryAction: "finish", actions: [{ id: "finish" }] },
      ],
      routes: [
        {
          id: "route",
          entrySceneId: "one",
          match: [{ patterns: ["one.first"], target: "two" }],
        },
      ],
    });
    const runner = create(engine, model, {
      entryId: "route",
      initialState: {},
      allowUncheckedState: true,
    });

    const events = [];
    for await (const event of runner.runAsync()) events.push(event);

    expect(events).toMatchObject([
      { kind: "action", sceneId: "one", actionId: "first" },
      { kind: "scene-transition", fromSceneId: "one", toSceneId: "two" },
      { kind: "action", sceneId: "two", actionId: "finish" },
    ]);
    expect(runner.isDone()).toBe(true);
    expect((await runner.run()).trace).toMatchObject({
      kind: "route",
      route: { routeId: "route", scenes: [{ sceneId: "one" }, { sceneId: "two" }] },
    });
  });

  it("preserves ordered effect requests and callback context", async () => {
    const model = asModel({
      version: 2,
      scenes: [
        {
          id: "effects",
          entryAction: "run",
          actions: [
            {
              id: "run",
              prepare: [
                { binding: "base", fromState: "input.base" },
                { binding: "first", fromHook: "alpha" },
                { binding: "second", fromHook: "beta" },
              ],
              compute: {
                root: "total",
                prog: {
                  bindings: [
                    { name: "base", type: "number", value: 0 },
                    { name: "first", type: "number", value: 0 },
                    { name: "second", type: "number", value: 0 },
                    {
                      name: "total",
                      type: "number",
                      expr: { combine: { fn: "add", args: [{ ref: "first" }, { ref: "second" }] } },
                    },
                  ],
                },
              },
              merge: [{ binding: "total", toState: "output.total" }],
              publish: ["first_publish", "second_publish"],
            },
          ],
        },
      ],
      routes: [],
    });
    const calls: string[] = [];
    const numberValue = (value: unknown) =>
      typeof value === "object" && value !== null && "value" in value
        ? (value as { value: unknown }).value
        : "missing";
    const runner = create(engine, model, {
      entryId: "effects",
      initialState: { "input.base": buildNumber(2) },
      allowUncheckedState: true,
    })
      .usePrepareHook("alpha", (context) => {
        calls.push("prepare:alpha:" + numberValue(context.get("base")));
        return { first: buildNumber(3) };
      })
      .usePrepareHook("beta", (context) => {
        calls.push("prepare:beta:" + numberValue(context.get("first")));
        return { second: buildNumber(4) };
      })
      .usePublishHook("first_publish", (context) => {
        calls.push("publish:first:" + numberValue(context.state()["output.total"]));
      })
      .usePublishHook("second_publish", (context) => {
        calls.push("publish:second:" + numberValue(context.state()["output.total"]));
      });

    await runner.run();

    expect(calls).toEqual([
      "prepare:alpha:2",
      "prepare:beta:3",
      "publish:first:7",
      "publish:second:7",
    ]);
  });

  it("preserves typed misuse errors", async () => {
    const model = asModel({
      version: 2,
      scenes: [{ id: "main", entryAction: "start", actions: [{ id: "start" }] }],
      routes: [],
    });
    const runner = create(engine, model, {
      entryId: "main",
      initialState: {},
      allowUncheckedState: true,
    });

    await expect(runner.next(0)).rejects.toMatchObject({
      name: "RunnerError",
      code: "InvalidStepCount",
    });
    await runner.next();
    expect(() => runner.usePrepareHook("late", () => ({}))).toThrowError(
      expect.objectContaining({ name: "RunnerError", code: "LateHookRegistration" }),
    );
  });

  it("preserves AbortSignal cancellation between action steps", async () => {
    const controller = new AbortController();
    const model = asModel({
      version: 2,
      scenes: [
        {
          id: "main",
          entryAction: "first",
          actions: [{ id: "first", next: [{ action: "second" }] }, { id: "second" }],
        },
      ],
      routes: [],
    });
    const runner = create(engine, model, {
      entryId: "main",
      initialState: {},
      allowUncheckedState: true,
      signal: controller.signal,
    });

    await expect(runner.next()).resolves.toMatchObject([{ actionId: "first" }]);
    controller.abort();

    await expect(runner.next()).rejects.toMatchObject({ name: "AbortError" });
    expect(runner.isDone()).toBe(false);
  });
});

import { describe, it, expect, vi } from "vitest";
import { createRunner } from "../src/runner.js";
import { RunnerError } from "../src/executor/errors.js";
import { buildNumber, isPureNumber } from "runtime";
import type { TurnModel } from "../src/types/turnout-model_pb.js";

const sceneA = {
  id: "s1",
  entryActions: ["a"],
  actions: [{ id: "a" }],
};

const sceneB = {
  id: "s2",
  entryActions: ["b"],
  actions: [{ id: "b" }],
};

// spec: scene-to-scene.md §route — maxRouteTransitions and maxSceneSteps guards
describe("createRunner — route execution limits", () => {
  // spec: scene-to-scene.md §route — exceeding maxRouteTransitions throws
  it("uses maxRouteTransitions in route mode", async () => {
    const model = {
      scenes: [sceneA, sceneB],
      routes: [
        {
          id: "loop",
          entrySceneId: "s1",
          match: [
            { patterns: ["s1.a"], target: "s2" },
            { patterns: ["s2.b"], target: "s1" },
          ],
        },
      ],
    } as unknown as TurnModel;

    const runner = createRunner(model, {
      entryId: "loop",
      initialState: {},
      maxRouteTransitions: 0,
      onWarning: () => {},
    });
    await expect(() => runner.run()).rejects.toThrow("exceeded 0 scene transitions");
  });

  // spec: scene-graph.md §action — exceeding maxSceneSteps throws MaxStepsExceeded
  it("uses maxSceneSteps for the active scene executor", async () => {
    const model = {
      scenes: [
        {
          id: "s",
          entryActions: ["a"],
          actions: [{ id: "a", next: [{ action: "b" }] }, { id: "b" }],
        },
      ],
    } as unknown as TurnModel;

    const runner = createRunner(model, { entryId: "s", initialState: {}, maxSceneSteps: 1, onWarning: () => {} });
    await expect(() => runner.run()).rejects.toThrow("exceeded 1 action steps");
  });
});

describe("createRunner — scene mode API", () => {
  const scene = {
    id: "scene_api",
    entryActions: ["write"],
    actions: [
      {
        id: "write",
        prepare: [{ binding: "v", fromHook: "load_value" }],
        compute: {
          root: "out",
          prog: {
            name: "write_prog",
            bindings: [
              { name: "v", type: "number", value: 0 },
              {
                name: "out",
                type: "number",
                expr: { combine: { fn: "add", args: [{ ref: "v" }, { lit: 1 }] } },
              },
            ],
          },
        },
        merge: [{ binding: "out", toState: "result.value" }],
        publish: ["notify"],
      },
    ],
  };

  const model = { scenes: [scene], routes: [] } as unknown as TurnModel;

  it("supports hook registration, next batching, result, and partialState", async () => {
    const publish = vi.fn();
    const runner = createRunner(model, { entryId: "scene_api", initialState: {}, onWarning: () => {} })
      .usePrepareHook("load_value", () => ({ v: buildNumber(4) }))
      .usePublishHook("notify", publish);

    expect(() => runner.result()).toThrow("execution is not complete");
    expect(runner.partialState().snapshot()).toEqual({});

    const steps = await runner.next(2);

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ done: false, sceneId: "scene_api", actionId: "write" });
    expect(runner.isDone()).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);

    const partial = runner.partialState().read("result.value");
    expect(isPureNumber(partial!) && partial.value).toBe(5);

    const result = runner.result();
    expect(result.trace.kind).toBe("scene");
    expect(
      isPureNumber(result.finalState["result.value"]!) && result.finalState["result.value"].value,
    ).toBe(5);
  });

  it("runAsync yields action steps and lets run finish an already completed runner", async () => {
    const runner = createRunner(model, { entryId: "scene_api", initialState: {}, onWarning: () => {} }).usePrepareHook(
      "load_value",
      () => ({ v: buildNumber(1) }),
    );

    const yielded = [];
    for await (const step of runner.runAsync()) {
      yielded.push(step);
    }

    expect(yielded).toHaveLength(1);
    expect(yielded[0]).toMatchObject({ done: false, sceneId: "scene_api", actionId: "write" });
    expect(runner.isDone()).toBe(true);

    const result = await runner.run();
    expect(result.trace.kind).toBe("scene");
  });
});

describe("createRunner — API misuse contracts", () => {
  const model = {
    scenes: [{ id: "contract", entryActions: ["a"], actions: [{ id: "a" }] }],
    routes: [],
  } as unknown as TurnModel;

  it("throws a typed error when result is read before completion", () => {
    const runner = createRunner(model, { entryId: "contract", initialState: {}, onWarning: () => {} });

    expect(() => runner.result()).toThrow(RunnerError);
    expect(() => runner.result()).toThrow("execution is not complete");
    try {
      runner.result();
    } catch (err) {
      expect(err).toMatchObject({ name: "RunnerError", code: "IncompleteExecution" });
    }
  });

  it("rejects invalid next step counts with a typed error", async () => {
    const runner = createRunner(model, { entryId: "contract", initialState: {}, onWarning: () => {} });

    await expect(runner.next(0)).rejects.toMatchObject({
      name: "RunnerError",
      code: "InvalidStepCount",
    });
    await expect(runner.next(1.5)).rejects.toMatchObject({
      name: "RunnerError",
      code: "InvalidStepCount",
    });
  });

  it("rejects hook registration after next() starts execution", async () => {
    const runner = createRunner(model, { entryId: "contract", initialState: {}, onWarning: () => {} });

    await runner.next();

    expect(() => runner.usePrepareHook("late", () => ({}))).toThrow(RunnerError);
    expect(() => runner.usePublishHook("late", () => {})).toThrow(RunnerError);
  });

  it("rejects hook registration after runAsync() is created", () => {
    const runner = createRunner(model, { entryId: "contract", initialState: {}, onWarning: () => {} });

    const iterator = runner.runAsync();

    expect(() => runner.usePrepareHook("late", () => ({}))).toThrow(RunnerError);
    void iterator.return?.(undefined);
  });
});

describe("createRunner — AbortSignal cancellation", () => {
  const sceneModel = {
    scenes: [{ id: "sc", entryActions: ["a"], actions: [{ id: "a" }] }],
    routes: [],
  } as unknown as TurnModel;

  it("run() throws AbortError immediately when signal is pre-aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const runner = createRunner(sceneModel, {
      entryId: "sc",
      initialState: {},
      signal: controller.signal,
      onWarning: () => {},
    });
    await expect(runner.run()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("next() throws AbortError on second call after signal is aborted", async () => {
    const controller = new AbortController();
    const twoActionModel = {
      scenes: [
        {
          id: "sc2",
          entryActions: ["a"],
          actions: [{ id: "a", next: [{ action: "b" }] }, { id: "b" }],
        },
      ],
      routes: [],
    } as unknown as TurnModel;
    const runner = createRunner(twoActionModel, {
      entryId: "sc2",
      initialState: {},
      signal: controller.signal,
      onWarning: () => {},
    });

    const first = await runner.next();
    expect(first[0]).toMatchObject({ kind: "action", actionId: "a" });

    controller.abort();

    await expect(runner.next()).rejects.toMatchObject({ name: "AbortError" });
    expect(runner.isDone()).toBe(false);
  });

  it("signal is forwarded to prepare hooks", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;

    const hookModel = {
      scenes: [
        {
          id: "hs",
          entryActions: ["a"],
          actions: [
            {
              id: "a",
              prepare: [{ binding: "x", fromHook: "capture" }],
              compute: {
                root: "x",
                prog: { name: "p", bindings: [{ name: "x", type: "number", value: 0 }] },
              },
            },
          ],
        },
      ],
      routes: [],
    } as unknown as TurnModel;

    await createRunner(hookModel, { entryId: "hs", initialState: {}, signal: controller.signal, onWarning: () => {} })
      .usePrepareHook("capture", (_ctx, sig) => {
        receivedSignal = sig;
        return { x: buildNumber(1) };
      })
      .run();

    expect(receivedSignal).toBe(controller.signal);
  });
});

describe("createRunner — route mode API", () => {
  const routeModel = {
    scenes: [sceneA, sceneB],
    routes: [
      {
        id: "route_api",
        entrySceneId: "s1",
        match: [{ patterns: ["s1.a"], target: "s2" }],
      },
    ],
  } as unknown as TurnModel;

  it("steps across route scenes and returns a route result", async () => {
    const runner = createRunner(routeModel, { entryId: "route_api", initialState: {}, onWarning: () => {} });

    expect(() => runner.result()).toThrow("execution is not complete");

    const first = await runner.next();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ done: false, kind: "action", sceneId: "s1", actionId: "a" });

    // next(1) counts 1 action step: first returns scene-transition then the action
    const rest = await runner.next(1);
    expect(
      rest.some((step) => step.kind === "action" && step.sceneId === "s2" && step.actionId === "b"),
    ).toBe(true);
    expect(
      rest.some(
        (step) =>
          step.kind === "scene-transition" && step.fromSceneId === "s1" && step.toSceneId === "s2",
      ),
    ).toBe(true);
    expect(runner.isDone()).toBe(false);

    const done = await runner.next();
    expect(done).toHaveLength(0);
    expect(runner.isDone()).toBe(true);

    const result = runner.result();
    if (result.trace.kind !== "route") throw new Error("Expected route trace");
    expect(result.trace.route.routeId).toBe("route_api");
  });

  it("runAsync yields scene-transition events between scenes", async () => {
    const runner = createRunner(routeModel, { entryId: "route_api", initialState: {}, onWarning: () => {} });
    const yielded = [];

    for await (const step of runner.runAsync()) yielded.push(step);

    // Expected sequence: action(s1.a), scene-transition(s1→s2), action(s2.b)
    expect(yielded).toHaveLength(3);
    expect(yielded[0]).toMatchObject({ kind: "action", sceneId: "s1", actionId: "a" });
    expect(yielded[1]).toMatchObject({
      kind: "scene-transition",
      fromSceneId: "s1",
      toSceneId: "s2",
    });
    expect(yielded[2]).toMatchObject({ kind: "action", sceneId: "s2", actionId: "b" });
    expect(runner.isDone()).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createRunner — onWarning callback
// ─────────────────────────────────────────────────────────────────────────────

describe("createRunner — onWarning callback", () => {
  const modelNoState = {
    version: 1,
    scenes: [{ id: "w", entryActions: ["a"], actions: [{ id: "a" }] }],
    routes: [],
  } as unknown as TurnModel;

  it("calls onWarning when no STATE schema is present", async () => {
    const onWarning = vi.fn();
    const runner = createRunner(modelNoState, { entryId: "w", initialState: {}, onWarning });
    await runner.run();
    expect(onWarning).toHaveBeenCalledOnce();
    expect(onWarning.mock.calls[0][0]).toContain("No STATE schema");
  });

  it("does not call console.warn when onWarning is provided", async () => {
    const warnSpy = vi.spyOn(console, "warn");
    const runner = createRunner(modelNoState, {
      entryId: "w",
      initialState: {},
      onWarning: () => {},
    });
    await runner.run();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("calls console.warn when onWarning is absent (default is console.warn)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runner = createRunner(modelNoState, { entryId: "w", initialState: {} });
    await runner.run();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]![0]).toContain("No STATE schema");
    warnSpy.mockRestore();
  });
});

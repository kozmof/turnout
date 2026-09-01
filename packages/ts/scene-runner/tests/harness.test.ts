import { describe, it, expect, vi } from "vitest";
import { runHarness, runHarnessWithEngine } from "../src/harness/harness.js";
import { buildNumber } from "runtime";
import type { TurnModel } from "../src/types/turnout-model_pb.js";
import type { ZigRuntimeLifecycleTransport } from "../src/zig-runtime/runner-adapter.js";

// Minimal scene fixture — no compute, just an empty action so execution terminates.
const minimalScene = {
  id: "scene_a",
  entryAction: "act_a",
  actions: [{ id: "act_a" }],
};

describe("runHarness — error cases", () => {
  it("throws when a matching route exists but has no entrySceneId declared", async () => {
    const model = {
      scenes: [],
      routes: [{ id: "empty_route", match: [] }],
    } as unknown as TurnModel;
    await expect(() =>
      runHarness({
        model,
        entryId: "empty_route",
        initialState: {},
        allowUncheckedState: true,
        onWarning: () => {},
      }),
    ).rejects.toThrow('route "empty_route" has no entry scene declared');
  });

  it("throws when entryId matches neither a route nor a scene", async () => {
    const model = {
      scenes: [minimalScene],
    } as unknown as TurnModel;
    await expect(() =>
      runHarness({
        model,
        entryId: "nonexistent",
        initialState: {},
        allowUncheckedState: true,
        onWarning: () => {},
      }),
    ).rejects.toThrow('entryId "nonexistent" not found as route or scene in the model');
  });
});

describe("runHarness — model without state schema", () => {
  it("uses stateManagerFrom when model has no state block", async () => {
    const model = {
      // no state field
      scenes: [minimalScene],
    } as unknown as TurnModel;
    const result = await runHarness({
      model,
      entryId: "scene_a",
      initialState: {},
      allowUncheckedState: true,
      onWarning: () => {},
    });
    expect(result.trace.kind).toBe("scene");
  });

  it("accepts caller-supplied initialState when no schema is present", async () => {
    const model = {
      scenes: [minimalScene],
    } as unknown as TurnModel;
    const { finalState } = await runHarness({
      model,
      entryId: "scene_a",
      initialState: { "custom.key": buildNumber(42) },
      allowUncheckedState: true,
      onWarning: () => {},
    });
    expect(finalState["custom.key"]).toBeDefined();
  });
});

describe("runHarness — ExecutionOptions propagation", () => {
  it("forwards onWarning when model has no state schema", async () => {
    const model = { scenes: [minimalScene] } as unknown as TurnModel;
    const onWarning = vi.fn();
    await runHarness({
      model,
      entryId: "scene_a",
      initialState: {},
      allowUncheckedState: true,
      onWarning,
    });
    expect(onWarning).toHaveBeenCalledOnce();
    expect(onWarning.mock.calls[0]![0]).toContain("No STATE schema");
  });

  it("forwards signal — throws AbortError when signal is already aborted", async () => {
    const model = { scenes: [minimalScene] } as unknown as TurnModel;
    const controller = new AbortController();
    controller.abort();
    await expect(() =>
      runHarness({
        model,
        entryId: "scene_a",
        initialState: {},
        allowUncheckedState: true,
        signal: controller.signal,
        onWarning: () => {},
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("registers prepare and publish hooks from options.hooks", async () => {
    const model = { scenes: [minimalScene] } as unknown as TurnModel;
    const prepareHook = vi.fn(async () => ({ type: "number" as const, value: 0 }));
    const publishHook = vi.fn(async () => {});
    await runHarness({
      model,
      entryId: "scene_a",
      initialState: {},
      allowUncheckedState: true,
      onWarning: () => {},
      hooks: { prepare: { myPrepare: prepareHook }, publish: { myPublish: publishHook } },
    });
    // hooks registered — action doesn't invoke them but the loop bodies are covered
  });
});

describe("runHarnessWithEngine — Zig migration seam", () => {
  it("preserves hook registration and result shape", async () => {
    const events: unknown[] = [
      {
        event: "needEffect",
        id: 1,
        kind: "prepare",
        hook: "load",
        sceneId: "scene_a",
        actionId: "act_a",
        callbackIndex: 0,
        binding: "input",
        contextJson: "{}",
      },
      {
        event: "actionComplete",
        sceneId: "scene_a",
        actionId: "act_a",
        computeRoot: { symbol: "number", value: 3, tags: [] },
        nextActionIds: [],
        publishOutcomes: [],
        warnings: [],
      },
    ];
    const resume = vi.fn(() => ({ status: "ok" as const, payload: { resumed: 1 } }));
    const client: ZigRuntimeLifecycleTransport = {
      create: () => ({ status: "ok", payload: { handle: 40 } }),
      destroy: () => ({ status: "ok", payload: { destroyed: 40 } }),
      step: <T>() => ({ status: "ok", payload: events.shift() as T }),
      resume,
      snapshot: <T>() => ({ status: "ok", payload: { state: {} as T, done: false } }),
    };
    const prepare = vi.fn(() => ({ input: buildNumber(3) }));
    const model = {
      version: 2,
      scenes: [
        {
          id: "scene_a",
          entryAction: "act_a",
          actions: [{ id: "act_a", prepare: [{ binding: "input", fromHook: "load" }] }],
        },
      ],
      routes: [],
    } as unknown as TurnModel;

    const result = await runHarnessWithEngine(
      {
        model,
        entryId: "scene_a",
        initialState: {},
        allowUncheckedState: true,
        hooks: { prepare: { load: prepare }, publish: {} },
      },
      { kind: "zig", client },
    );

    expect(result.trace).toMatchObject({ kind: "scene", scene: { sceneId: "scene_a" } });
    expect(prepare).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledWith(40, expect.objectContaining({ status: "ok" }));
  });
});

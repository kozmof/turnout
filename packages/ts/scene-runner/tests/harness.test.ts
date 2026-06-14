import { describe, it, expect, vi } from "vitest";
import { runHarness } from "../src/harness/harness.js";
import type { TurnModel } from "../src/types/turnout-model_pb.js";

// Minimal scene fixture — no compute, just an empty action so execution terminates.
const minimalScene = {
  id: "scene_a",
  entryActions: ["act_a"],
  actions: [{ id: "act_a" }],
};

describe("runHarness — error cases", () => {
  it("throws when a matching route exists but has no entrySceneId declared", async () => {
    const model = {
      scenes: [],
      routes: [{ id: "empty_route", match: [] }],
    } as unknown as TurnModel;
    await expect(() =>
      runHarness({ model, entryId: "empty_route", initialState: {} }),
    ).rejects.toThrow('entry "empty_route" is a route but has no entry scene declared');
  });

  it("throws when entryId matches neither a route nor a scene", async () => {
    const model = {
      scenes: [minimalScene],
    } as unknown as TurnModel;
    await expect(() =>
      runHarness({ model, entryId: "nonexistent", initialState: {} }),
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialState: { "custom.key": { type: "number", value: 42 } as any },
    });
    expect(finalState["custom.key"]).toBeDefined();
  });
});

describe("runHarness — ExecutionOptions propagation", () => {
  it("forwards onWarning when model has no state schema", async () => {
    const model = { scenes: [minimalScene] } as unknown as TurnModel;
    const onWarning = vi.fn();
    await runHarness({ model, entryId: "scene_a", initialState: {}, onWarning });
    expect(onWarning).toHaveBeenCalledOnce();
    expect(onWarning.mock.calls[0]![0]).toContain("No STATE schema");
  });

  it("forwards signal — throws AbortError when signal is already aborted", async () => {
    const model = { scenes: [minimalScene] } as unknown as TurnModel;
    const controller = new AbortController();
    controller.abort();
    await expect(() =>
      runHarness({ model, entryId: "scene_a", initialState: {}, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

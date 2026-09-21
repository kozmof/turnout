import { beforeEach, describe, expect, it } from "vitest";
import {
  lateReclaimedHandles,
  leakedModelHandles,
  leakedRuntimeHandles,
  recordLateModelHandle,
  recordLateRuntimeHandle,
  recordLeakedHandle,
  recordLeakedModelHandle,
  resetLeakedRuntimeHandles,
} from "./leaked-handles.js";

describe("leaked runtime handles", () => {
  beforeEach(() => {
    resetLeakedRuntimeHandles();
  });

  it("starts empty", () => {
    expect(leakedRuntimeHandles()).toEqual({ count: 0, handles: [] });
  });

  it("returns the running total so a warning can name it", () => {
    expect(recordLeakedHandle(7)).toBe(1);
    expect(recordLeakedHandle(9)).toBe(2);
    expect(leakedRuntimeHandles()).toEqual({ count: 2, handles: [7, 9] });
  });

  // The count is what a host alerts on, so it must keep rising after the list
  // stops growing — otherwise the tally would itself be a second leak.
  it("keeps counting past the handles it retains", () => {
    for (let handle = 1; handle <= 100; handle += 1) recordLeakedHandle(handle);
    const leaked = leakedRuntimeHandles();
    expect(leaked.count).toBe(100);
    expect(leaked.handles).toHaveLength(32);
    expect(leaked.handles.at(0)).toBe(1);
    expect(leaked.handles.at(-1)).toBe(32);
  });

  it("hands out a copy, so a caller cannot edit the tally", () => {
    recordLeakedHandle(4);
    const leaked = leakedRuntimeHandles();
    (leaked.handles as number[]).push(5);
    expect(leakedRuntimeHandles().handles).toEqual([4]);
  });

  it("clears on reset, for a host that has reloaded the engine", () => {
    recordLeakedHandle(1);
    resetLeakedRuntimeHandles();
    expect(leakedRuntimeHandles()).toEqual({ count: 0, handles: [] });
  });

  // A model handle is a separate space from a runtime handle and was invisible
  // until now: prepareModel takes one, release() is manual, and a caller who
  // forgot leaked it with nothing recording that it had happened.
  it("counts model handles apart from runtime handles", () => {
    recordLeakedHandle(1);
    recordLeakedModelHandle(2);
    recordLeakedModelHandle(3);
    expect(leakedRuntimeHandles()).toEqual({ count: 1, handles: [1] });
    expect(leakedModelHandles()).toEqual({ count: 2, handles: [2, 3] });
  });

  // Reclaimed late is not leaked: the handle came back, just at a moment the
  // collector chose. Conflating the two would either hide a real leak in the
  // noise or raise an alert for handles that were never lost.
  it("counts a late reclaim apart from a leak", () => {
    recordLeakedHandle(1);
    recordLateRuntimeHandle(2);
    recordLateModelHandle(3);
    expect(leakedRuntimeHandles()).toEqual({ count: 1, handles: [1] });
    expect(leakedModelHandles().count).toBe(0);
    expect(lateReclaimedHandles()).toEqual({
      runtime: { count: 1, handles: [2] },
      model: { count: 1, handles: [3] },
    });
  });

  it("clears every tally on reset, not only the runtime one", () => {
    recordLeakedModelHandle(1);
    recordLateRuntimeHandle(2);
    recordLateModelHandle(3);
    resetLeakedRuntimeHandles();
    expect(leakedModelHandles().count).toBe(0);
    expect(lateReclaimedHandles().runtime.count).toBe(0);
    expect(lateReclaimedHandles().model.count).toBe(0);
  });
});

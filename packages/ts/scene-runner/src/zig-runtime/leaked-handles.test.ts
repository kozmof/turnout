import { beforeEach, describe, expect, it } from "vitest";
import {
  leakedRuntimeHandles,
  recordLeakedHandle,
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
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { reclaimHandle, watchHandle } from "./handle-registry.js";
import {
  lateReclaimedHandles,
  leakedModelHandles,
  leakedRuntimeHandles,
  resetLeakedRuntimeHandles,
} from "./leaked-handles.js";

describe("handle registry", () => {
  beforeEach(() => {
    resetLeakedRuntimeHandles();
  });

  it("destroys a handle whose owner was collected, and counts it as late rather than leaked", () => {
    const destroy = vi.fn();
    const onWarning = vi.fn();
    reclaimHandle({ kind: "runtime", handle: 11, destroy, onWarning });

    expect(destroy).toHaveBeenCalledTimes(1);
    // It came back, so it is not a leak.
    expect(leakedRuntimeHandles().count).toBe(0);
    expect(lateReclaimedHandles().runtime).toEqual({ count: 1, handles: [11] });
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining("reclaimed by a finalizer"));
  });

  // The backstop is the last thing that could have given it back. If it cannot,
  // the handle is gone for the life of the process, which is the leak tally's
  // subject and the number a host alerts on.
  it("counts a handle the backstop could not destroy as leaked", () => {
    const onWarning = vi.fn();
    reclaimHandle({
      kind: "model",
      handle: 12,
      destroy: () => {
        throw new Error("runtime refused");
      },
      onWarning,
    });

    expect(leakedModelHandles()).toEqual({ count: 1, handles: [12] });
    expect(lateReclaimedHandles().model.count).toBe(0);
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining("runtime refused"));
  });

  it("names the remedy for each kind, since reaching here is the caller's bug", () => {
    const runtimeWarning = vi.fn();
    const modelWarning = vi.fn();
    reclaimHandle({ kind: "runtime", handle: 13, destroy: () => {}, onWarning: runtimeWarning });
    reclaimHandle({ kind: "model", handle: 14, destroy: () => {}, onWarning: modelWarning });

    expect(runtimeWarning).toHaveBeenCalledWith(expect.stringContaining("abort its signal"));
    expect(modelWarning).toHaveBeenCalledWith(expect.stringContaining("release()"));
  });

  it("survives a caller with no warning sink", () => {
    expect(() =>
      reclaimHandle({ kind: "runtime", handle: 15, destroy: () => {}, onWarning: undefined }),
    ).not.toThrow();
    expect(lateReclaimedHandles().runtime.count).toBe(1);
  });

  it("unwatches idempotently, so a double close does not unregister twice", () => {
    const { unwatch } = watchHandle(
      {},
      {
        kind: "runtime",
        handle: 16,
        destroy: () => {},
        onWarning: undefined,
      },
    );
    expect(() => {
      unwatch();
      unwatch();
    }).not.toThrow();
  });

  // Every deterministic path still works without one; only the backstop is gone.
  // Throwing here instead would turn a missing platform feature into a failure to
  // create a runner at all, which is strictly worse than having no last resort.
  it("degrades to no backstop where FinalizationRegistry is absent", async () => {
    vi.stubGlobal("FinalizationRegistry", undefined);
    vi.resetModules();
    try {
      const { watchHandle: withoutRegistry } = await import("./handle-registry.js");
      const { unwatch } = withoutRegistry(
        {},
        { kind: "model", handle: 17, destroy: () => {}, onWarning: undefined },
      );
      expect(() => unwatch()).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  createZigRouteRunner,
  createZigSceneRunner,
  type ZigRuntimeLifecycleTransport,
} from "./runner-adapter.js";

/**
 * A runtime handle is taken when a runner is created, not when it is first
 * stepped, so a runner that is built and dropped holds one for the life of the
 * process — handles are never recycled. These cover the deterministic way out:
 * `[Symbol.dispose]`, and the `using` declaration that calls it.
 */

function lifecycle(handle: number) {
  const destroy = vi.fn(() => ({ status: "ok" as const, payload: { destroyed: handle } }));
  const client: ZigRuntimeLifecycleTransport = {
    create: () => ({
      status: "ok",
      payload: {
        handle,
        maxSceneSteps: 10_000,
        maxRouteTransitions: 1_000,
        maxModelMerges: 100,
      },
    }),
    destroy,
    step: <T>() => ({ status: "ok" as const, payload: { event: "complete" } as T }),
    resume: vi.fn(),
    snapshot: <T>() => ({ status: "ok" as const, payload: { state: {} as T, done: false } }),
  };
  return { client, destroy };
}

function sceneRunner(handle: number) {
  const { client, destroy } = lifecycle(handle);
  return {
    destroy,
    runner: createZigSceneRunner(client, new Uint8Array([1]), "main", {
      entryId: "main",
      initialState: {},
    }),
  };
}

describe("runner disposal", () => {
  it("gives the handle back when a runner is disposed before it is ever stepped", () => {
    const { runner, destroy } = sceneRunner(301);
    expect(destroy).not.toHaveBeenCalled();
    runner[Symbol.dispose]();
    expect(destroy).toHaveBeenCalledWith(301);
  });

  it("closes the handle on the way out of a `using` block", () => {
    const { client, destroy } = lifecycle(302);
    {
      using runner = createZigSceneRunner(client, new Uint8Array([1]), "main", {
        entryId: "main",
        initialState: {},
      });
      expect(runner.isDone()).toBe(false);
      expect(destroy).not.toHaveBeenCalled();
    }
    expect(destroy).toHaveBeenCalledWith(302);
  });

  it("is idempotent, so disposing twice destroys once", () => {
    const { runner, destroy } = sceneRunner(303);
    runner[Symbol.dispose]();
    runner[Symbol.dispose]();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  // The handle is already back by then; a second destroy would be against a
  // handle the engine no longer knows, which is `invalid_handle`, not a no-op.
  it("does not destroy a second time after a completed run", async () => {
    const { runner, destroy } = sceneRunner(304);
    await runner.run();
    expect(destroy).toHaveBeenCalledTimes(1);
    runner[Symbol.dispose]();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  // Disposal is the abort path, not the completion path: it captures what STATE
  // holds and refuses further stepping rather than throwing over the caller.
  it("keeps partial state readable and refuses to step again", async () => {
    const { runner } = sceneRunner(305);
    runner[Symbol.dispose]();
    expect(() => runner.partialState()).not.toThrow();
    await expect(runner.next()).rejects.toThrow("the run ended without completing");
  });

  it("disposes a route runner the same way", () => {
    const { client, destroy } = lifecycle(306);
    const runner = createZigRouteRunner(client, new Uint8Array([1]), "route", {
      entryId: "route",
      initialState: {},
    });
    runner[Symbol.dispose]();
    expect(destroy).toHaveBeenCalledWith(306);
  });
});

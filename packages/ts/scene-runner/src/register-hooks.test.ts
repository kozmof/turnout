import { describe, expect, it, vi } from "vitest";
import type { HarnessResult, HookRegistry } from "./types/harness-types.js";
import type { Runner } from "./runner-types.js";
import { registerHooks } from "./register-hooks.js";

function fakeRunner() {
  const runner = {
    usePrepareHook: vi.fn(() => runner),
    useExtendHook: vi.fn(() => runner),
    usePublishHook: vi.fn(() => runner),
  } as unknown as Runner<HarnessResult>;
  return runner;
}

describe("registerHooks", () => {
  // `executeSceneSafe` and `executeRouteSafe` each registered prepare and
  // publish and dropped extend, while `runHarness` registered all three.
  // `HookRegistry` makes extend required, so callers were obliged to supply
  // extend hooks and then got no error, no warning, and an action that failed
  // later with MissingExtendHook — naming the model rather than the
  // registration that never happened.
  it("registers every hook kind", () => {
    const runner = fakeRunner();
    const hooks: HookRegistry = {
      prepare: { fetch_price: vi.fn() },
      extend: { fetch_checkout_scenes: vi.fn() },
      publish: { emit_receipt: vi.fn() },
    };

    registerHooks(runner, hooks);

    expect(runner.usePrepareHook).toHaveBeenCalledWith("fetch_price", hooks.prepare.fetch_price);
    expect(runner.useExtendHook).toHaveBeenCalledWith(
      "fetch_checkout_scenes",
      hooks.extend.fetch_checkout_scenes,
    );
    expect(runner.usePublishHook).toHaveBeenCalledWith("emit_receipt", hooks.publish.emit_receipt);
  });

  it("accepts a partial registry and an absent one", () => {
    const partial = fakeRunner();
    registerHooks(partial, { extend: { grow: vi.fn() } });
    expect(partial.useExtendHook).toHaveBeenCalledOnce();
    expect(partial.usePrepareHook).not.toHaveBeenCalled();

    const none = fakeRunner();
    registerHooks(none, undefined);
    expect(none.usePrepareHook).not.toHaveBeenCalled();
    expect(none.useExtendHook).not.toHaveBeenCalled();
    expect(none.usePublishHook).not.toHaveBeenCalled();
  });
});

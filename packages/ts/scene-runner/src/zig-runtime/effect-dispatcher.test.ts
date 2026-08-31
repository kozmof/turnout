import { buildNull, buildNumber, buildRecord, buildString } from "runtime";
import { describe, expect, it, vi } from "vitest";
import type { HookRegistry } from "../types/harness-types.js";
import { dispatchZigEffect, type ZigEffectRequest } from "./effect-dispatcher.js";
import { fromCanonicalValue, toCanonicalValue } from "./value-codec.js";

const signal = new AbortController().signal;

function hooks(): HookRegistry {
  return {
    prepare: Object.create(null) as HookRegistry["prepare"],
    publish: Object.create(null) as HookRegistry["publish"],
  };
}

function request(
  kind: "prepare" | "publish",
  context: Record<string, unknown> = {},
): ZigEffectRequest {
  return {
    event: "needEffect",
    id: 4,
    kind,
    hook: "load",
    sceneId: "main",
    actionId: "start",
    callbackIndex: 0,
    binding: null,
    contextJson: JSON.stringify(context),
  };
}

describe("canonical Value codec", () => {
  it("round trips nested records, null reasons, and tags", () => {
    const value = buildRecord(
      {
        name: buildString("Ada", ["source"]),
        missing: buildNull("not-found", ["lookup"]),
      },
      ["record"],
    );

    expect(fromCanonicalValue(toCanonicalValue(value))).toEqual(value);
  });

  it("rejects non-finite and untagged values", () => {
    expect(() =>
      toCanonicalValue({
        symbol: "number",
        value: Number.NaN,
        tags: [],
      }),
    ).toThrow("finite");
    expect(() => toCanonicalValue(3)).toThrow("tagged Value");
  });
});

describe("dispatchZigEffect", () => {
  it("dispatches prepare hooks with prior binding context", async () => {
    const registry = hooks();
    const prepare = vi.fn((context) => {
      expect(context.actionId).toBe("start");
      expect(context.hookName).toBe("load");
      expect(context.get("prior")).toEqual(buildNumber(2, ["state"]));
      return { loaded: buildString("ready", ["hook"]) };
    });
    registry.prepare.load = prepare;

    await expect(
      dispatchZigEffect(
        request("prepare", {
          prior: {
            symbol: "number",
            value: 2,
            tags: ["state"],
          },
        }),
        registry,
        signal,
      ),
    ).resolves.toEqual({
      id: 4,
      kind: "prepare",
      status: "ok",
      value: {
        loaded: {
          symbol: "string",
          value: "ready",
          tags: ["hook"],
        },
      },
    });
    expect(prepare).toHaveBeenCalledOnce();
  });

  it("distinguishes missing and failed prepare hooks", async () => {
    const registry = hooks();
    await expect(dispatchZigEffect(request("prepare"), registry, signal)).resolves.toEqual({
      id: 4,
      kind: "prepare",
      status: "missing",
    });

    const thrown = new Error("load failed");
    registry.prepare.load = () => {
      throw thrown;
    };
    const failed = await dispatchZigEffect(request("prepare"), registry, signal);
    expect(failed).toMatchObject({
      kind: "prepare",
      status: "failed",
      message: "Error: load failed",
    });
    expect(failed).toHaveProperty("hostError", thrown);
    expect(JSON.stringify(failed)).not.toContain("hostError");
  });

  it("maps invalid prepare results to structured errors", async () => {
    const registry = hooks();
    registry.prepare.load = () => ({ other: buildNumber(1) });
    await expect(
      dispatchZigEffect({ ...request("prepare"), binding: "loaded" }, registry, signal),
    ).rejects.toMatchObject({
      name: "PrepareError",
      code: "MissingHookField",
      actionId: "start",
    });

    registry.prepare.load = () => ({ loaded: 42 }) as never;
    await expect(
      dispatchZigEffect({ ...request("prepare"), binding: "loaded" }, registry, signal),
    ).rejects.toMatchObject({
      name: "PrepareError",
      code: "InvalidHookValue",
      actionId: "start",
    });
  });

  it("passes post-merge STATE to publish hooks", async () => {
    const registry = hooks();
    registry.publish.load = (context) => {
      expect(context.state()).toEqual({ score: buildNumber(7) });
    };
    await expect(
      dispatchZigEffect(
        request("publish", {
          score: { symbol: "number", value: 7, tags: [] },
        }),
        registry,
        signal,
      ),
    ).resolves.toEqual({
      id: 4,
      kind: "publish",
      status: "ok",
    });
  });

  it("distinguishes returned and thrown publish failures", async () => {
    const registry = hooks();
    registry.publish.load = () => ({
      hookName: "ignored",
      status: "error",
      message: "returned failure",
    });
    await expect(dispatchZigEffect(request("publish"), registry, signal)).resolves.toMatchObject({
      status: "failed",
      source: "returned",
      message: "returned failure",
    });

    registry.publish.load = () => {
      throw new Error("thrown failure");
    };
    await expect(dispatchZigEffect(request("publish"), registry, signal)).resolves.toMatchObject({
      status: "failed",
      source: "thrown",
      message: "Error: thrown failure",
    });
  });

  it("propagates cancellation as AbortError", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      dispatchZigEffect(request("prepare"), hooks(), controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

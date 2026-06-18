import { describe, it, expect } from "vitest";
import {
  resolveActionPrepare,
  resolveActionPrepareSync,
  resolveNextPrepare,
} from "../src/executor/prepare-resolver.js";
import { stateManagerFromUnchecked } from "../src/state/state-manager.js";
import {
  buildNumber,
  buildString,
  buildNull,
  isPureNumber,
  isPureString,
  isPureBoolean,
  isPureNull,
  isArray,
} from "runtime";
import type { ActionExecutionResult } from "../src/executor/types.js";
import type { HookRegistry, PrepareHookContext } from "../src/types/harness-types.js";
import type { PrepareEntry, NextPrepareEntry } from "../src/types/turnout-model_pb.js";
import { PrepareError } from "../src/executor/errors.js";

// ─────────────────────────────────────────────────────────────────────────────
// resolveActionPrepare
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveActionPrepare", () => {
  it("from_state reads the value from StateManager", async () => {
    const state = stateManagerFromUnchecked({ "request.query": buildString("hello") });
    const result = await resolveActionPrepare(
      [{ binding: "query", fromState: "request.query" }] as unknown as PrepareEntry[],
      state,
      { prepare: {}, publish: {} },
      "test_action",
    );
    expect(isPureString(result["query"]!) && result["query"].value).toBe("hello");
  });

  it('from_state returns buildNull("missing") when an unchecked path is absent', async () => {
    const state = stateManagerFromUnchecked({});
    const result = await resolveActionPrepare(
      [{ binding: "missing_val", fromState: "no.such.path" }] as unknown as PrepareEntry[],
      state,
      { prepare: {}, publish: {} },
      "test_action",
    );
    expect(isPureNull(result["missing_val"]!)).toBe(true);
  });

  it("from_hook calls the hook and extracts the binding field", async () => {
    const state = stateManagerFromUnchecked({});
    const hooks: HookRegistry = {
      prepare: { my_hook: (_ctx: PrepareHookContext) => ({ foo: buildNumber(42) }) },
      publish: {},
    };
    const result = await resolveActionPrepare(
      [{ binding: "foo", fromHook: "my_hook" }] as unknown as PrepareEntry[],
      state,
      hooks,
      "test_action",
    );
    expect(isPureNumber(result["foo"]!) && result["foo"].value).toBe(42);
  });

  it("from_hook supports async hook returning a Promise", async () => {
    const state = stateManagerFromUnchecked({});
    const hooks: HookRegistry = {
      prepare: {
        async_hook: async (_ctx: PrepareHookContext) => {
          await Promise.resolve();
          return { val: buildNumber(99) };
        },
      },
      publish: {},
    };
    const result = await resolveActionPrepare(
      [{ binding: "val", fromHook: "async_hook" }] as unknown as PrepareEntry[],
      state,
      hooks,
      "test_action",
    );
    expect(isPureNumber(result["val"]!) && result["val"].value).toBe(99);
  });

  it("from_hook passes PrepareHookContext with actionId, hookName, and get()", async () => {
    const state = stateManagerFromUnchecked({ "a.x": buildNumber(7) });
    let capturedActionId: string | undefined;
    let capturedHookName: string | undefined;
    let capturedGetResult: unknown;
    const hooks: HookRegistry = {
      prepare: {
        my_hook: (ctx: PrepareHookContext) => {
          capturedActionId = ctx.actionId;
          capturedHookName = ctx.hookName;
          capturedGetResult = ctx.get("x_val"); // reads the binding resolved via from_state above
          return { bar: buildString("from_hook") };
        },
      },
      publish: {},
    };
    await resolveActionPrepare(
      [
        { binding: "x_val", fromState: "a.x" }, // resolved first
        { binding: "bar", fromHook: "my_hook" }, // hook reads x_val via ctx.get()
      ] as unknown as PrepareEntry[],
      state,
      hooks,
      "action_42",
    );
    expect(capturedActionId).toBe("action_42");
    expect(capturedHookName).toBe("my_hook");
    expect(
      isPureNumber(capturedGetResult as never) && (capturedGetResult as { value: number }).value,
    ).toBe(7);
  });

  it("from_hook throws PrepareError(UnregisteredHook) when the hook is not registered", async () => {
    const state = stateManagerFromUnchecked({});
    const err = await resolveActionPrepare(
      [{ binding: "foo", fromHook: "nonexistent_hook" }] as unknown as PrepareEntry[],
      state,
      { prepare: {}, publish: {} },
      "test_action",
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PrepareError);
    expect((err as PrepareError).code).toBe("UnregisteredHook");
    expect((err as PrepareError).actionId).toBe("test_action");
  });

  it("from_hook throws PrepareError(MissingHookField) when hook result is missing a declared field", async () => {
    const state = stateManagerFromUnchecked({});
    const hooks: HookRegistry = {
      prepare: { partial_hook: (_ctx: PrepareHookContext) => ({ other_field: buildNumber(1) }) },
      publish: {},
    };
    const err = await resolveActionPrepare(
      [{ binding: "expected_field", fromHook: "partial_hook" }] as unknown as PrepareEntry[],
      state,
      hooks,
      "test_action",
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PrepareError);
    expect((err as PrepareError).code).toBe("MissingHookField");
  });

  it("from_hook throws PrepareError(InvalidHookValue) when hook returns a raw JS value instead of AnyValue", async () => {
    const state = stateManagerFromUnchecked({});
    const hooks: HookRegistry = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prepare: { bad_hook: (_ctx: PrepareHookContext) => ({ raw: 42 as any }) },
      publish: {},
    };
    const err = await resolveActionPrepare(
      [{ binding: "raw", fromHook: "bad_hook" }] as unknown as PrepareEntry[],
      state,
      hooks,
      "test_action",
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PrepareError);
    expect((err as PrepareError).code).toBe("InvalidHookValue");
    expect((err as PrepareError).actionId).toBe("test_action");
    expect((err as Error).message).toContain("bad_hook");
    expect((err as Error).message).toContain("raw");
  });

  it("resolves multiple entries independently", async () => {
    const state = stateManagerFromUnchecked({
      "a.x": buildNumber(1),
      "b.y": buildString("two"),
    });
    const result = await resolveActionPrepare(
      [
        { binding: "x_val", fromState: "a.x" },
        { binding: "y_val", fromState: "b.y" },
      ] as unknown as PrepareEntry[],
      state,
      { prepare: {}, publish: {} },
      "test_action",
    );
    expect(isPureNumber(result["x_val"]!) && result["x_val"].value).toBe(1);
    expect(isPureString(result["y_val"]!) && result["y_val"].value).toBe("two");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveNextPrepare
// ─────────────────────────────────────────────────────────────────────────────

function makePrevResult(
  bindingValues: Record<string, import("runtime").AnyValue>,
): ActionExecutionResult {
  return {
    actionId: "prev_action",
    computeRootValue: buildNull("unknown"),
    bindingValues,
    stateAfterMerge: stateManagerFromUnchecked({}),
    publishOutcomes: [],
  };
}

describe("resolveNextPrepare", () => {
  it("from_action reads from prevResult.bindingValues", () => {
    const state = stateManagerFromUnchecked({});
    const prevResult = makePrevResult({ score: buildNumber(99) });
    const result = resolveNextPrepare(
      [{ binding: "score", fromAction: "score" }] as unknown as NextPrepareEntry[],
      state,
      prevResult,
    );
    expect(isPureNumber(result["score"]!) && result["score"].value).toBe(99);
  });

  it("from_action throws PrepareError(MissingActionBinding) when binding is absent in prevResult", () => {
    const state = stateManagerFromUnchecked({});
    const prevResult = makePrevResult({});
    let err: unknown;
    try {
      resolveNextPrepare(
        [{ binding: "missing", fromAction: "missing" }] as unknown as NextPrepareEntry[],
        state,
        prevResult,
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PrepareError);
    expect((err as PrepareError).code).toBe("MissingActionBinding");
  });

  it("from_state reads the post-merge state", () => {
    const state = stateManagerFromUnchecked({ "workflow.stage": buildString("review") });
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: "stage", fromState: "workflow.stage" }] as unknown as NextPrepareEntry[],
      state,
      prevResult,
    );
    expect(isPureString(result["stage"]!) && result["stage"].value).toBe("review");
  });

  it('from_state returns buildNull("missing") when an unchecked next path is absent', () => {
    const state = stateManagerFromUnchecked({});
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: "x", fromState: "no.path" }] as unknown as NextPrepareEntry[],
      state,
      prevResult,
    );
    expect(isPureNull(result["x"]!)).toBe(true);
  });

  it("from_literal converts number correctly", () => {
    const state = stateManagerFromUnchecked({});
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: "n", fromLiteral: 42 }] as unknown as NextPrepareEntry[],
      state,
      prevResult,
    );
    expect(isPureNumber(result["n"]!) && result["n"].value).toBe(42);
  });

  it("from_literal converts string correctly", () => {
    const state = stateManagerFromUnchecked({});
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: "msg", fromLiteral: "hello" }] as unknown as NextPrepareEntry[],
      state,
      prevResult,
    );
    expect(isPureString(result["msg"]!) && result["msg"].value).toBe("hello");
  });

  it("from_literal converts boolean correctly", () => {
    const state = stateManagerFromUnchecked({});
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: "flag", fromLiteral: true }] as unknown as NextPrepareEntry[],
      state,
      prevResult,
    );
    expect(isPureBoolean(result["flag"]!) && result["flag"].value).toBe(true);
  });

  it("from_literal converts number array correctly", () => {
    const state = stateManagerFromUnchecked({});
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: "nums", fromLiteral: [1, 2, 3] }] as unknown as NextPrepareEntry[],
      state,
      prevResult,
    );
    expect(isArray(result["nums"]!)).toBe(true);
  });

  it("from_literal converts string array correctly", () => {
    const state = stateManagerFromUnchecked({});
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: "tags", fromLiteral: ["a", "b"] }] as unknown as NextPrepareEntry[],
      state,
      prevResult,
    );
    expect(isArray(result["tags"]!)).toBe(true);
  });

  it("from_literal converts bool array correctly", () => {
    const state = stateManagerFromUnchecked({});
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: "flags", fromLiteral: [true, false] }] as unknown as NextPrepareEntry[],
      state,
      prevResult,
    );
    expect(isArray(result["flags"]!)).toBe(true);
  });

  it("from_literal rejects empty array (element type cannot be inferred)", () => {
    const state = stateManagerFromUnchecked({});
    const prevResult = makePrevResult({});
    expect(() =>
      resolveNextPrepare(
        [
          { binding: "empty", fromLiteral: [] as unknown as number[] },
        ] as unknown as NextPrepareEntry[],
        state,
        prevResult,
      ),
    ).toThrow(expect.objectContaining({ code: "InvalidHookValue" }));
  });

  it("from_literal converts nullish or object values to unknown null", () => {
    const state = stateManagerFromUnchecked({});
    const prevResult = makePrevResult({});
    const result = resolveNextPrepare(
      [{ binding: "unknown", fromLiteral: { nested: "value" } }] as unknown as NextPrepareEntry[],
      state,
      prevResult,
    );
    expect(isPureNull(result["unknown"]!)).toBe(true);
  });

  it("rejects from_hook in next prepare entries", () => {
    const state = stateManagerFromUnchecked({});
    const prevResult = makePrevResult({});
    let err: unknown;
    try {
      resolveNextPrepare(
        [{ binding: "x", fromHook: "async_prepare" }] as unknown as NextPrepareEntry[],
        state,
        prevResult,
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PrepareError);
    expect((err as PrepareError).code).toBe("UnregisteredHook");
    expect((err as Error).message).toContain("from_hook is not supported");
  });

  it("resolves multiple entries with mixed sources", () => {
    const state = stateManagerFromUnchecked({ "ctx.mode": buildString("fast") });
    const prevResult = makePrevResult({ raw_score: buildNumber(5) });
    const result = resolveNextPrepare(
      [
        { binding: "score", fromAction: "raw_score" },
        { binding: "mode", fromState: "ctx.mode" },
        { binding: "threshold", fromLiteral: 3 },
      ] as unknown as NextPrepareEntry[],
      state,
      prevResult,
    );
    expect(isPureNumber(result["score"]!) && result["score"].value).toBe(5);
    expect(isPureString(result["mode"]!) && result["mode"].value).toBe("fast");
    expect(isPureNumber(result["threshold"]!) && result["threshold"].value).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveActionPrepareSync
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveActionPrepareSync", () => {
  it("reads from_state entries synchronously", () => {
    const state = stateManagerFromUnchecked({ "ctx.mode": buildString("fast") });
    const result = resolveActionPrepareSync(
      [{ binding: "mode", fromState: "ctx.mode" }] as unknown as PrepareEntry[],
      state,
    );
    expect(isPureString(result["mode"]!) && result["mode"].value).toBe("fast");
  });

  it("rejects from_hook entries because the sync path cannot run hooks", () => {
    const state = stateManagerFromUnchecked({});
    expect(() =>
      resolveActionPrepareSync(
        [{ binding: "h", fromHook: "someHook" }] as unknown as PrepareEntry[],
        state,
      ),
    ).toThrow(PrepareError);
  });
});

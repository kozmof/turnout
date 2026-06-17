import { describe, it, expect } from "vitest";
import { executeAction } from "../src/executor/action-executor.js";
import { StateManager, stateManagerFromUnchecked } from "../src/state/state-manager.js";
import {
  buildNumber,
  buildString,
  buildBoolean,
  buildNull,
  isPureNumber,
  isPureString,
  isPureBoolean,
  isPureNull,
} from "runtime";
import type { ActionModel } from "../src/types/turnout-model_pb.js";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** A simple action: adds two values and merges the result into STATE. */
const addAction = {
  id: "add_action",
  compute: {
    root: "sum",
    prog: {
      name: "add_prog",
      bindings: [
        { name: "a", type: "number", value: 3 },
        { name: "b", type: "number", value: 4 },
        {
          name: "sum",
          type: "number",
          expr: { combine: { fn: "add", args: [{ ref: "a" }, { ref: "b" }] } },
        },
      ],
    },
  },
} as unknown as ActionModel;

// ─────────────────────────────────────────────────────────────────────────────
// Basic compute
// ─────────────────────────────────────────────────────────────────────────────

describe("executeAction — compute", () => {
  it("returns the correct computeRootValue", async () => {
    const state = stateManagerFromUnchecked({});
    const result = await executeAction(addAction, state, { prepare: {}, publish: {} });
    expect(isPureNumber(result.computeRootValue) && result.computeRootValue.value).toBe(7);
  });

  it("populates bindingValues for all prog bindings", async () => {
    const state = stateManagerFromUnchecked({});
    const result = await executeAction(addAction, state, { prepare: {}, publish: {} });
    expect(isPureNumber(result.bindingValues["a"]) && result.bindingValues["a"].value).toBe(3);
    expect(isPureNumber(result.bindingValues["b"]) && result.bindingValues["b"].value).toBe(4);
    expect(isPureNumber(result.bindingValues["sum"]) && result.bindingValues["sum"].value).toBe(7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Prepare (from_state)
// ─────────────────────────────────────────────────────────────────────────────

describe("executeAction — prepare", () => {
  const actionWithPrepare = {
    id: "prepared_action",
    prepare: [{ binding: "a", fromState: "inputs.a" }],
    compute: {
      root: "sum",
      prog: {
        name: "prepared_prog",
        bindings: [
          { name: "a", type: "number", value: 0 }, // placeholder; will be overridden
          { name: "b", type: "number", value: 10 },
          {
            name: "sum",
            type: "number",
            expr: { combine: { fn: "add", args: [{ ref: "a" }, { ref: "b" }] } },
          },
        ],
      },
    },
  } as unknown as ActionModel;

  it("from_state injects value from STATE into the prog", async () => {
    const state = stateManagerFromUnchecked({ "inputs.a": buildNumber(5) });
    const result = await executeAction(actionWithPrepare, state, { prepare: {}, publish: {} });
    // a is overridden to 5; b is 10 → sum = 15
    expect(isPureNumber(result.computeRootValue) && result.computeRootValue.value).toBe(15);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Merge
// ─────────────────────────────────────────────────────────────────────────────

describe("executeAction — merge", () => {
  const actionWithMerge = {
    id: "merge_action",
    compute: {
      root: "result",
      prog: {
        name: "merge_prog",
        bindings: [
          { name: "x", type: "number", value: 42 },
          {
            name: "result",
            type: "number",
            expr: { combine: { fn: "add", args: [{ ref: "x" }, { lit: 0 }] } },
          },
        ],
      },
    },
    merge: [{ binding: "x", toState: "output.value" }],
  } as unknown as ActionModel;

  it("writes merged binding value to STATE", async () => {
    const state = stateManagerFromUnchecked({});
    const result = await executeAction(actionWithMerge, state, { prepare: {}, publish: {} });
    const stateVal = result.stateAfterMerge.read("output.value");
    expect(isPureNumber(stateVal!) && stateVal.value).toBe(42);
  });

  it("does not mutate the input state", async () => {
    const state = stateManagerFromUnchecked({});
    await executeAction(actionWithMerge, state, { prepare: {}, publish: {} });
    expect(isPureNull(state.read("output.value"))).toBe(true);
  });

  it("merges multiple entries", async () => {
    const action = {
      id: "multi_merge",
      compute: {
        root: "label",
        prog: {
          name: "multi_prog",
          bindings: [
            { name: "score", type: "number", value: 99 },
            {
              name: "label",
              type: "str",
              expr: { combine: { fn: "str_concat", args: [{ lit: "score:" }, { lit: "x" }] } },
            },
          ],
        },
      },
      merge: [{ binding: "score", toState: "result.score" }],
    } as unknown as ActionModel;
    const state = stateManagerFromUnchecked({});
    const result = await executeAction(action, state, { prepare: {}, publish: {} });
    expect(
      isPureNumber(result.stateAfterMerge.read("result.score")!) &&
        result.stateAfterMerge.read("result.score")!.value,
    ).toBe(99);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// No compute block
// ─────────────────────────────────────────────────────────────────────────────

describe("executeAction — no compute", () => {
  const noComputeAction = {
    id: "noop",
  } as unknown as ActionModel;

  it('returns buildNull("missing") as computeRootValue', async () => {
    const state = stateManagerFromUnchecked({});
    const result = await executeAction(noComputeAction, state, { prepare: {}, publish: {} });
    expect(isPureNull(result.computeRootValue)).toBe(true);
  });

  it("returns empty bindingValues", async () => {
    const state = stateManagerFromUnchecked({});
    const result = await executeAction(noComputeAction, state, { prepare: {}, publish: {} });
    expect(Object.keys(result.bindingValues)).toHaveLength(0);
  });

  it("returns the original state unchanged", async () => {
    const state = stateManagerFromUnchecked({ "a.b": buildString("original") });
    const result = await executeAction(noComputeAction, state, { prepare: {}, publish: {} });
    expect(result.stateAfterMerge).toBe(state);
  });
});

describe("executeAction — cumulative binding table", () => {
  it("skips publish hooks when the AbortSignal is already aborted", async () => {
    const hookCalls: string[] = [];
    const action = {
      id: "publish_abort_action",
      compute: {
        root: "out",
        prog: {
          name: "p",
          bindings: [{ name: "out", type: "number", value: 1 }],
        },
      },
      publish: ["hook_a", "hook_b"],
    } as unknown as ActionModel;

    const hooks = {
      prepare: {},
      publish: {
        hook_a: async () => {
          hookCalls.push("hook_a");
        },
        hook_b: async () => {
          hookCalls.push("hook_b");
        },
      },
    };

    const abortController = new AbortController();
    abortController.abort();

    await expect(
      executeAction(action, stateManagerFromUnchecked({}), hooks, "(test)", abortController.signal),
    ).rejects.toThrow("aborted");

    // Neither hook should have been invoked — the abort check fires before the first hook.
    expect(hookCalls).toEqual([]);
  });

  it("skips a publish hook declared in the action when it is missing from the registry", async () => {
    const action = {
      id: "partial_publish",
      compute: {
        root: "out",
        prog: { name: "p", bindings: [{ name: "out", type: "number", value: 1 }] },
      },
      publish: ["registered_hook", "missing_hook"],
    } as unknown as ActionModel;
    const called: string[] = [];
    const hooks = {
      prepare: {},
      publish: {
        registered_hook: async () => {
          called.push("registered_hook");
        },
        // missing_hook intentionally absent
      },
    };
    const result = await executeAction(action, stateManagerFromUnchecked({}), hooks);

    expect(called).toEqual(["registered_hook"]);
    expect(result.publishOutcomes).toEqual([{ hookName: "registered_hook", status: "ok" }]);
  });

  it("records a mergeWarning when a merge binding is absent from compute results", async () => {
    const action = {
      id: "absent_binding",
      compute: {
        root: "out",
        prog: { name: "p", bindings: [{ name: "out", type: "number", value: 42 }] },
      },
      // "ghost" is not a binding in the prog, so its value will be absent
      merge: [{ binding: "ghost", toState: "x.val" }],
    } as unknown as ActionModel;
    const result = await executeAction(action, stateManagerFromUnchecked({}), {
      prepare: {},
      publish: {},
    });
    expect(result.mergeWarnings).toBeDefined();
    expect(result.mergeWarnings?.some((w) => w.includes('"ghost"'))).toBe(true);
    // State should NOT have been updated since the binding was absent
    expect(result.stateAfterMerge.snapshot()["x.val"]).toBeUndefined();
  });

  it("makes earlier computed bindings available to later bindings", async () => {
    const action = {
      id: "chain_compute",
      compute: {
        root: "z",
        prog: {
          name: "chain_prog",
          bindings: [
            { name: "x", type: "number", value: 1 },
            {
              name: "y",
              type: "number",
              expr: { combine: { fn: "add", args: [{ ref: "x" }, { lit: 1 }] } },
            },
            {
              name: "z",
              type: "number",
              expr: { combine: { fn: "add", args: [{ ref: "y" }, { lit: 1 }] } },
            },
          ],
        },
      },
    } as unknown as ActionModel;

    const result = await executeAction(action, stateManagerFromUnchecked({}), {
      prepare: {},
      publish: {},
    });
    expect(isPureNumber(result.computeRootValue) && result.computeRootValue.value).toBe(3);
    expect(isPureNumber(result.bindingValues["y"]) && result.bindingValues["y"].value).toBe(2);
    expect(isPureNumber(result.bindingValues["z"]) && result.bindingValues["z"].value).toBe(3);
  });
});

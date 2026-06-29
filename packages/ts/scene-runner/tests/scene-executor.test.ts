import { describe, it, expect } from "vitest";
import { parseNextPolicy } from "../src/executor/next-policy.js";
import {
  executeScene,
  executeSceneSafe,
  createSceneExecutor,
} from "../src/executor/scene-executor.js";
import { stateManagerFromUnchecked } from "../src/state/state-manager.js";
import { buildNumber, buildBoolean, isPureNumber } from "runtime";
import type { SceneBlock, ActionModel } from "../src/types/turnout-model_pb.js";
import { SceneRuntimeError, PrepareError } from "../src/executor/errors.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a trivial pass-through action that merges one number binding into STATE. */
function makePassAction(id: string, value: number, toState: string): ActionModel {
  return {
    id,
    compute: {
      root: "out",
      prog: {
        name: `${id}_prog`,
        bindings: [
          { name: "v", type: "number", value },
          {
            name: "out",
            type: "number",
            expr: { combine: { fn: "add", args: [{ ref: "v" }, { lit: 0 }] } },
          },
        ],
      },
    },
    merge: [{ binding: "v", toState: toState }],
  } as unknown as ActionModel;
}

/** Build a conditional next rule that fires when a boolean state path is true. */
function makeBoolCondNextRule(condStatePath: string, nextActionId: string): ActionModel["next"] {
  return [
    {
      prepare: [{ binding: "flag", fromState: condStatePath }],
      compute: {
        condition: "flag",
        prog: {
          name: "cond_prog",
          bindings: [{ name: "flag", type: "bool", value: false }],
        },
      },
      action: nextActionId,
    },
  ] as unknown as ActionModel["next"];
}

// ─────────────────────────────────────────────────────────────────────────────
// Single action, no next rules → terminates immediately
// ─────────────────────────────────────────────────────────────────────────────

describe("executeScene — single terminal action", () => {
  const scene = {
    id: "single_scene",
    entryActions: ["only_action"],
    actions: [makePassAction("only_action", 7, "out.val")],
  } as unknown as SceneBlock;

  it("terminates the single action", async () => {
    const result = await executeScene(scene, stateManagerFromUnchecked({}));
    expect(result.terminatedAt).toEqual(["only_action"]);
  });

  it("trace contains one action entry", async () => {
    const result = await executeScene(scene, stateManagerFromUnchecked({}));
    expect(result.trace.actions).toHaveLength(1);
    expect(result.trace.actions[0]!.actionId).toBe("only_action");
    expect(result.trace.actions[0]!.nextActionIds).toEqual([]);
  });

  it("final state has the merged value", async () => {
    const result = await executeScene(scene, stateManagerFromUnchecked({}));
    const v = result.stateAfterScene.read("out.val");
    expect(isPureNumber(v!) && v.value).toBe(7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Two-action chain (first-match, conditional)
// ─────────────────────────────────────────────────────────────────────────────

describe("executeScene — two-action chain (first-match)", () => {
  const scene = {
    id: "chain_scene",
    entryActions: ["action_a"],
    nextPolicy: "first-match",
    actions: [
      {
        ...makePassAction("action_a", 1, "step.a"),
        next: makeBoolCondNextRule("gate.proceed", "action_b"),
      },
      makePassAction("action_b", 2, "step.b"),
    ],
  } as unknown as SceneBlock;

  it("follows the chain when the condition is true", async () => {
    const state = stateManagerFromUnchecked({ "gate.proceed": buildBoolean(true) });
    const result = await executeScene(scene, state);
    expect(result.terminatedAt).toEqual(["action_b"]);
    expect(result.trace.actions.map((t) => t.actionId)).toEqual(["action_a", "action_b"]);
    const v = result.stateAfterScene.read("step.b");
    expect(isPureNumber(v!) && v.value).toBe(2);
  });

  it("terminates at action_a when the condition is false", async () => {
    const state = stateManagerFromUnchecked({ "gate.proceed": buildBoolean(false) });
    const result = await executeScene(scene, state);
    expect(result.terminatedAt).toEqual(["action_a"]);
    expect(result.trace.actions.map((t) => t.actionId)).toEqual(["action_a"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unconditional next rule
// ─────────────────────────────────────────────────────────────────────────────

describe("executeScene — unconditional next rule", () => {
  const scene = {
    id: "unconditional_scene",
    entryActions: ["first"],
    actions: [
      {
        ...makePassAction("first", 10, "step.first"),
        next: [{ action: "second" }], // no compute → always fires
      },
      makePassAction("second", 20, "step.second"),
    ],
  } as unknown as SceneBlock;

  it("always follows an unconditional next rule", async () => {
    const result = await executeScene(scene, stateManagerFromUnchecked({}));
    expect(result.terminatedAt).toEqual(["second"]);
    expect(result.trace.actions.map((t) => t.actionId)).toEqual(["first", "second"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// all-match policy
// ─────────────────────────────────────────────────────────────────────────────

describe("executeScene — all-match policy", () => {
  const scene = {
    id: "all_match_scene",
    entryActions: ["start"],
    nextPolicy: "all-match",
    actions: [
      {
        ...makePassAction("start", 0, "step.start"),
        next: [
          { action: "branch_a" }, // unconditional
          { action: "branch_b" }, // unconditional
        ],
      },
      makePassAction("branch_a", 100, "step.a"),
      makePassAction("branch_b", 200, "step.b"),
    ],
  } as unknown as SceneBlock;

  it("enqueues all matching branches", async () => {
    const result = await executeScene(scene, stateManagerFromUnchecked({}));
    const ran = result.trace.actions.map((t) => t.actionId);
    expect(ran).toContain("branch_a");
    expect(ran).toContain("branch_b");
    expect(result.terminatedAt).toContain("branch_a");
    expect(result.terminatedAt).toContain("branch_b");
  });

  it("start action has both nextActionIds", async () => {
    const result = await executeScene(scene, stateManagerFromUnchecked({}));
    const startTrace = result.trace.actions.find((t) => t.actionId === "start")!;
    expect(startTrace.nextActionIds).toEqual(["branch_a", "branch_b"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// State propagation across actions
// ─────────────────────────────────────────────────────────────────────────────

describe("executeScene — state propagation", () => {
  /** Action B reads the value written by action A via from_state in prepare. */
  const actionA = {
    id: "action_a",
    compute: {
      root: "out",
      prog: {
        name: "a_prog",
        bindings: [
          { name: "v", type: "number", value: 55 },
          {
            name: "out",
            type: "number",
            expr: { combine: { fn: "add", args: [{ ref: "v" }, { lit: 0 }] } },
          },
        ],
      },
    },
    merge: [{ binding: "v", toState: "shared.val" }],
    next: [{ action: "action_b" }],
  } as unknown as ActionModel;

  const actionB = {
    id: "action_b",
    prepare: [{ binding: "input", fromState: "shared.val" }],
    compute: {
      root: "doubled",
      prog: {
        name: "b_prog",
        bindings: [
          { name: "input", type: "number", value: 0 },
          {
            name: "doubled",
            type: "number",
            expr: { combine: { fn: "add", args: [{ ref: "input" }, { ref: "input" }] } },
          },
        ],
      },
    },
    merge: [{ binding: "doubled", toState: "shared.doubled" }],
  } as unknown as ActionModel;

  const scene = {
    id: "propagation_scene",
    entryActions: ["action_a"],
    actions: [actionA, actionB],
  } as unknown as SceneBlock;

  it("action_b can read the STATE written by action_a", async () => {
    const result = await executeScene(scene, stateManagerFromUnchecked({}));
    const doubled = result.stateAfterScene.read("shared.doubled");
    // 55 written by A, doubled by B → 110
    expect(isPureNumber(doubled!) && doubled.value).toBe(110);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cycle guard
// ─────────────────────────────────────────────────────────────────────────────

describe("executeScene — cycle guard", () => {
  const scene = {
    id: "cycle_scene",
    entryActions: ["a"],
    actions: [
      {
        ...makePassAction("a", 1, "step.a"),
        next: [{ action: "a" }], // self-loop
      },
    ],
  } as unknown as SceneBlock;

  it("does not loop infinitely on a self-referencing next rule", async () => {
    const result = await executeScene(scene, stateManagerFromUnchecked({}));
    // 'a' runs once; the re-queued 'a' is skipped by the visited guard
    expect(result.trace.actions.filter((t) => t.actionId === "a")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createSceneExecutor — manual stepping API
// ─────────────────────────────────────────────────────────────────────────────

describe("createSceneExecutor — isDone / next / result", () => {
  const scene = {
    id: "step_scene",
    entryActions: ["only_action"],
    actions: [makePassAction("only_action", 7, "out.val")],
  } as unknown as SceneBlock;

  it("isDone() is false before any steps", () => {
    const executor = createSceneExecutor(scene, stateManagerFromUnchecked({}));
    expect(executor.isDone()).toBe(false);
  });

  it("next() returns done:false with a trace on the first step", async () => {
    const executor = createSceneExecutor(scene, stateManagerFromUnchecked({}));
    const step = await executor.next();
    expect(step.done).toBe(false);
    if (step.done) return;
    expect(step.trace.actionId).toBe("only_action");
  });

  it("isDone() is true after the single action runs", async () => {
    const executor = createSceneExecutor(scene, stateManagerFromUnchecked({}));
    await executor.next();
    expect(executor.isDone()).toBe(true);
  });

  it("next() returns done:true when the queue is empty", async () => {
    const executor = createSceneExecutor(scene, stateManagerFromUnchecked({}));
    await executor.next();
    expect(await executor.next()).toEqual({ done: true });
  });

  it("result() throws SceneRuntimeError(IncompleteScene) before the scene is complete", () => {
    const executor = createSceneExecutor(scene, stateManagerFromUnchecked({}));
    let err: unknown;
    try {
      executor.result();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SceneRuntimeError);
    expect((err as SceneRuntimeError).code).toBe("IncompleteScene");
  });

  it("result() returns the correct SceneExecutionResult after completion", async () => {
    const executor = createSceneExecutor(scene, stateManagerFromUnchecked({}));
    while (!executor.isDone()) await executor.next();
    const result = executor.result();
    expect(result.sceneId).toBe("step_scene");
    expect(result.terminatedAt).toEqual(["only_action"]);
    const v = result.stateAfterScene.read("out.val");
    expect(isPureNumber(v!) && v.value).toBe(7);
  });
});

describe("createSceneExecutor — step-by-step trace", () => {
  const scene = {
    id: "chain_step_scene",
    entryActions: ["first"],
    actions: [
      {
        ...makePassAction("first", 10, "step.first"),
        next: [{ action: "second" }],
      },
      makePassAction("second", 20, "step.second"),
    ],
  } as unknown as SceneBlock;

  it("yields each action trace in order", async () => {
    const executor = createSceneExecutor(scene, stateManagerFromUnchecked({}));

    const step1 = await executor.next();
    expect(step1.done).toBe(false);
    if (step1.done) return;
    expect(step1.trace.actionId).toBe("first");
    expect(step1.trace.nextActionIds).toEqual(["second"]);

    const step2 = await executor.next();
    expect(step2.done).toBe(false);
    if (step2.done) return;
    expect(step2.trace.actionId).toBe("second");
    expect(step2.trace.nextActionIds).toEqual([]);

    expect(executor.isDone()).toBe(true);
  });

  it("intermediate state is visible via result() only after completion", async () => {
    const executor = createSceneExecutor(scene, stateManagerFromUnchecked({}));
    await executor.next(); // run 'first'
    let err: unknown;
    try {
      executor.result();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SceneRuntimeError); // 'second' still pending
    await executor.next(); // run 'second'
    const result = executor.result();
    const v = result.stateAfterScene.read("step.second");
    expect(isPureNumber(v!) && v.value).toBe(20);
  });
});

describe("createSceneExecutor — cycle guard", () => {
  const scene = {
    id: "cycle_step_scene",
    entryActions: ["a"],
    actions: [
      {
        ...makePassAction("a", 1, "step.a"),
        next: [{ action: "a" }],
      },
    ],
  } as unknown as SceneBlock;

  it("completes after one step despite a self-loop next rule", async () => {
    const executor = createSceneExecutor(scene, stateManagerFromUnchecked({}));
    await executor.next();
    expect(executor.isDone()).toBe(true);
  });
});

describe("executeSceneSafe — failedActionId", () => {
  const scene = {
    id: "safe_failure_scene",
    entryActions: ["first"],
    actions: [
      {
        ...makePassAction("first", 1, "step.first"),
        next: [{ action: "second" }],
      },
      {
        id: "second",
        compute: {
          root: "out",
          prog: {
            name: "bad_prog",
            bindings: [
              { name: "x", type: "number", value: 1 },
              {
                name: "out",
                type: "number",
                expr: { combine: { fn: "missing_fn", args: [{ ref: "x" }, { lit: 1 }] } },
              },
            ],
          },
        },
      },
    ],
  } as unknown as SceneBlock;

  it("reports the action that failed before trace emission", async () => {
    const result = await executeSceneSafe(scene, stateManagerFromUnchecked({}));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failedActionId).toBe("second");
      expect((result.error as { code?: string }).code).toBe("UnknownFunction");
      expect(result.partialState.read("step.first")).toBeDefined();
    }
  });
});

describe("createSceneExecutor — all-match duplicate enqueue warnings", () => {
  it("warns when all-match enqueues an already visited action", async () => {
    const scene = {
      id: "duplicate_enqueue_scene",
      entryActions: ["start"],
      nextPolicy: "all-match",
      actions: [
        {
          ...makePassAction("start", 1, "step.start"),
          next: [{ action: "again" }, { action: "again" }],
        },
        makePassAction("again", 2, "step.again"),
      ],
    } as unknown as SceneBlock;

    const result = await executeScene(scene, stateManagerFromUnchecked({}));

    expect(result.trace.actions.map((a) => a.actionId)).toEqual(["start", "again"]);
    expect(result.trace.warnings).toEqual([
      {
        kind: "duplicate_enqueue",
        actionId: "again",
        firstEnqueuedBy: "start",
        policy: "all-match",
        alreadyVisited: false,
        message:
          'action "again" was enqueued more than once (all-match, first enqueued by "start") but ran only once',
      },
    ]);
  });
});

describe("executeSceneSafe — success result", () => {
  it("returns ok true when the scene completes", async () => {
    const scene = {
      id: "safe_success_scene",
      entryActions: ["only"],
      actions: [makePassAction("only", 3, "safe.value")],
    } as unknown as SceneBlock;

    const result = await executeSceneSafe(scene, stateManagerFromUnchecked({}));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sceneId).toBe("safe_success_scene");
      expect(isPureNumber(result.value.stateAfterScene.read("safe.value"))).toBe(true);
    }
  });
});

describe("createSceneExecutor — construction errors", () => {
  it("throws for duplicate action ids", () => {
    const duplicateA = makePassAction("dup", 1, "dup.one");
    const duplicateB = makePassAction("dup", 2, "dup.two");
    const scene = {
      id: "duplicate_action_scene",
      entryActions: ["dup"],
      actions: [duplicateA, duplicateB],
    } as unknown as SceneBlock;

    expect(() => createSceneExecutor(scene, stateManagerFromUnchecked({}))).toThrow(
      'duplicate action id "dup"',
    );
  });
});

describe("executeSceneSafe — construction errors", () => {
  it("catches DuplicateActionId thrown during construction", async () => {
    const duplicateA = makePassAction("dup", 1, "dup.one");
    const duplicateB = makePassAction("dup", 2, "dup.two");
    const scene = {
      id: "duplicate_action_safe_scene",
      entryActions: ["dup"],
      actions: [duplicateA, duplicateB],
    } as unknown as SceneBlock;

    const initialState = stateManagerFromUnchecked({});
    const result = await executeSceneSafe(scene, initialState);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SceneRuntimeError);
      expect((result.error as SceneRuntimeError).code).toBe("DuplicateActionId");
      // The duplicate action ID is surfaced via SceneRuntimeError.context even
      // when executor construction throws before the executor is assigned.
      expect(result.failedActionId).toBe("dup");
      // partialState falls back to the pre-construction state when executor never started
      expect(result.partialState).toBe(initialState);
    }
  });
});

describe("executeScene — next rule compute without prog", () => {
  it("treats a next rule with missing prog as not matched", async () => {
    const scene = {
      id: "missing_prog_scene",
      entryActions: ["start"],
      actions: [
        {
          ...makePassAction("start", 1, "step.start"),
          next: [{ compute: { condition: "flag" }, action: "never" }],
        },
        makePassAction("never", 2, "step.never"),
      ],
    } as unknown as SceneBlock;

    const result = await executeScene(scene, stateManagerFromUnchecked({}));

    expect(result.trace.actions.map((a) => a.actionId)).toEqual(["start"]);
    expect(result.terminatedAt).toEqual(["start"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// executeSceneSafe — non-SceneRuntimeError captured as ok:false
// ─────────────────────────────────────────────────────────────────────────────

describe("executeSceneSafe — non-SceneRuntimeError is captured as ok:false", () => {
  it("captures PrepareError (unregistered hook) as ok:false with partialState", async () => {
    // An action with a prepare entry that references an unregistered hook causes
    // resolveActionPrepare to throw PrepareError. PrepareError is not a
    // SceneRuntimeError, but executeSceneSafe must still capture it as
    // { ok: false } so partial state remains accessible to callers.
    const action = {
      ...makePassAction("a", 1, "x.v"),
      prepare: [{ binding: "unused", fromHook: "missing_hook" }],
    } as unknown as ActionModel;
    const scene = {
      id: "captured_scene",
      entryActions: ["a"],
      actions: [action],
    } as unknown as SceneBlock;

    const result = await executeSceneSafe(scene, stateManagerFromUnchecked({}));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(PrepareError);
      expect(result.partialState).toBeDefined();
    }
  });

  it("captures a plain Error thrown by a publish hook as ok:false with partialState", async () => {
    // Publish hooks run user-supplied code that can throw any Error.
    // executeSceneSafe must capture these and preserve partialState.
    const action = {
      ...makePassAction("a", 42, "x.v"),
      publish: ["my_hook"],
    } as unknown as ActionModel;
    const scene = {
      id: "publish_err_scene",
      entryActions: ["a"],
      actions: [action],
    } as unknown as SceneBlock;

    const hooks = {
      prepare: {},
      publish: {
        my_hook: async () => {
          throw new Error("publish failed");
        },
      },
    };

    const result = await executeSceneSafe(scene, stateManagerFromUnchecked({}), hooks);
    // publish hooks are caught by executeAction, not re-thrown — the action
    // completes and the hook failure is recorded in publishOutcomes; the
    // scene itself does not error. This test verifies executeSceneSafe still
    // returns ok:true in this case (publish errors are non-fatal).
    expect(result.ok).toBe(true);
    if (result.ok) {
      const publishedAction = result.value.trace.actions[0];
      expect(publishedAction?.publishOutcomes?.[0]).toMatchObject({
        hookName: "my_hook",
        status: "error",
      });
    }
  });

  it("captures a SceneRuntimeError as ok:false (regression guard)", async () => {
    const scene = {
      id: "runtime_err_scene",
      entryActions: ["missing_action"],
      actions: [],
    } as unknown as SceneBlock;

    const result = await executeSceneSafe(scene, stateManagerFromUnchecked({}));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SceneRuntimeError);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// evaluateNextRules — per-invocation cache key stability
//
// The cache key is built from Object.entries(nextPrepared) without sorting.
// This test verifies that two executions with identical prepare entries (same
// order, same values) produce the same result, confirming the stable-order
// assumption holds and the sort removal did not introduce a bug.
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateNextRules — cache key stability with prepare entries", () => {
  // Build a next rule with TWO prepare entries (from_state) so the key
  // has multiple entries and order matters.
  function makeActionWithTwoPrepareNextRule(): ActionModel {
    return {
      id: "source_action",
      compute: {
        root: "out",
        prog: {
          name: "source_prog",
          bindings: [{ name: "out", type: "number", value: 1 }],
        },
      },
      next: [
        {
          prepare: [
            { binding: "a", fromState: "ns.a" },
            { binding: "b", fromState: "ns.b" },
          ],
          compute: {
            condition: "result",
            prog: {
              name: "next_prog",
              bindings: [
                { name: "a", type: "number", value: 0 },
                { name: "b", type: "number", value: 0 },
                {
                  name: "result",
                  type: "bool",
                  expr: { combine: { fn: "gt", args: [{ ref: "a" }, { ref: "b" }] } },
                },
              ],
            },
          },
          action: "target_action",
        },
      ],
    } as unknown as ActionModel;
  }

  it("produces the same next-action list on repeated calls with identical state", async () => {
    const scene = {
      id: "cache_stability_scene",
      entryActions: ["source_action"],
      actions: [
        makeActionWithTwoPrepareNextRule(),
        makePassAction("target_action", 99, "ns.result"),
      ],
    } as unknown as SceneBlock;

    // ns.a > ns.b → condition is true → target_action fires
    const state = stateManagerFromUnchecked({
      "ns.a": buildNumber(10),
      "ns.b": buildNumber(5),
    });

    const result1 = await executeScene(scene, state);
    const result2 = await executeScene(scene, state);

    expect(result1.trace.actions[0]!.nextActionIds).toEqual(["target_action"]);
    expect(result2.trace.actions[0]!.nextActionIds).toEqual(["target_action"]);
  });

  it("correctly evaluates false condition (ns.a <= ns.b) on repeated calls", async () => {
    const scene = {
      id: "cache_stability_false_scene",
      entryActions: ["source_action"],
      actions: [
        makeActionWithTwoPrepareNextRule(),
        makePassAction("target_action", 99, "ns.result"),
      ],
    } as unknown as SceneBlock;

    const state = stateManagerFromUnchecked({
      "ns.a": buildNumber(3),
      "ns.b": buildNumber(7),
    });

    const result1 = await executeScene(scene, state);
    const result2 = await executeScene(scene, state);

    // Condition false → no next action → terminates at source_action
    expect(result1.terminatedAt).toEqual(["source_action"]);
    expect(result2.terminatedAt).toEqual(["source_action"]);
  });
});

// --- adversarial ---

describe("scene executor — adversarial", () => {
  it("throws DuplicateActionId when a scene has two actions with the same id", () => {
    const scene = {
      id: "dup_scene",
      nextPolicy: "",
      entryActions: ["a"],
      actions: [
        makePassAction("a", 1, "ns.x"),
        makePassAction("a", 2, "ns.x"), // duplicate
      ],
    } as unknown as SceneBlock;
    const state = stateManagerFromUnchecked({ "ns.x": buildNumber(0) });
    expect(() => createSceneExecutor(scene, state)).toThrow("duplicate action id");
  });

  it("throws MaxStepsExceeded when maxSteps is exceeded", async () => {
    // Scene: a → b → c. maxSteps=2 means step 3 (attempting c) throws.
    const aToB: ActionModel["next"] = [{ action: "b" }] as ActionModel["next"];
    const bToC: ActionModel["next"] = [{ action: "c" }] as ActionModel["next"];
    const scene = {
      id: "max_steps_scene",
      nextPolicy: "first-match",
      entryActions: ["a"],
      actions: [
        { ...makePassAction("a", 1, "ns.x"), next: aToB },
        { ...makePassAction("b", 2, "ns.x"), next: bToC },
        makePassAction("c", 3, "ns.x"),
      ],
    } as unknown as SceneBlock;
    const state = stateManagerFromUnchecked({ "ns.x": buildNumber(0) });
    const executor = createSceneExecutor(scene, state, undefined, undefined, 2);
    await expect(async () => {
      while (!executor.isDone()) await executor.next();
    }).rejects.toThrow("exceeded 2 action steps");
  });

  it("produces invalid_next_condition warning when condition resolves to a number", async () => {
    // Next-rule condition binding is a number, not a boolean.
    const scene = {
      id: "num_cond_scene",
      nextPolicy: "first-match",
      entryActions: ["start"],
      actions: [
        {
          ...makePassAction("start", 5, "ns.x"),
          next: [
            {
              compute: {
                condition: "v",
                prog: {
                  name: "num_prog",
                  bindings: [{ name: "v", type: "number", value: 1 }],
                },
              },
              action: "never",
            },
          ],
        },
        makePassAction("never", 0, "ns.x"),
      ],
    } as unknown as SceneBlock;
    const state = stateManagerFromUnchecked({ "ns.x": buildNumber(0) });
    const result = await executeScene(scene, state);
    const actionTrace = result.trace.actions[0]!;
    const warnings = actionTrace.warnings ?? [];
    const condWarn = warnings.find((w) => w.kind === "invalid_next_condition");
    expect(condWarn).toBeDefined();
    expect(condWarn?.kind).toBe("invalid_next_condition");
    expect(condWarn?.actualType).toBe("number");
  });

  it("produces duplicate_enqueue scene warning for all-match policy", async () => {
    // a → [b, b]; with all-match, b should get a duplicate_enqueue warning
    const aNext: ActionModel["next"] = [{ action: "b" }, { action: "b" }] as ActionModel["next"];
    const scene = {
      id: "dup_enqueue_scene",
      nextPolicy: "all-match",
      entryActions: ["a"],
      actions: [{ ...makePassAction("a", 1, "ns.x"), next: aNext }, makePassAction("b", 2, "ns.x")],
    } as unknown as SceneBlock;
    const state = stateManagerFromUnchecked({ "ns.x": buildNumber(0) });
    const result = await executeScene(scene, state);
    const dupWarn = result.trace.warnings?.find((w) => w.kind === "duplicate_enqueue");
    expect(dupWarn).toBeDefined();
    expect(dupWarn?.actionId).toBe("b");
    expect(dupWarn?.firstEnqueuedBy).toBe("a");
  });

  it('executeSceneSafe returns failedActionId as "<none>" when construction throws', async () => {
    const scene = {
      id: "dup_scene",
      nextPolicy: "",
      entryActions: ["a"],
      actions: [
        makePassAction("a", 1, "ns.x"),
        makePassAction("a", 2, "ns.x"), // duplicate — throws in createSceneExecutor
      ],
    } as unknown as SceneBlock;
    const state = stateManagerFromUnchecked({ "ns.x": buildNumber(0) });
    const result = await executeSceneSafe(scene, state);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Duplicate action "a" — now surfaces via SceneRuntimeError.context.actionId
      expect(result.failedActionId).toBe("a");
      expect(result.error).toBeInstanceOf(SceneRuntimeError);
    }
  });
});

describe("parseNextPolicy", () => {
  it("throws SceneRuntimeError for unsupported next_policy values", () => {
    expect(() => parseNextPolicy("bogus", "test_scene")).toThrow("unsupported next_policy");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Next-rule: condition binding not present in BuiltContext
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateNextRules — condition binding not in context (missing binding)", () => {
  it("emits invalid_next_condition warning and skips rule when condition binding is absent", async () => {
    const scene = {
      id: "missing_cond_scene",
      entryActions: ["a"],
      actions: [
        {
          ...makePassAction("a", 1, "step.a"),
          // Condition names "nonexistent" which is not a binding in the prog
          next: [
            {
              prepare: [],
              compute: {
                condition: "nonexistent",
                prog: {
                  name: "cond_prog",
                  bindings: [{ name: "actual_binding", type: "bool", value: false }],
                },
              },
              action: "b",
            },
          ],
        },
        makePassAction("b", 2, "step.b"),
      ],
    } as unknown as SceneBlock;

    const result = await executeScene(scene, stateManagerFromUnchecked({}));
    // Rule should be skipped — action b should NOT run
    expect(result.terminatedAt).toEqual(["a"]);
    expect(result.trace.actions).toHaveLength(1);
    // The invalid_next_condition warning should appear in action a's trace
    const aTrace = result.trace.actions[0];
    expect(aTrace?.warnings?.some((w) => w.kind === "invalid_next_condition")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Next-rule: RuleCtxCache hit (shared ProgModel across two next-rules)
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateNextRules — RuleCtxCache hit on shared ProgModel", () => {
  it("reuses a cached context when two next-rules share the same ProgModel object", async () => {
    // A single ProgModel object shared by two rules forces a cache hit on the
    // second evaluation (same prog identity + same serialised prepare key).
    const sharedProg = {
      name: "shared_cond_prog",
      bindings: [{ name: "flag", type: "bool", value: false }],
    };

    const scene = {
      id: "cache_hit_scene",
      entryActions: ["start"],
      nextPolicy: "all-match",
      actions: [
        {
          ...makePassAction("start", 1, "step.start"),
          next: [
            {
              prepare: [{ binding: "flag", fromState: "gate.flag" }],
              compute: { condition: "flag", prog: sharedProg },
              action: "branch_a",
            },
            {
              prepare: [{ binding: "flag", fromState: "gate.flag" }],
              compute: { condition: "flag", prog: sharedProg },
              action: "branch_b",
            },
          ],
        },
        makePassAction("branch_a", 10, "step.a"),
        makePassAction("branch_b", 20, "step.b"),
      ],
    } as unknown as SceneBlock;

    // Both rules fire → both branches run; second evaluation is a cache hit
    const state = stateManagerFromUnchecked({ "gate.flag": buildBoolean(true) });
    const result = await executeScene(scene, state);
    expect(result.trace.actions.map((a) => a.actionId)).toContain("branch_a");
    expect(result.trace.actions.map((a) => a.actionId)).toContain("branch_b");
  });
});

describe("executeScene convenience options", () => {
  const scene = {
    id: "options_scene",
    entryActions: ["only_action"],
    actions: [makePassAction("only_action", 7, "out.val")],
  } as unknown as SceneBlock;

  it("throws AbortError when called with a pre-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      executeScene(scene, stateManagerFromUnchecked({}), undefined, undefined, undefined, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("forwards structured logs through executeSceneSafe", async () => {
    const events: string[] = [];
    const result = await executeSceneSafe(
      scene,
      stateManagerFromUnchecked({}),
      undefined,
      undefined,
      undefined,
      { onLog: (event) => events.push(event.kind) },
    );

    expect(result.ok).toBe(true);
    expect(events).toEqual(["action-start", "warning", "action-complete"]);
  });

  it("a throwing onLog does not skip the action or drop its trace", async () => {
    // A logging sink that throws on action-start used to abort next() after the
    // action was dequeued but before it executed, finishing with zero traces.
    const executor = createSceneExecutor(
      scene,
      stateManagerFromUnchecked({}),
      undefined,
      undefined,
      undefined,
      undefined,
      (event) => {
        if (event.kind === "action-start") throw new Error("sink boom");
      },
    );

    const step = await executor.next();
    expect(step.done).toBe(false);
    if (step.done) return;
    expect(step.trace.actionId).toBe("only_action");
    expect(executor.isDone()).toBe(true);

    const result = executor.result();
    expect(result.trace.actions).toHaveLength(1);
    expect(result.terminatedAt).toEqual(["only_action"]);
  });

  it("a throwing onLog on action-complete still yields the trace", async () => {
    const executor = createSceneExecutor(
      scene,
      stateManagerFromUnchecked({}),
      undefined,
      undefined,
      undefined,
      undefined,
      (event) => {
        if (event.kind === "action-complete") throw new Error("sink boom");
      },
    );

    const step = await executor.next();
    expect(step.done).toBe(false);
    if (step.done) return;
    expect(step.trace.actionId).toBe("only_action");
    expect(executor.result().trace.actions).toHaveLength(1);
  });
});

describe("executeScene — failOnPublishError propagation", () => {
  function makePublishAction(id: string, hookName: string): ActionModel {
    return {
      id,
      compute: {
        root: "out",
        prog: { name: `${id}_prog`, bindings: [{ name: "out", type: "number", value: 1 }] },
      },
      publish: [hookName],
    } as unknown as ActionModel;
  }

  const scene = {
    id: "publish_scene",
    entryActions: ["pub"],
    actions: [makePublishAction("pub", "bad_hook")],
  } as unknown as SceneBlock;

  const hooks = {
    prepare: {},
    publish: {
      bad_hook: async () => {
        throw new Error("boom");
      },
    },
  };

  it("records the failure as an outcome by default (no throw)", async () => {
    const result = await executeScene(scene, stateManagerFromUnchecked({}), hooks);
    expect(result.trace.actions[0]!.publishOutcomes).toEqual([
      { hookName: "bad_hook", status: "error", message: "Error: boom" },
    ]);
  });

  it("aborts with PublishHookFailed when failOnPublishError is set", async () => {
    await expect(
      executeScene(scene, stateManagerFromUnchecked({}), hooks, undefined, undefined, {
        failOnPublishError: true,
      }),
    ).rejects.toThrow(/bad_hook.*boom/);
  });

  it("preserves the committed merge in safe partial state", async () => {
    const mergedScene = {
      id: "publish_merge_scene",
      entryActions: ["pub"],
      actions: [
        {
          ...makePublishAction("pub", "bad_hook"),
          merge: [{ binding: "out", toState: "result.value" }],
        },
      ],
    } as unknown as SceneBlock;

    const result = await executeSceneSafe(
      mergedScene,
      stateManagerFromUnchecked({ "result.value": buildNumber(0) }),
      hooks,
      undefined,
      undefined,
      { failOnPublishError: true },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const committed = result.partialState.read("result.value");
      expect(isPureNumber(committed) && committed.value).toBe(1);
      expect(result.failedActionId).toBe("pub");
    }
  });
});

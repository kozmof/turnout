import { describe, it, expect } from "vitest";
import { executeRoute, executeRouteSafe } from "../src/executor/route-executor.js";
import { StateManager, stateManagerFromUnchecked } from "../src/state/state-manager.js";
import { isPureNumber } from "runtime";
import type { RouteModel, SceneBlock, ActionModel } from "../src/types/turnout-model_pb.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** A minimal pass-through action: merges a fixed number into STATE. */
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

function makeScene(id: string, ...actions: ActionModel[]): SceneBlock {
  return { id, entryActions: [actions[0].id], actions } as unknown as SceneBlock;
}

function makeSceneMap(...scenes: SceneBlock[]): Record<string, SceneBlock> {
  return Object.fromEntries(scenes.map((s) => [s.id, s]));
}

// ─────────────────────────────────────────────────────────────────────────────
// Single scene — no match arm → completed immediately
// ─────────────────────────────────────────────────────────────────────────────

describe("executeRoute — single scene, no match arm", () => {
  const scene = makeScene("only_scene", makePassAction("step", 7, "out.v"));
  const route = { id: "r1", match: [] } as unknown as RouteModel;

  it('status is "completed"', async () => {
    const result = await executeRoute(
      route,
      makeSceneMap(scene),
      "only_scene",
      stateManagerFromUnchecked({}),
    );
    expect(result.status).toBe("completed");
  });

  it("trace contains one scene entry", async () => {
    const result = await executeRoute(
      route,
      makeSceneMap(scene),
      "only_scene",
      stateManagerFromUnchecked({}),
    );
    expect(result.trace.scenes).toHaveLength(1);
    expect(result.trace.scenes[0].sceneId).toBe("only_scene");
  });

  it("history has one entry per completed action", async () => {
    const result = await executeRoute(
      route,
      makeSceneMap(scene),
      "only_scene",
      stateManagerFromUnchecked({}),
    );
    expect(result.history).toEqual(["only_scene.step"]);
  });

  it("finalState reflects the scene merge", async () => {
    const result = await executeRoute(
      route,
      makeSceneMap(scene),
      "only_scene",
      stateManagerFromUnchecked({}),
    );
    const v = result.finalState["out.v"];
    expect(isPureNumber(v!) && v.value).toBe(7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Two-scene route — specific pattern routes to second scene, then completes
// (non-looping: no arm references scene_2, so route terminates after scene_2)
// ─────────────────────────────────────────────────────────────────────────────

describe("executeRoute — two-scene route (exact pattern)", () => {
  const scene1 = makeScene("scene_1", makePassAction("a1", 1, "s1.val"));
  const scene2 = makeScene("scene_2", makePassAction("a2", 2, "s2.val"));
  // arm only references scene_1 → fires after scene_1, not after scene_2
  const route = {
    id: "r1",
    match: [{ patterns: ["scene_1.a1"], target: "scene_2" }],
  } as unknown as RouteModel;

  it("executes both scenes in order", async () => {
    const result = await executeRoute(
      route,
      makeSceneMap(scene1, scene2),
      "scene_1",
      stateManagerFromUnchecked({}),
    );
    expect(result.trace.scenes.map((s) => s.sceneId)).toEqual(["scene_1", "scene_2"]);
  });

  it("history has entries from both scenes", async () => {
    const result = await executeRoute(
      route,
      makeSceneMap(scene1, scene2),
      "scene_1",
      stateManagerFromUnchecked({}),
    );
    expect(result.history).toEqual(["scene_1.a1", "scene_2.a2"]);
  });

  it("finalState has values from both scenes", async () => {
    const result = await executeRoute(
      route,
      makeSceneMap(scene1, scene2),
      "scene_1",
      stateManagerFromUnchecked({}),
    );
    const s1 = result.finalState["s1.val"];
    const s2 = result.finalState["s2.val"];
    expect(isPureNumber(s1!) && s1.value).toBe(1);
    expect(isPureNumber(s2!) && s2.value).toBe(2);
  });

  it("status is completed after second scene", async () => {
    const result = await executeRoute(
      route,
      makeSceneMap(scene1, scene2),
      "scene_1",
      stateManagerFromUnchecked({}),
    );
    expect(result.status).toBe("completed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Exact pattern doesn't match → route completes after first scene
// ─────────────────────────────────────────────────────────────────────────────

describe("executeRoute — pattern does not match", () => {
  const scene1 = makeScene("scene_1", makePassAction("terminal", 99, "s1.out"));
  const scene2 = makeScene("scene_2", makePassAction("done", 42, "s2.out"));
  const route = {
    id: "r_nomatch",
    match: [{ patterns: ["scene_1.other_action"], target: "scene_2" }],
  } as unknown as RouteModel;

  it("route terminates after scene_1 when pattern does not match", async () => {
    const result = await executeRoute(
      route,
      makeSceneMap(scene1, scene2),
      "scene_1",
      stateManagerFromUnchecked({}),
    );
    expect(result.trace.scenes).toHaveLength(1);
    expect(result.status).toBe("completed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wildcard pattern match
// ─────────────────────────────────────────────────────────────────────────────

describe('executeRoute — wildcard pattern match "scene_1.*.terminal"', () => {
  const intro = makePassAction("intro", 1, "s1.intro");
  const terminal = makePassAction("terminal", 2, "s1.term");
  const scene1 = {
    id: "scene_1",
    entryActions: ["intro"],
    actions: [{ ...intro, next: [{ action: "terminal" }] }, terminal],
  } as unknown as SceneBlock;
  const scene2 = makeScene("scene_2", makePassAction("final", 100, "s2.out"));
  const route = {
    id: "r1",
    match: [{ patterns: ["scene_1.*.terminal"], target: "scene_2" }],
  } as unknown as RouteModel;

  it("routes to scene_2 via wildcard match", async () => {
    const result = await executeRoute(
      route,
      makeSceneMap(scene1, scene2),
      "scene_1",
      stateManagerFromUnchecked({}),
    );
    expect(result.trace.scenes.map((s) => s.sceneId)).toEqual(["scene_1", "scene_2"]);
  });

  it("history contains all actions including those before the terminal", async () => {
    const result = await executeRoute(
      route,
      makeSceneMap(scene1, scene2),
      "scene_1",
      stateManagerFromUnchecked({}),
    );
    expect(result.history).toContain("scene_1.intro");
    expect(result.history).toContain("scene_1.terminal");
    expect(result.history).toContain("scene_2.final");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Three-scene route: two hops via separate arms
// ─────────────────────────────────────────────────────────────────────────────

describe("executeRoute — three-scene chain", () => {
  const scene1 = makeScene("s1", makePassAction("a", 10, "v.a"));
  const scene2 = makeScene("s2", makePassAction("b", 20, "v.b"));
  const scene3 = makeScene("s3", makePassAction("c", 30, "v.c"));
  const route = {
    id: "chain",
    match: [
      { patterns: ["s1.a"], target: "s2" },
      { patterns: ["s2.b"], target: "s3" },
      // no arm for s3 → route completes
    ],
  } as unknown as RouteModel;

  it("executes all three scenes", async () => {
    const result = await executeRoute(
      route,
      makeSceneMap(scene1, scene2, scene3),
      "s1",
      stateManagerFromUnchecked({}),
    );
    expect(result.trace.scenes.map((s) => s.sceneId)).toEqual(["s1", "s2", "s3"]);
  });

  it("finalState has values from all three scenes", async () => {
    const result = await executeRoute(
      route,
      makeSceneMap(scene1, scene2, scene3),
      "s1",
      stateManagerFromUnchecked({}),
    );
    expect(isPureNumber(result.finalState["v.a"]!) && result.finalState["v.a"].value).toBe(10);
    expect(isPureNumber(result.finalState["v.b"]!) && result.finalState["v.b"].value).toBe(20);
    expect(isPureNumber(result.finalState["v.c"]!) && result.finalState["v.c"].value).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STATE propagation across scenes
// ─────────────────────────────────────────────────────────────────────────────

describe("executeRoute — STATE propagates from scene_1 to scene_2", () => {
  const writeAction = makePassAction("write", 55, "shared.val");
  const scene1 = {
    id: "scene_1",
    entryActions: ["write"],
    actions: [writeAction],
  } as unknown as SceneBlock;

  /** scene_2 reads shared.val via from_state prepare and doubles it. */
  const readAction = {
    id: "read_double",
    prepare: [{ binding: "v", fromState: "shared.val" }],
    compute: {
      root: "doubled",
      prog: {
        name: "double_prog",
        bindings: [
          { name: "v", type: "number", value: 0 },
          {
            name: "doubled",
            type: "number",
            expr: { combine: { fn: "add", args: [{ ref: "v" }, { ref: "v" }] } },
          },
        ],
      },
    },
    merge: [{ binding: "doubled", toState: "shared.doubled" }],
  } as unknown as ActionModel;
  const scene2 = {
    id: "scene_2",
    entryActions: ["read_double"],
    actions: [readAction],
  } as unknown as SceneBlock;

  const route = {
    id: "r1",
    match: [{ patterns: ["scene_1.write"], target: "scene_2" }],
  } as unknown as RouteModel;

  it("scene_2 reads STATE written by scene_1 and produces correct output", async () => {
    const result = await executeRoute(
      route,
      makeSceneMap(scene1, scene2),
      "scene_1",
      stateManagerFromUnchecked({}),
    );
    // 55 written by scene_1, doubled by scene_2 → 110
    const doubled = result.finalState["shared.doubled"];
    expect(isPureNumber(doubled!) && doubled.value).toBe(110);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OR pattern — multiple paths into the same target
// ─────────────────────────────────────────────────────────────────────────────

describe("executeRoute — OR pattern in a single arm", () => {
  const scene1 = makeScene("s1", makePassAction("done", 1, "s1.v"));
  const scene2 = makeScene("alt", makePassAction("done", 2, "alt.v"));
  const sceneEnd = makeScene("s_end", makePassAction("finish", 99, "end.v"));
  // Both scene paths lead to the same target via OR
  const route = {
    id: "r_or",
    match: [{ patterns: ["s1.done", "alt.done"], target: "s_end" }],
  } as unknown as RouteModel;

  it('OR pattern fires when s1 exits with "done"', async () => {
    const result = await executeRoute(
      route,
      makeSceneMap(scene1, sceneEnd),
      "s1",
      stateManagerFromUnchecked({}),
    );
    expect(result.trace.scenes.map((s) => s.sceneId)).toEqual(["s1", "s_end"]);
  });

  it('OR pattern fires when alt exits with "done"', async () => {
    const result = await executeRoute(
      route,
      makeSceneMap(scene2, sceneEnd),
      "alt",
      stateManagerFromUnchecked({}),
    );
    expect(result.trace.scenes.map((s) => s.sceneId)).toEqual(["alt", "s_end"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Result metadata
// ─────────────────────────────────────────────────────────────────────────────

describe("executeRoute — result metadata", () => {
  const scene = makeScene("s1", makePassAction("a", 1, "x"));
  const route = { id: "my_route", match: [] } as unknown as RouteModel;

  it("result.routeId matches the route id", async () => {
    const result = await executeRoute(
      route,
      makeSceneMap(scene),
      "s1",
      stateManagerFromUnchecked({}),
    );
    expect(result.routeId).toBe("my_route");
  });

  it("result.trace.routeId matches the route id", async () => {
    const result = await executeRoute(
      route,
      makeSceneMap(scene),
      "s1",
      stateManagerFromUnchecked({}),
    );
    expect(result.trace.routeId).toBe("my_route");
  });
});

describe("executeRoute — execution limits", () => {
  const first = {
    ...makePassAction("first", 1, "step.first"),
    next: [{ action: "second" }],
  } as unknown as ActionModel;
  const second = makePassAction("second", 2, "step.second");
  const longScene = {
    id: "long_scene",
    entryActions: ["first"],
    actions: [first, second],
  } as unknown as SceneBlock;

  it("passes maxSceneSteps through to scene execution", async () => {
    const route = { id: "limited", match: [] } as unknown as RouteModel;
    await expect(() =>
      executeRoute(
        route,
        makeSceneMap(longScene),
        "long_scene",
        stateManagerFromUnchecked({}),
        { prepare: {}, publish: {} },
        { maxSceneSteps: 1 },
      ),
    ).rejects.toThrow("exceeded 1 action steps");
  });

  it("stops routes that exceed maxRouteTransitions", async () => {
    const s1 = makeScene("s1", makePassAction("a", 1, "v.a"));
    const s2 = makeScene("s2", makePassAction("b", 2, "v.b"));
    const route = {
      id: "loop",
      match: [
        { patterns: ["s1.a"], target: "s2" },
        { patterns: ["s2.b"], target: "s1" },
      ],
    } as unknown as RouteModel;

    await expect(() =>
      executeRoute(
        route,
        makeSceneMap(s1, s2),
        "s1",
        stateManagerFromUnchecked({}),
        { prepare: {}, publish: {} },
        { maxRouteTransitions: 0 },
      ),
    ).rejects.toThrow("exceeded 0 scene transitions");
  });
});

describe("executeRoute — route-driven entry warnings", () => {
  it("warns and fires only the first entry action when a scene declares multiple entries", async () => {
    const first = makePassAction("first", 1, "entry.first");
    const second = makePassAction("second", 2, "entry.second");
    const scene = {
      id: "multi_entry",
      entryActions: ["first", "second"],
      actions: [first, second],
    } as unknown as SceneBlock;
    const route = { id: "r_multi", match: [] } as unknown as RouteModel;

    const result = await executeRoute(
      route,
      makeSceneMap(scene),
      "multi_entry",
      stateManagerFromUnchecked({}),
    );

    expect(result.history).toEqual(["multi_entry.first"]);
    expect(result.warnings).toEqual([
      { kind: "multi_entry_action", sceneId: "multi_entry", entryActions: ["first", "second"] },
    ]);
    expect(result.finalState["entry.second"]).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// executeRouteSafe — safe wrapper (success and error paths)
// ─────────────────────────────────────────────────────────────────────────────

describe("executeRouteSafe — success path", () => {
  const scene = makeScene("s1", makePassAction("a", 5, "v.a"));
  const route = { id: "safe_route", match: [] } as unknown as RouteModel;

  it("returns ok:true with a valid result on success", async () => {
    const result = await executeRouteSafe(
      route,
      makeSceneMap(scene),
      "s1",
      stateManagerFromUnchecked({}),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.routeId).toBe("safe_route");
      expect(result.value.status).toBe("completed");
    }
  });
});

describe("executeRouteSafe — error path (unknown scene)", () => {
  const scene1 = makeScene("s1", makePassAction("a", 1, "v.a"));
  // route references s2 which is not in the scene map
  const route = {
    id: "err_route",
    match: [{ patterns: ["s1.a"], target: "s2" }],
  } as unknown as RouteModel;

  it("returns ok:false with the partial state and failed scene id", async () => {
    const result = await executeRouteSafe(
      route,
      makeSceneMap(scene1),
      "s1",
      stateManagerFromUnchecked({}),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failedSceneId).toBe("s2");
      expect(result.error).toBeTruthy();
    }
  });

  it("partial state reflects state after successfully completed scenes", async () => {
    const result = await executeRouteSafe(
      route,
      makeSceneMap(scene1),
      "s1",
      stateManagerFromUnchecked({}),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // s1 completed successfully before s2 failed — its state should be present
      const vA = result.partialState["v.a"];
      expect(vA).toBeDefined();
    }
  });
});

describe("executeRouteSafe — scene with no entry actions", () => {
  const emptyScene = {
    id: "empty",
    entryActions: [],
    actions: [],
  } as unknown as SceneBlock;
  const route = { id: "r_empty", match: [] } as unknown as RouteModel;

  it("returns ok:false with NoEntryAction error", async () => {
    const result = await executeRouteSafe(
      route,
      makeSceneMap(emptyScene),
      "empty",
      stateManagerFromUnchecked({}),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(String(result.error)).toContain("no entry actions");
    }
  });
});

describe("executeRouteSafe — scene warnings propagated as route warnings", () => {
  // Produce a duplicate_enqueue scene warning by having an all-match action
  // whose next-rule list contains the same target twice.
  const actionWithDupeNext = {
    id: "start",
    compute: {
      root: "out",
      prog: { name: "p", bindings: [{ name: "out", type: "number", value: 1 }] },
    },
    next: [{ action: "end" }, { action: "end" }],
  } as unknown as ActionModel;
  const scene = {
    id: "warn_scene",
    entryActions: ["start"],
    nextPolicy: "all-match",
    actions: [actionWithDupeNext, makePassAction("end", 2, "v.end")],
  } as unknown as SceneBlock;
  const route = { id: "r_warn", match: [] } as unknown as RouteModel;

  it("propagates scene-level warnings as route warnings with kind scene_warning", async () => {
    const result = await executeRouteSafe(
      route,
      makeSceneMap(scene),
      "warn_scene",
      stateManagerFromUnchecked({}),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.warnings).toBeDefined();
      expect(result.value.warnings?.some((w) => w.kind === "scene_warning")).toBe(true);
    }
  });
});

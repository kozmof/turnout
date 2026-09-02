import { describe, it, expect } from "vitest";
import { createSceneRunner, createRouteRunner } from "../src/runner.js";
import type { RouteModel, SceneBlock, ActionModel } from "../src/types/turnout-model_pb.js";
import type { ExecutionWarning } from "../src/types/harness-types.js";

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
    merge: [{ binding: "v", toState }],
  } as unknown as ActionModel;
}

/**
 * A scene whose second action points back at the entry action, which has
 * already run — the graph that raises a `duplicate_enqueue` scene warning.
 */
function makeWarningScene(id: string): SceneBlock {
  return {
    id,
    entryAction: "start",
    actions: [
      {
        ...makePassAction("start", 1, `${id}.start`),
        next: [{ action: "again" }],
      },
      {
        ...makePassAction("again", 2, `${id}.again`),
        next: [{ action: "start" }],
      },
    ],
  } as unknown as SceneBlock;
}

function expectedWarning(sceneId: string): ExecutionWarning {
  return {
    kind: "scene_warning",
    sceneId,
    warning: {
      kind: "duplicate_enqueue",
      actionId: "start",
      firstEnqueuedBy: "<entry>",
      message:
        'action "start" was enqueued by "again" but already ran (first enqueued by "<entry>"); next rule points to an already-executed action',
    },
  };
}

// `entryId` is required by ExecutionOptions but unused by the fragment
// factories, which are handed their entry scene or route directly.
const runnerOptions = {
  entryId: "unused",
  initialState: {},
  allowUncheckedState: true,
  onWarning: () => {},
};

// ─────────────────────────────────────────────────────────────────────────────
// Parity across every driver
// ─────────────────────────────────────────────────────────────────────────────

describe("execution warnings — driver parity", () => {
  it("createRouteRunner surfaces warnings on its harness result", async () => {
    const scene = makeWarningScene("s1");
    const route = { id: "r", match: [] } as unknown as RouteModel;

    const result = await createRouteRunner(route, scene, { s1: scene }, runnerOptions).run();

    expect(result.warnings).toEqual([expectedWarning("s1")]);
  });

  it("createSceneRunner surfaces warnings on its harness result", async () => {
    const result = await createSceneRunner(makeWarningScene("solo"), runnerOptions).run();

    expect(result.warnings).toEqual([expectedWarning("solo")]);
  });
});

describe("execution warnings — shape", () => {
  it("omits the field entirely when a run produces no warnings", async () => {
    const scene = {
      id: "quiet",
      entryAction: "only",
      actions: [makePassAction("only", 1, "quiet.only")],
    } as unknown as SceneBlock;

    const result = await createSceneRunner(scene, runnerOptions).run();

    expect(result.warnings).toBeUndefined();
    expect("warnings" in result).toBe(false);
  });

  it("tags each warning with the scene that raised it, in completion order", async () => {
    const s1 = makeWarningScene("s1");
    const s2 = makeWarningScene("s2");
    const route = {
      id: "r",
      match: [{ patterns: ["s1.*.again"], target: "s2" }],
    } as unknown as RouteModel;

    const result = await createRouteRunner(route, s1, { s1, s2 }, runnerOptions).run();

    expect(result.warnings).toEqual([expectedWarning("s1"), expectedWarning("s2")]);
  });

  it("keeps warnings readable per scene on the trace as well", async () => {
    const scene = makeWarningScene("s1");
    const route = { id: "r", match: [] } as unknown as RouteModel;

    const result = await createRouteRunner(route, scene, { s1: scene }, runnerOptions).run();

    expect(result.trace.kind).toBe("route");
    if (result.trace.kind !== "route") return;
    expect(result.trace.route.scenes[0]?.warnings).toEqual([expectedWarning("s1").warning]);
  });
});

import { describe, expect, it } from "vitest";
import { buildNumber, isPureNumber } from "runtime";
import { executeRouteSafe, executeSceneSafe } from "../src/index.js";
import { SceneRuntimeError } from "../src/errors.js";
import { stateManagerFromUnchecked } from "../src/state/state-manager.js";
import type { ActionModel, RouteModel, SceneBlock } from "../src/types/turnout-model_pb.js";

function action(id: string, value: number, toState: string, next: string[] = []): ActionModel {
  return {
    id,
    compute: {
      root: "out",
      prog: { name: `${id}_prog`, bindings: [{ name: "out", type: "number", value }] },
    },
    merge: [{ binding: "out", toState }],
    next: next.map((target) => ({ action: target })),
  } as unknown as ActionModel;
}

function scene(id: string, actions: ActionModel[], entryAction = actions[0]?.id ?? ""): SceneBlock {
  return { id, entryAction, actions } as unknown as SceneBlock;
}

describe("executeSceneSafe", () => {
  it("returns the legacy result shape from Zig execution", async () => {
    const result = await executeSceneSafe(
      scene("main", [action("first", 7, "result.value")]),
      stateManagerFromUnchecked({}),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sceneId).toBe("main");
    expect(result.value.terminatedAt).toEqual(["first"]);
    expect(result.value.trace.actions.map((entry) => entry.actionId)).toEqual(["first"]);
    const value = result.value.stateAfterScene.read("result.value");
    expect(isPureNumber(value) && value.value).toBe(7);
  });

  it("preserves partial state and the pending action on failure", async () => {
    const failing = {
      id: "second",
      compute: {
        root: "out",
        prog: {
          name: "failing",
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
    } as unknown as ActionModel;
    const result = await executeSceneSafe(
      scene("main", [action("first", 1, "result.first", ["second"]), failing]),
      stateManagerFromUnchecked({}),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failedActionId).toBe("second");
    expect((result.error as { code?: string }).code).toBe("UnknownFunction");
    expect(result.partialState.read("result.first")).toEqual(buildNumber(1));
  });

  it("returns a structured construction error for a missing entry action", async () => {
    const result = await executeSceneSafe(scene("main", [], ""), stateManagerFromUnchecked({}));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(SceneRuntimeError);
    expect((result.error as SceneRuntimeError).code).toBe("NoEntryAction");
    expect(result.failedActionId).toBe("<none>");
  });

  it("returns a structured construction error for duplicate actions", async () => {
    const result = await executeSceneSafe(
      scene("main", [action("same", 1, "one"), action("same", 2, "two")]),
      stateManagerFromUnchecked({}),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(SceneRuntimeError);
    expect((result.error as SceneRuntimeError).code).toBe("DuplicateActionId");
    expect(result.failedActionId).toBe("same");
  });

  it("keeps legacy logs free of runner lifecycle events", async () => {
    const events: string[] = [];
    const result = await executeSceneSafe(
      scene("main", [action("only", 1, "result.value")]),
      stateManagerFromUnchecked({}),
      undefined,
      undefined,
      { onLog: (event) => events.push(event.kind) },
    );

    expect(result.ok).toBe(true);
    expect(events).toEqual(["action-start", "warning", "action-complete"]);
  });
});

describe("executeRouteSafe", () => {
  it("returns route history and final state from Zig execution", async () => {
    const first = scene("first", [action("done", 1, "route.first")]);
    const second = scene("second", [action("done", 2, "route.second")]);
    const route = {
      id: "route",
      match: [{ patterns: ["first.done"], target: "second" }],
    } as unknown as RouteModel;
    const events: string[] = [];
    const result = await executeRouteSafe(
      route,
      { first, second },
      "first",
      stateManagerFromUnchecked({}),
      undefined,
      { onLog: (event) => events.push(event.kind) },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("completed");
    expect(result.value.history).toEqual(["first.done", "second.done"]);
    expect(result.value.finalState["route.second"]).toEqual(buildNumber(2));
    expect(events).toEqual([
      "action-start",
      "warning",
      "action-complete",
      "action-start",
      "warning",
      "action-complete",
    ]);
  });

  it("reports a missing initial scene", async () => {
    const result = await executeRouteSafe(
      { id: "route", match: [] } as unknown as RouteModel,
      {},
      "missing",
      stateManagerFromUnchecked({}),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(String(result.error)).toContain(`unknown scene "missing"`);
    expect(result.failedSceneId).toBe("missing");
  });

  it("reports an initial scene with no entry action", async () => {
    const empty = scene("empty", [], "");
    const result = await executeRouteSafe(
      { id: "route", match: [] } as unknown as RouteModel,
      { empty },
      "empty",
      stateManagerFromUnchecked({}),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(String(result.error)).toContain(`scene "empty" has no entry action`);
    expect(result.failedSceneId).toBe("empty");
  });

  it("reports the missing target scene and last committed state", async () => {
    const first = scene("first", [action("done", 1, "route.first")]);
    const route = {
      id: "route",
      match: [{ patterns: ["first.done"], target: "missing" }],
    } as unknown as RouteModel;
    const result = await executeRouteSafe(route, { first }, "first", stateManagerFromUnchecked({}));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failedSceneId).toBe("missing");
    expect(result.partialState["route.first"]).toEqual(buildNumber(1));
  });

  it("preserves a strict publish failure merge", async () => {
    const publish = action("publish", 9, "route.value");
    publish.publish = ["fail"];
    const only = scene("only", [publish]);
    const result = await executeRouteSafe(
      { id: "route", match: [] } as unknown as RouteModel,
      { only },
      "only",
      stateManagerFromUnchecked({}),
      {
        prepare: {},
        publish: {
          fail: () => {
            throw new Error("boom");
          },
        },
      },
      { failOnPublishError: true },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failedSceneId).toBe("only");
    expect(result.partialState["route.value"]).toEqual(buildNumber(9));
  });

  it("captures an already-aborted run", async () => {
    const controller = new AbortController();
    controller.abort();
    const only = scene("only", [action("done", 1, "route.value")]);
    const result = await executeRouteSafe(
      { id: "route", match: [] } as unknown as RouteModel,
      { only },
      "only",
      stateManagerFromUnchecked({}),
      undefined,
      { signal: controller.signal },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect((result.error as { name?: string }).name).toBe("AbortError");
    expect(result.partialState).toEqual({});
  });
});

import { describe, it, expect } from "vitest";
import { collectPublishFailures } from "../src/trace-utils.js";
import type { ExecutionTrace } from "../src/types/harness-types.js";
import { buildNull } from "runtime";

describe("collectPublishFailures", () => {
  it("returns failed publishes from a scene trace, located by scene + action", () => {
    const trace: ExecutionTrace = {
      kind: "scene",
      scene: {
        sceneId: "s1",
        actions: [
          {
            actionId: "a1",
            computeRootValue: buildNull("missing"),
            nextActionIds: [],
            publishOutcomes: [
              { hookName: "ok_hook", status: "ok" },
              { hookName: "bad_hook", status: "error", message: "boom" },
            ],
          },
          {
            actionId: "a2",
            computeRootValue: buildNull("missing"),
            nextActionIds: [],
          },
        ],
      },
    };

    expect(collectPublishFailures(trace)).toEqual([
      { sceneId: "s1", actionId: "a1", hookName: "bad_hook", message: "boom" },
    ]);
  });

  it("accepts a result object carrying a trace and walks route scenes", () => {
    const trace: ExecutionTrace = {
      kind: "route",
      route: {
        routeId: "r1",
        scenes: [
          {
            sceneId: "s1",
            actions: [
              {
                actionId: "a1",
                computeRootValue: buildNull("missing"),
                nextActionIds: [],
                publishOutcomes: [{ hookName: "h", status: "error", message: "x" }],
              },
            ],
          },
          {
            sceneId: "s2",
            actions: [
              {
                actionId: "a2",
                computeRootValue: buildNull("missing"),
                nextActionIds: [],
                publishOutcomes: [{ hookName: "h2", status: "error", message: "y" }],
              },
            ],
          },
        ],
      },
    };

    expect(collectPublishFailures({ trace })).toEqual([
      { sceneId: "s1", actionId: "a1", hookName: "h", message: "x" },
      { sceneId: "s2", actionId: "a2", hookName: "h2", message: "y" },
    ]);
  });

  it("returns an empty array when there are no failures", () => {
    const trace: ExecutionTrace = {
      kind: "scene",
      scene: { sceneId: "s1", actions: [] },
    };
    expect(collectPublishFailures(trace)).toEqual([]);
  });
});

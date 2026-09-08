import { describe, expect, it } from "vitest";
import { createRunner } from "../src/runner.js";
import { RouteRuntimeError } from "../src/errors.js";
import type { TurnModel } from "../src/types/turnout-model_pb.js";

/**
 * A route completes when no arm matches or when the selected arm targets `.`.
 * These tests also pin the transition limit for a catchall that targets a scene.
 *
 * See `spec/scene-to-scene.md` §3.2 and §5, and `todo/route-completion.md`.
 */

function routeModel(arms: { patterns: string[]; target: string }[]): TurnModel {
  return {
    version: 2,
    scenes: [
      { id: "work", entryAction: "a", actions: [{ id: "a" }] },
      { id: "closed", entryAction: "b", actions: [{ id: "b" }] },
    ],
    routes: [{ id: "r", entrySceneId: "work", match: arms }],
  } as unknown as TurnModel;
}

const options = {
  entryId: "r",
  initialState: {},
  allowUncheckedState: true,
  maxRouteTransitions: 5,
} as const;

describe("route completion", () => {
  it("completes when the final scene is left unmatched", async () => {
    const result = await createRunner(
      routeModel([{ patterns: ["work.a"], target: "closed" }]),
      options,
    ).run();

    expect(result.trace.kind).toBe("route");
    // Nothing matches `closed`, so the route ends there.
    expect(
      result.trace.kind === "route" && result.trace.route.scenes.map((s) => s.sceneId),
    ).toEqual(["work", "closed"]);
  });

  it("does not complete when a catchall targets a scene", async () => {
    // `_` always matches, so this form re-enters `closed` until it reaches
    // the transition limit.
    await expect(
      createRunner(
        routeModel([
          { patterns: ["work.a"], target: "closed" },
          { patterns: ["_"], target: "closed" },
        ]),
        options,
      ).run(),
    ).rejects.toThrow(RouteRuntimeError);
  });

  it("completes when a catchall targets the explicit terminal", async () => {
    const result = await createRunner(
      routeModel([
        { patterns: ["work.a"], target: "closed" },
        { patterns: ["_"], target: "." },
      ]),
      options,
    ).run();

    expect(result.trace.kind).toBe("route");
    expect(
      result.trace.kind === "route" && result.trace.route.scenes.map((scene) => scene.sceneId),
    ).toEqual(["work", "closed"]);
  });

  it("reports the transition cap rather than completing", async () => {
    await expect(
      createRunner(
        routeModel([
          { patterns: ["work.a"], target: "closed" },
          { patterns: ["_"], target: "closed" },
        ]),
        options,
      ).run(),
    ).rejects.toThrow(/exceeded 5 scene transitions/);
  });
});

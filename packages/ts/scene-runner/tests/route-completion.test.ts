import { describe, expect, it } from "vitest";
import { createRunner } from "../src/runner.js";
import { RouteRuntimeError } from "../src/errors.js";
import type { TurnModel } from "../src/types/turnout-model_pb.js";

/**
 * Route completion is expressed by absence: a route ends when no match arm
 * matches. These tests pin both sides of that, including the consequence that
 * is easy to write by accident.
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

  it("cannot complete once a catchall arm is declared", async () => {
    // `_` always matches, so the route re-enters `closed` forever and can only
    // exit by exhausting its transition budget. This is the documented
    // consequence of completion having no spelling of its own; a route meant to
    // end must leave its final scene unmatched instead.
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

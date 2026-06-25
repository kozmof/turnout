import { describe, it, expect } from "vitest";
import { resolveDispatchTarget } from "../src/executor/dispatch.js";
import type { TurnModel, RouteModel, SceneBlock } from "../src/types/turnout-model_pb.js";

// resolveDispatchTarget only reads ids, routes, scenes, and entrySceneId, so the
// model is assembled from minimal shapes cast to the generated proto types.
function makeModel(scenes: Partial<SceneBlock>[], routes: Partial<RouteModel>[]): TurnModel {
  return { scenes, routes } as unknown as TurnModel;
}

describe("resolveDispatchTarget", () => {
  it("resolves a scene entry directly", () => {
    const model = makeModel([{ id: "scene1" }], []);
    const target = resolveDispatchTarget(model, "scene1");
    expect(target.kind).toBe("scene");
    if (target.kind === "scene") expect(target.scene.id).toBe("scene1");
  });

  it("resolves a route to its entry scene", () => {
    const model = makeModel([{ id: "home" }], [{ id: "r1", entrySceneId: "home" }]);
    const target = resolveDispatchTarget(model, "r1");
    expect(target.kind).toBe("route");
    if (target.kind === "route") {
      expect(target.route.id).toBe("r1");
      expect(target.entryScene.id).toBe("home");
    }
  });

  it("throws when a route declares no entry scene", () => {
    const model = makeModel([{ id: "home" }], [{ id: "r1" }]);
    expect(() => resolveDispatchTarget(model, "r1")).toThrow(/has no entry scene declared/);
  });

  it("throws when a route's entry scene is not in the model", () => {
    const model = makeModel([{ id: "home" }], [{ id: "r1", entrySceneId: "ghost" }]);
    expect(() => resolveDispatchTarget(model, "r1")).toThrow(
      /entry scene "ghost" is not in the model/,
    );
  });

  it("throws when the entry id matches neither route nor scene", () => {
    const model = makeModel([{ id: "home" }], []);
    expect(() => resolveDispatchTarget(model, "nope")).toThrow(/not found as route or scene/);
  });

  it("tolerates a model with no routes field", () => {
    const model = { scenes: [{ id: "only" }] } as unknown as TurnModel;
    expect(resolveDispatchTarget(model, "only").kind).toBe("scene");
  });

  it("reflects edits when a mutable model object is reused", () => {
    const model = makeModel([{ id: "before" }], []);
    expect(resolveDispatchTarget(model, "before").kind).toBe("scene");

    model.scenes = [{ id: "after" }] as SceneBlock[];

    expect(resolveDispatchTarget(model, "after").kind).toBe("scene");
    expect(() => resolveDispatchTarget(model, "before")).toThrow(/not found as route or scene/);
  });
});

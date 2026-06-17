import { describe, expect, it } from "vitest";
import { migrateModel } from "../src/migration.js";
import type { TurnModel, SceneBlock } from "../src/types/turnout-model_pb.js";
import { createSceneRunner } from "../src/runner.js";
import { stateManagerFromUnchecked } from "../src/state/state-manager.js";

describe("migrateModel", () => {
  it("treats missing version as version 0 and migrates to current", () => {
    const model = {} as TurnModel;

    expect(migrateModel(model)).toBe(model);
  });

  it("returns current-version models unchanged", () => {
    const model = { version: 1 } as TurnModel;

    expect(migrateModel(model)).toBe(model);
  });

  it("rejects models requiring a newer runtime", () => {
    const model = { version: 1, minVersion: 2 } as TurnModel;

    expect(() => migrateModel(model)).toThrow(`below the model's required minimum version 2`);
  });

  it("rejects models above the maximum compatible runtime", () => {
    const model = { version: 1, maxVersion: 0.5 } as TurnModel;

    expect(() => migrateModel(model)).toThrow(`exceeds the model's maximum compatible version 0.5`);
  });

  it("rejects future schema versions", () => {
    const model = { version: 2 } as TurnModel;

    expect(() => migrateModel(model)).toThrow("Model schema version 2 is not supported");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// checkForExtExpr — detected via migrateModel and createSceneRunner
// ─────────────────────────────────────────────────────────────────────────────

describe("checkForExtExpr", () => {
  function makeSceneWithExtExpr(inNextRule = false): SceneBlock {
    const extExprBinding = { name: "x", type: "number", extExpr: {} };
    const prog = { name: "p", bindings: [extExprBinding] };
    const action = inNextRule
      ? {
          id: "act",
          compute: {
            root: "y",
            prog: { name: "main", bindings: [{ name: "y", type: "number", value: 1 }] },
          },
          next: [{ compute: { condition: "x", prog }, action: "other" }],
        }
      : { id: "act", compute: { root: "x", prog } };
    return {
      id: "test_scene",
      entryActions: ["act"],
      actions: [action],
    } as unknown as SceneBlock;
  }

  it("migrateModel throws when an action compute binding has extExpr", () => {
    const model: TurnModel = {
      version: 1,
      scenes: [makeSceneWithExtExpr(false)],
      routes: [],
    } as unknown as TurnModel;
    expect(() => migrateModel(model)).toThrow("extExpr");
  });

  it("migrateModel throws when a next-rule compute binding has extExpr", () => {
    const model: TurnModel = {
      version: 1,
      scenes: [makeSceneWithExtExpr(true)],
      routes: [],
    } as unknown as TurnModel;
    expect(() => migrateModel(model)).toThrow("extExpr");
  });

  it("migrateModel does not throw for a model with no extExpr bindings", () => {
    const model: TurnModel = {
      version: 1,
      scenes: [
        {
          id: "clean_scene",
          entryActions: ["a"],
          actions: [
            {
              id: "a",
              compute: {
                root: "v",
                prog: { name: "p", bindings: [{ name: "v", type: "number", value: 42 }] },
              },
            },
          ],
        },
      ],
      routes: [],
    } as unknown as TurnModel;
    expect(() => migrateModel(model)).not.toThrow();
  });

  it("createSceneRunner throws synchronously before execution when a scene has extExpr", () => {
    const scene = makeSceneWithExtExpr(false);
    // Verify the error is thrown at construction time, not during next() / run().
    expect(() =>
      createSceneRunner(
        scene,
        { entryId: "", initialState: {}, allowUncheckedState: true },
        stateManagerFromUnchecked({}),
      ),
    ).toThrow("extExpr");
  });

  it("createSceneRunner throws for extExpr in a next-rule prog", () => {
    const scene = makeSceneWithExtExpr(true);
    expect(() =>
      createSceneRunner(
        scene,
        { entryId: "", initialState: {}, allowUncheckedState: true },
        stateManagerFromUnchecked({}),
      ),
    ).toThrow("extExpr");
  });
});

import { describe, it, expect } from "vitest";
import { fromJson } from "@bufbuild/protobuf";
import { buildNumber } from "runtime";
import { TurnModelSchema, SceneBlockSchema } from "../src/types/turnout-model_pb.js";
import { createRunner, createSceneRunner, createRouteRunner } from "../src/runner.js";
import { protoJson } from "../src/model-encoding.js";
import { executeSceneSafe } from "../src/scene-safe.js";
import { stateManagerFromUnchecked } from "../src/state/state-manager.js";

/**
 * The fragment factories take a `SceneBlock`, and the shape that type really
 * names is a decoded protobuf message — the thing `fromJson` produces. Inside
 * one, a literal is a `google.protobuf.Value` wrapper rather than the number it
 * holds, so a fragment that reaches the runtime through `JSON.stringify` merges
 * a record into STATE instead of the value, and does it without failing.
 *
 * Every other test in this suite hands these factories hand-built JSON, where
 * a literal is already a literal and the bug cannot appear. These decode first.
 */
const modelJson = {
  version: 2,
  state: {
    namespaces: [{ name: "out", fields: [{ name: "n", type: "number", value: 0 }] }],
  },
  scenes: [
    {
      id: "s",
      entryAction: "a",
      actions: [
        {
          id: "a",
          compute: {
            root: "v",
            prog: { name: "p", bindings: [{ name: "v", type: "number", value: 7 }] },
          },
          merge: [{ binding: "v", toState: "out.n" }],
        },
      ],
    },
  ],
  routes: [{ id: "r", entrySceneId: "s", match: [] }],
};

function decode() {
  const model = fromJson(TurnModelSchema, modelJson as never, { ignoreUnknownFields: true });
  return { model, scene: model.scenes[0]!, route: model.routes[0]! };
}

const runnerOptions = { entryId: "s", initialState: {}, allowUncheckedState: true } as const;

describe("decoded protobuf fragments", () => {
  it("createSceneRunner preserves a literal binding value", async () => {
    const { scene } = decode();
    const result = await createSceneRunner(scene, runnerOptions).run();
    expect(result.finalState["out.n"]).toEqual(buildNumber(7));
    expect(
      result.trace.kind === "scene" && result.trace.scene.actions[0]!.computeRootValue,
    ).toEqual(buildNumber(7));
  });

  it("createRouteRunner preserves a literal binding value", async () => {
    const { scene, route } = decode();
    const result = await createRouteRunner(
      route,
      scene,
      { s: scene },
      {
        ...runnerOptions,
        entryId: "r",
      },
    ).run();
    expect(result.finalState["out.n"]).toEqual(buildNumber(7));
  });

  it("executeSceneSafe preserves a literal binding value", async () => {
    const { scene } = decode();
    const result = await executeSceneSafe(scene, stateManagerFromUnchecked({}));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.trace.actions[0]!.computeRootValue).toEqual(buildNumber(7));
    expect(result.value.stateAfterScene.snapshot()["out.n"]).toEqual(buildNumber(7));
  });

  it("agrees with the full-model path", async () => {
    const { model } = decode();
    const viaModel = await createRunner(model, runnerOptions).run();
    const { scene } = decode();
    const viaFragment = await createSceneRunner(scene, runnerOptions).run();
    expect(viaFragment.finalState).toEqual(viaModel.finalState);
  });
});

describe("protoJson", () => {
  it("unwraps a decoded message", () => {
    const { scene } = decode();
    const json = protoJson(SceneBlockSchema, scene) as Record<string, never>;
    expect(JSON.stringify(json)).toContain('"value":7');
    expect(JSON.stringify(json)).not.toContain("$typeName");
  });

  it("passes plain JSON through untouched", () => {
    const plain = { id: "s", entryAction: "a", actions: [] };
    expect(protoJson(SceneBlockSchema, plain)).toBe(plain);
  });

  it("refuses a message of another type rather than guessing", () => {
    const { model } = decode();
    expect(() => protoJson(SceneBlockSchema, model)).toThrow(/got a turnout\.model\.v1\.TurnModel/);
  });
});

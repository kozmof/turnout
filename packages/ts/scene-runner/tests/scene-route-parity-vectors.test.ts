import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { executeRoute } from "../src/executor/route-executor.js";
import { stateManagerFromUnchecked } from "../src/state/state-manager.js";
import type { RouteModel, SceneBlock } from "../src/types/turnout-model_pb.js";

type Vector = {
  name: string;
  routeId: string;
  model: string;
  output: {
    state: Array<{ path: string; value: unknown }>;
    history: string[];
  };
};

const vectors = JSON.parse(
  readFileSync(resolve(__dirname, "../../../zig/src/fixtures/scene-route-vectors.json"), "utf8"),
) as Vector[];

describe("shared scene and route vectors", () => {
  for (const vector of vectors) {
    it(vector.name, async () => {
      const model = JSON.parse(vector.model) as {
        routes: Array<RouteModel & { entrySceneId: string }>;
        scenes: SceneBlock[];
      };
      const route = model.routes.find((candidate) => candidate.id === vector.routeId);
      expect(route).toBeDefined();
      const scenes = Object.fromEntries(model.scenes.map((scene) => [scene.id, scene]));
      const result = await executeRoute(
        route!,
        scenes,
        route!.entrySceneId,
        stateManagerFromUnchecked({}),
      );
      expect(result.history).toEqual(vector.output.history);
      for (const expected of vector.output.state)
        expect(result.finalState[expected.path]?.value).toEqual(expected.value);
    });
  }
});

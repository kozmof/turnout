import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { executeRoute } from "../src/executor/route-executor.js";
import { stateManagerFromUnchecked } from "../src/state/state-manager.js";
import type { RouteModel, SceneBlock } from "../src/types/turnout-model_pb.js";
import type { LogEvent } from "../src/types/harness-types.js";

type Vector = {
  name: string;
  routeId: string;
  model: string;
  output: {
    state: Array<{ path: string; value: unknown }>;
    history: string[];
    logs: Array<{
      kind: "action-start" | "warning" | "action-complete";
      sceneId: string;
      actionId: string;
      stepIndex?: number;
    }>;
    traces: Array<{
      sceneId: string;
      actionId: string;
      root: unknown;
      nextActions: string[];
    }>;
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
      const logs: LogEvent[] = [];
      const result = await executeRoute(
        route!,
        scenes,
        route!.entrySceneId,
        stateManagerFromUnchecked({}),
        { prepare: {}, publish: {} },
        { onLog: (event) => logs.push(event) },
      );
      expect(result.history).toEqual(vector.output.history);
      for (const expected of vector.output.state)
        expect(result.finalState[expected.path]?.value).toEqual(expected.value);
      expect(
        logs.map((event) => ({
          kind: event.kind,
          sceneId: "sceneId" in event ? event.sceneId : "",
          actionId: "actionId" in event ? event.actionId : "",
          ...("stepIndex" in event ? { stepIndex: event.stepIndex } : {}),
        })),
      ).toEqual(vector.output.logs);
      expect(
        result.trace.scenes.flatMap((scene) =>
          scene.actions.map((action) => ({
            sceneId: scene.sceneId,
            actionId: action.actionId,
            root: action.computeRootValue.value,
            nextActions: action.nextActionIds,
          })),
        ),
      ).toEqual(vector.output.traces);
    });
  }
});

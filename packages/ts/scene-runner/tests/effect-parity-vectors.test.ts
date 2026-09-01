import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildNumber } from "runtime";
import { describe, expect, it } from "vitest";
import { executeScene } from "../src/executor/scene-executor.js";
import { stateManagerFromUnchecked } from "../src/state/state-manager.js";
import type { SceneBlock } from "../src/types/turnout-model_pb.js";

type Vector = {
  name: string;
  model: string;
  prepareValue: number;
  expectedState: number;
  effectOrder: string[];
  publishContext: string;
};

const vectors = JSON.parse(
  readFileSync(resolve(__dirname, "../../../zig/src/fixtures/effect-vectors.json"), "utf8"),
) as Vector[];

describe("shared effect vectors", () => {
  for (const vector of vectors) {
    it(vector.name, async () => {
      const model = JSON.parse(vector.model) as { scenes: SceneBlock[] };
      const scene = model.scenes[0]!;
      const effectOrder: string[] = [];
      let publishState: unknown;
      const result = await executeScene(scene, stateManagerFromUnchecked({}), {
        prepare: {
          load: async (context) => {
            effectOrder.push("prepare:" + context.hookName);
            expect(context.actionId).toBe("start");
            expect(context.get("absent")).toBeUndefined();
            return { input: buildNumber(vector.prepareValue) };
          },
        },
        publish: {
          save: async (context) => {
            effectOrder.push("publish:" + context.hookName);
            expect(context.actionId).toBe("start");
            publishState = context.state()["result.value"]?.value;
          },
        },
      });
      expect(effectOrder).toEqual(vector.effectOrder);
      expect(publishState).toBe(vector.expectedState);
      expect(result.stateAfterScene.read("result.value").value).toBe(vector.expectedState);
      expect(vector.publishContext).toContain('"value":' + vector.expectedState);
    });
  }
});

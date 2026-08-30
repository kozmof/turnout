import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBoolean, buildNumber, buildString } from "runtime";
import type { AnyValue, TagSymbol } from "runtime";
import { executeAction } from "../src/executor/action-executor.js";
import { stateManagerFromUnchecked } from "../src/state/state-manager.js";
import type { ActionModel } from "../src/types/turnout-model_pb.js";

type Input = { name: string; value: string | number | boolean; tags: string[] };
type Output = { symbol: string; value: unknown; reason?: string; tags: string[] };
type Vector = { name: string; compute: ActionModel["compute"]; inputs: Input[]; output: Output };
const vectors = JSON.parse(
  readFileSync(resolve(__dirname, "../../../zig/src/fixtures/compute-vectors.json"), "utf8"),
) as Vector[];

function build(input: Input): AnyValue {
  const tags = input.tags as TagSymbol[];
  if (typeof input.value === "number") return buildNumber(input.value, tags);
  if (typeof input.value === "boolean") return buildBoolean(input.value, tags);
  return buildString(input.value, tags);
}

describe("shared compute vectors", () => {
  for (const vector of vectors) {
    it(vector.name, async () => {
      const stateValues: Record<string, AnyValue> = {};
      const prepare = vector.inputs.map((input) => {
        const path = `inputs.${input.name}`;
        stateValues[path] = build(input);
        return { binding: input.name, fromState: path };
      });
      const action = {
        id: vector.name,
        compute: vector.compute,
        prepare,
      } as unknown as ActionModel;
      const result = await executeAction(action, stateManagerFromUnchecked(stateValues), {
        prepare: {},
        publish: {},
      });
      expect(result.computeRootValue.symbol).toBe(vector.output.symbol);
      expect(result.computeRootValue.value).toEqual(vector.output.value);
      expect(result.computeRootValue.tags).toEqual(vector.output.tags);
      if (vector.output.reason !== undefined)
        expect(result.computeRootValue.subSymbol).toBe(vector.output.reason);
    });
  }
});

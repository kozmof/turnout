import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getCombineFn } from "../compute-graph/call-presets/getCombineFn.js";
import { getTransformFn } from "../compute-graph/call-presets/getTransformFn.js";
import type { CombineFnNames, TransformFnNames } from "../compute-graph/types.js";
import type { AnyValue, TagSymbol } from "./value.js";
import { buildBoolean, buildNumber, buildString } from "./value-builders.js";

type VectorValue = string | number | boolean;
type VectorInput = { value: VectorValue; tags: string[] };
type PresetVector = { name: string; function: string; inputs: VectorInput[]; output: VectorInput };

const vectors = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../zig/src/fixtures/preset-vectors.json"), "utf8"),
) as PresetVector[];

function build(input: VectorInput): AnyValue {
  const tags = input.tags as TagSymbol[];
  switch (typeof input.value) {
    case "number":
      return buildNumber(input.value, tags);
    case "string":
      return buildString(input.value, tags);
    case "boolean":
      return buildBoolean(input.value, tags);
  }
}

describe("shared preset vectors", () => {
  for (const vector of vectors) {
    it(vector.name, () => {
      const inputs = vector.inputs.map(build);
      const result = vector.function.startsWith("combineFn")
        ? getCombineFn(vector.function as CombineFnNames)(...inputs)
        : getTransformFn(vector.function as TransformFnNames)(inputs[0]!);
      expect(result.value).toEqual(vector.output.value);
      expect(result.tags).toEqual(vector.output.tags);
    });
  }
});

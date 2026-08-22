import { describe, it, expect } from "vitest";
import { splitPairCombineFnNames, splitPairTransformFnNames } from "./splitPair.js";
import type { CombineFnNames, TransformFnNames } from "../compute-graph/types.js";

describe("splitPair", () => {
  describe("splitPairCombineFnNames", () => {
    it("splits a valid combine function name", () => {
      const result = splitPairCombineFnNames("combineFnNumber::add" as CombineFnNames);
      expect(result).toEqual(["combineFnNumber", "add"]);
    });

    it("returns null when namespace part is empty", () => {
      expect(splitPairCombineFnNames("::add" as any)).toBeNull();
    });

    it("returns null when name part is empty", () => {
      expect(splitPairCombineFnNames("combineFnNumber::" as any)).toBeNull();
    });

    it("returns null when no delimiter present", () => {
      expect(splitPairCombineFnNames("invalidName" as any)).toBeNull();
    });
  });

  describe("splitPairTransformFnNames", () => {
    it("splits a valid transform function name", () => {
      const result = splitPairTransformFnNames("transformFnNumber::pass" as TransformFnNames);
      expect(result).toEqual(["transformFnNumber", "pass"]);
    });

    it("returns null when namespace part is empty", () => {
      expect(splitPairTransformFnNames("::pass" as any)).toBeNull();
    });

    it("returns null when name part is empty", () => {
      expect(splitPairTransformFnNames("transformFnNumber::" as any)).toBeNull();
    });

    it("returns null when no delimiter present", () => {
      expect(splitPairTransformFnNames("invalidName" as any)).toBeNull();
    });
  });
});

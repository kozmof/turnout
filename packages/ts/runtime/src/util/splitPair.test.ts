import { describe, it, expect } from "vitest";
import { splitPairBinaryFnNames, splitPairTransformFnNames } from "./splitPair.js";
import type { BinaryFnNames, TransformFnNames } from "../compute-graph/types.js";

describe("splitPair", () => {
  describe("splitPairBinaryFnNames", () => {
    it("splits a valid binary function name", () => {
      const result = splitPairBinaryFnNames("binaryFnNumber::add" as BinaryFnNames);
      expect(result).toEqual(["binaryFnNumber", "add"]);
    });

    it("returns null when namespace part is empty", () => {
      expect(splitPairBinaryFnNames("::add" as any)).toBeNull();
    });

    it("returns null when name part is empty", () => {
      expect(splitPairBinaryFnNames("binaryFnNumber::" as any)).toBeNull();
    });

    it("returns null when no delimiter present", () => {
      expect(splitPairBinaryFnNames("invalidName" as any)).toBeNull();
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

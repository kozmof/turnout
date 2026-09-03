import { describe, expect, it } from "vitest";
import {
  fromCanonicalValue,
  toCanonicalOperationValue,
  toCanonicalValue,
} from "../zig-runtime/value-codec.js";
import { buildArray, buildNumber, buildRecord, buildString } from "./value-builders.js";
import { cfGeneric } from "./preset-funcs/generic/combineFn.js";
import { tfNumber } from "./preset-funcs/number/transformFn.js";
import { tfString } from "./preset-funcs/string/transformFn.js";

describe("cross-language Value contract", () => {
  it("uses IEEE-754 arithmetic and JavaScript equality", () => {
    expect(buildNumber(Number.MAX_SAFE_INTEGER + 1).value).toBe(9_007_199_254_740_992);
    expect(cfGeneric.isEqual(buildNumber(Number.NaN), buildNumber(Number.NaN)).value).toBe(false);
    expect(cfGeneric.isEqual(buildNumber(-0), buildNumber(0)).value).toBe(true);
  });

  it("keeps JavaScript number formatting and rounding", () => {
    expect(tfNumber.toStr(buildNumber(-0)).value).toBe("0");
    expect(tfNumber.toStr(buildNumber(1e21)).value).toBe("1e+21");
    expect(Object.is(tfNumber.round(buildNumber(-0.1)).value, -0)).toBe(true);
    expect(tfNumber.round(buildNumber(-2.5)).value).toBe(-2);
  });

  it("uses UTF-16 code units for JavaScript string length", () => {
    expect(tfString.length(buildString("😀")).value).toBe(2);
    expect(tfString.length(buildString("e\u0301")).value).toBe(2);
  });

  it("compares nested arrays structurally and ignores tags", () => {
    const left = buildArray(
      [buildArray([buildString("same", ["left-child"])], ["left-inner"])],
      ["left"],
    );
    const right = buildArray(
      [buildArray([buildString("same", ["right-child"])], ["right-inner"])],
      ["right"],
    );
    expect(cfGeneric.isEqual(left, right).value).toBe(true);
    expect(cfGeneric.isEqual(left, right).tags).toEqual(["left", "right"]);
  });

  it("does not define generic record equality", () => {
    const left = buildRecord({ a: buildNumber(1) });
    const right = buildRecord({ a: buildNumber(1) });
    expect(() => cfGeneric.isEqual(left, right)).toThrow(
      "Cannot compare record and record values for equality",
    );
  });

  it("rejects malformed public Values at the canonical boundary", () => {
    const invalid = [
      null,
      { symbol: "number", value: 1, tags: [1] },
      { symbol: "number", value: "1", tags: [] },
      { symbol: "number", value: 1, subSymbol: "number", tags: [] },
      { symbol: "string", value: 1, tags: [] },
      { symbol: "string", value: "x", subSymbol: "string", tags: [] },
      { symbol: "boolean", value: 1, tags: [] },
      { symbol: "boolean", value: true, subSymbol: "boolean", tags: [] },
      { symbol: "null", value: null, subSymbol: "invalid", tags: [] },
      { symbol: "array", value: {}, tags: [] },
      { symbol: "array", value: [], subSymbol: "record", tags: [] },
      { symbol: "record", value: [], tags: [] },
      { symbol: "record", value: {}, subSymbol: "record", tags: [] },
      { symbol: "unknown", value: 1, tags: [] },
    ];
    for (const value of invalid) expect(() => toCanonicalValue(value)).toThrow(TypeError);
    expect(() => toCanonicalValue({ symbol: "number", value: Infinity, tags: [] })).toThrow(
      "must be finite",
    );
    expect(toCanonicalOperationValue({ symbol: "number", value: Number.NaN, tags: [] }).value).toBe(
      "NaN",
    );
    expect(toCanonicalOperationValue({ symbol: "number", value: Infinity, tags: [] }).value).toBe(
      "Infinity",
    );
    expect(toCanonicalOperationValue({ symbol: "number", value: -Infinity, tags: [] }).value).toBe(
      "-Infinity",
    );
  });

  it("rejects malformed Zig Values and decodes number sentinels", () => {
    const invalid = [
      null,
      { symbol: "number", value: 1, tags: [1] },
      { symbol: "number", value: "invalid", tags: [] },
      { symbol: "string", value: 1, tags: [] },
      { symbol: "boolean", value: 1, tags: [] },
      { symbol: "null", value: null, tags: [] },
      { symbol: "null", value: null, reason: "invalid", tags: [] },
      { symbol: "array", value: {}, tags: [] },
      { symbol: "array", value: [], subSymbol: "record", tags: [] },
      { symbol: "record", value: [], tags: [] },
      { symbol: "unknown", value: 1, tags: [] },
    ];
    for (const value of invalid) expect(() => fromCanonicalValue(value)).toThrow(TypeError);
    expect(
      Number.isNaN(fromCanonicalValue({ symbol: "number", value: "NaN", tags: [] }).value),
    ).toBe(true);
    expect(fromCanonicalValue({ symbol: "number", value: "Infinity", tags: [] }).value).toBe(
      Infinity,
    );
    expect(fromCanonicalValue({ symbol: "number", value: "-Infinity", tags: [] }).value).toBe(
      -Infinity,
    );
  });
});

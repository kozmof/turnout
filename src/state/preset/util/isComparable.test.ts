import { expect, test, describe } from "vitest";
import { isComparable } from "./isComparable";

describe("Check comparable or not", () => {
  test("Symbol is string or random-string", () => {
    expect(isComparable({ symbol: "string", value: "test1", subSymbol: undefined }, { symbol: "string", value: "test2", subSymbol: undefined })).toBe(true);
    expect(isComparable({ symbol: "string", value: "test1", subSymbol: undefined }, { symbol: "random-string", value: "test2", subSymbol: undefined })).toBe(true);
    expect(isComparable({ symbol: "random-string", value: "test1", subSymbol: undefined }, { symbol: "random-string", value: "test2", subSymbol: undefined })).toBe(true);
    expect(isComparable({ symbol: "number", value: 100, subSymbol: undefined }, { symbol: "random-string", value: "test", subSymbol: undefined })).toBe(false);
  });

  test("Symbol is number or random-number", () => {
    expect(isComparable({ symbol: "number", value: 100, subSymbol: undefined }, { symbol: "number", value: 200, subSymbol: undefined })).toBe(true);
    expect(isComparable({ symbol: "number", value: 100, subSymbol: undefined }, { symbol: "random-number", value: 200, subSymbol: undefined })).toBe(true);
    expect(isComparable({ symbol: "random-number", value: 100, subSymbol: undefined }, { symbol: "random-number", value: 200, subSymbol: undefined })).toBe(true);
    expect(isComparable({ symbol: "number", value: 100, subSymbol: undefined }, { symbol: "random-string", value: "test", subSymbol: undefined })).toBe(false);
  });

  test("Symbol is boolean or random-bloolean", () => {
    expect(isComparable({ symbol: "boolean", value: true, subSymbol: undefined }, { symbol: "boolean", value: false, subSymbol: undefined })).toBe(true);
    expect(isComparable({ symbol: "boolean", value: false, subSymbol: undefined }, { symbol: "random-boolean", value: false, subSymbol: undefined })).toBe(true);
    expect(isComparable({ symbol: "random-boolean", value: false, subSymbol: undefined }, { symbol: "random-boolean", value: false, subSymbol: undefined })).toBe(true);
    expect(isComparable({ symbol: "number", value: 100, subSymbol: undefined }, { symbol: "random-boolean", value: true, subSymbol: undefined })).toBe(false);
  });

  test("Symbol is array or random-array", () => {
    expect(isComparable(
      { symbol: "array", value: [{ symbol: "number", value: 100, subSymbol: undefined }], subSymbol: undefined },
      { symbol: "array", value: [], subSymbol: undefined }
    )).toBe(true);
    expect(isComparable(
      { symbol: "array", value: [{ symbol: "number", value: 100, subSymbol: undefined }], subSymbol: undefined },
      { symbol: "random-array", value: [{ symbol: "string", value: "test", subSymbol: undefined }], subSymbol: undefined }
    )).toBe(true);
    expect(isComparable(
      { symbol: "random-array", value: [{ symbol: "number", value: 100, subSymbol: undefined }], subSymbol: undefined },
      { symbol: "random-array", value: [{ symbol: "number", value: 200, subSymbol: undefined }], subSymbol: undefined }
    )).toBe(true);
    expect(isComparable(
      { symbol: "array", value: [{ symbol: "number", value: 100, subSymbol: undefined }], subSymbol: undefined },
      { symbol: "random-boolean", value: true, subSymbol: undefined }
    )).toBe(false);
  });
});

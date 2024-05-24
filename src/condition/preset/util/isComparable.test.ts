import { expect, test, describe } from "vitest";
import { isComparable } from "./isComparable";

describe("Check comparable or not", () => {
  test("Symbol is string or random-string", () => {
    expect(isComparable({ symbol: "string", value: "test1" }, { symbol: "string", value: "test2" })).toBe(true);
    expect(isComparable({ symbol: "string", value: "test1" }, { symbol: "random-string", value: "test2" })).toBe(true);
    expect(isComparable({ symbol: "random-string", value: "test1" }, { symbol: "random-string", value: "test2" })).toBe(true);
    expect(isComparable({ symbol: "number", value: 100 }, { symbol: "random-string", value: "test" })).toBe(false);
  })

  test("Symbol is number or random-number", () => {
    expect(isComparable({ symbol: "number", value: 100 }, { symbol: "number", value: 200 })).toBe(true);
    expect(isComparable({ symbol: "number", value: 100 }, { symbol: "random-number", value: 200 })).toBe(true);
    expect(isComparable({ symbol: "random-number", value: 100 }, { symbol: "random-number", value: 200 })).toBe(true);
    expect(isComparable({ symbol: "number", value: 100 }, { symbol: "random-string", value: "test" })).toBe(false);
  })

  test("Symbol is boolean or random-bloolean", () => {
    expect(isComparable({ symbol: "boolean", value: true }, { symbol: "boolean", value: false })).toBe(true);
    expect(isComparable({ symbol: "boolean", value: false }, { symbol: "random-boolean", value: false })).toBe(true);
    expect(isComparable({ symbol: "random-boolean", value: false }, { symbol: "random-boolean", value: false })).toBe(true);
    expect(isComparable({ symbol: "number", value: 100 }, { symbol: "random-boolean", value: true })).toBe(false);
  })

  test("Symbol is array or random-array", () => {
    expect(isComparable(
      { symbol: "array", value: [{ symbol: "number", value: 100 }] },
      { symbol: "array", value: [] }
    )).toBe(true);
    expect(isComparable(
      { symbol: "array", value: [{ symbol: "number", value: 100 }] },
      { symbol: "random-array", value: [{ symbol: "string", value: "test" }] }
    )).toBe(true);
    expect(isComparable(
      { symbol: "random-array", value: [{ symbol: "number", value: 100 }] },
      { symbol: "random-array", value: [{ symbol: "number", value: 200 }] }
    )).toBe(true);
    expect(isComparable(
      { symbol: "array", value: [{ symbol: "number", value: 100 }] },
      { symbol: "random-boolean", value: true }
    )).toBe(false);
  })
})

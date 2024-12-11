import { expect, test, describe } from "vitest";
import { isFixedArray, isFixedBoolean, isFixedNumber, isFixedString, isRandomArray, isRandomBoolean, isRandomNumber, isRandomString } from "./value";

describe("Check TypeGuard", () => {
  test("Symbol is number", () => {
    expect(isFixedNumber({ symbol: "number", value: 100 })).toBe(true);
    expect(isFixedNumber({ symbol: "random-number", value: 100 })).toBe(false);
  });
  test("Symbol is random-number", () => {
    expect(isRandomNumber({ symbol: "random-number", value: 100 })).toBe(true);
    expect(isRandomNumber({ symbol: "number", value: 100 })).toBe(false);
  });
  test("Symbol is string", () => {
    expect(isFixedString({ symbol: "string", value: "test1" })).toBe(true);
    expect(isFixedString({ symbol: "random-string", value: "test2" })).toBe(false);
  });
  test("Symbol is random-string", () => {
    expect(isRandomString({ symbol: "random-string", value: "test1" })).toBe(true);
    expect(isRandomString({ symbol: "string", value: "test2" })).toBe(false);
  });
  test("Symbol is boolean", () => {
    expect(isFixedBoolean({ symbol: "boolean", value: true })).toBe(true);
    expect(isFixedBoolean({ symbol: "random-boolean", value: false })).toBe(false);
  });
  test("Symbol is random-boolean", () => {
    expect(isRandomBoolean({ symbol: "random-boolean", value: true })).toBe(true);
    expect(isRandomBoolean({ symbol: "boolean", value: false })).toBe(false);
  });
  test("Symbol is array", () => {
    expect(isFixedArray({ symbol: "array", value: [] })).toBe(true);
    expect(isFixedArray({ symbol: "random-array", value: []})).toBe(false);
  });
  test("Symbol is random-array", () => {
    expect(isRandomArray({ symbol: "random-array", value: []})).toBe(true);
    expect(isRandomArray({ symbol: "array", value: [] })).toBe(false);
  });
});

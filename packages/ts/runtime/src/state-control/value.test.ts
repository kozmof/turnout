import { expect, test, describe } from "vitest";
import {
  baseTypeSymbols,
  createUnknownValue,
  isArray,
  isBoolean,
  isNull,
  isNumber,
  isString,
  isPure,
  isPureNumber,
  isPureString,
  isPureBoolean,
  isPureNull,
  hasTag,
  isTypedArray,
  isValidValue,
  nullReasonSubSymbols,
} from "./value";

describe("Check TypeGuard", () => {
  test("Symbol is number (pure)", () => {
    expect(isPureNumber({ symbol: "number", value: 100, subSymbol: undefined, tags: [] })).toBe(
      true,
    );
    expect(
      isPureNumber({ symbol: "number", value: 100, subSymbol: undefined, tags: ["random"] }),
    ).toBe(false);
  });

  test("Symbol is number (with random tag)", () => {
    const randomNum = {
      symbol: "number" as const,
      value: 100,
      subSymbol: undefined as undefined,
      tags: ["random"] as const,
    };
    expect(isNumber(randomNum)).toBe(true);
    expect(hasTag(randomNum, "random")).toBe(true);
    expect(isPure(randomNum)).toBe(false);
  });

  test("Symbol is number (any tags)", () => {
    expect(isNumber({ symbol: "number", value: 100, subSymbol: undefined, tags: ["random"] })).toBe(
      true,
    );
    expect(isNumber({ symbol: "number", value: 100, subSymbol: undefined, tags: [] })).toBe(true);
  });

  test("Symbol is string (pure)", () => {
    expect(isPureString({ symbol: "string", value: "test1", subSymbol: undefined, tags: [] })).toBe(
      true,
    );
    expect(
      isPureString({ symbol: "string", value: "test2", subSymbol: undefined, tags: ["random"] }),
    ).toBe(false);
  });

  test("Symbol is string (with random tag)", () => {
    const randomStr = {
      symbol: "string" as const,
      value: "test",
      subSymbol: undefined as undefined,
      tags: ["random"] as const,
    };
    expect(isString(randomStr)).toBe(true);
    expect(hasTag(randomStr, "random")).toBe(true);
  });

  test("Symbol is string (any tags)", () => {
    expect(
      isString({ symbol: "string", value: "test1", subSymbol: undefined, tags: ["random"] }),
    ).toBe(true);
    expect(isString({ symbol: "string", value: "test2", subSymbol: undefined, tags: [] })).toBe(
      true,
    );
  });

  test("Symbol is boolean (pure)", () => {
    expect(isPureBoolean({ symbol: "boolean", value: true, subSymbol: undefined, tags: [] })).toBe(
      true,
    );
    expect(
      isPureBoolean({ symbol: "boolean", value: false, subSymbol: undefined, tags: ["random"] }),
    ).toBe(false);
  });

  test("Symbol is boolean (with random tag)", () => {
    const randomBool = {
      symbol: "boolean" as const,
      value: true,
      subSymbol: undefined as undefined,
      tags: ["random"] as const,
    };
    expect(isBoolean(randomBool)).toBe(true);
    expect(hasTag(randomBool, "random")).toBe(true);
  });

  test("Symbol is boolean (any tags)", () => {
    expect(
      isBoolean({ symbol: "boolean", value: true, subSymbol: undefined, tags: ["random"] }),
    ).toBe(true);
    expect(isBoolean({ symbol: "boolean", value: false, subSymbol: undefined, tags: [] })).toBe(
      true,
    );
  });

  test("Symbol is array (pure)", () => {
    expect(isArray({ symbol: "array", value: [], subSymbol: undefined, tags: [] })).toBe(true);
    expect(isPure({ symbol: "array", value: [], subSymbol: undefined, tags: [] })).toBe(true);
  });

  test("Symbol is array (with random tag)", () => {
    const randomArr = {
      symbol: "array" as const,
      value: [],
      subSymbol: undefined as undefined,
      tags: ["random"] as const,
    };
    expect(isArray(randomArr)).toBe(true);
    expect(hasTag(randomArr, "random")).toBe(true);
  });

  test("Symbol is array (any tags)", () => {
    expect(isArray({ symbol: "array", value: [], subSymbol: undefined, tags: ["random"] })).toBe(
      true,
    );
    expect(isArray({ symbol: "array", value: [], subSymbol: undefined, tags: [] })).toBe(true);
  });

  test("Symbol is null (pure)", () => {
    expect(isPureNull({ symbol: "null", value: null, subSymbol: "missing", tags: [] })).toBe(true);
    expect(isPureNull({ symbol: "null", value: null, subSymbol: "error", tags: ["random"] })).toBe(
      false,
    );
  });

  test("Symbol is null (with reason)", () => {
    const missingValue = {
      symbol: "null" as const,
      value: null,
      subSymbol: "not-found" as const,
      tags: ["network"] as const,
    };
    expect(isNull(missingValue)).toBe(true);
    expect(hasTag(missingValue, "network")).toBe(true);
    expect(isPure(missingValue)).toBe(false);
  });

  test("Custom tags", () => {
    const cachedNum = {
      symbol: "number" as const,
      value: 42,
      subSymbol: undefined as undefined,
      tags: ["cached"] as const,
    };
    expect(isNumber(cachedNum)).toBe(true);
    expect(hasTag(cachedNum, "cached")).toBe(true);
    expect(hasTag(cachedNum, "random")).toBe(false);
    expect(isPure(cachedNum)).toBe(false);
  });

  test("Multiple tags", () => {
    const complexVal = {
      symbol: "string" as const,
      value: "test",
      subSymbol: undefined as undefined,
      tags: ["random", "cached", "async"] as const,
    };
    expect(isString(complexVal)).toBe(true);
    expect(hasTag(complexVal, "random")).toBe(true);
    expect(hasTag(complexVal, "cached")).toBe(true);
    expect(hasTag(complexVal, "async")).toBe(true);
    expect(isPure(complexVal)).toBe(false);
  });
});

describe("value metadata and validation", () => {
  test("exports base and null reason symbols", () => {
    expect(baseTypeSymbols).toEqual(["number", "string", "boolean", "array", "null"]);
    expect(nullReasonSubSymbols).toEqual([
      "missing",
      "not-found",
      "error",
      "filtered",
      "redacted",
      "unknown",
    ]);
  });

  test("detects typed arrays separately from untyped arrays", () => {
    expect(isTypedArray({ symbol: "array", value: [], subSymbol: "number", tags: [] })).toBe(true);
    expect(isTypedArray({ symbol: "array", value: [], subSymbol: undefined, tags: [] })).toBe(
      false,
    );
    expect(isTypedArray({ symbol: "number", value: 1, subSymbol: undefined, tags: [] })).toBe(
      false,
    );
  });

  test("creates unknown values with the requested shape", () => {
    expect(createUnknownValue("string", "hello", undefined, ["external"])).toEqual({
      symbol: "string",
      value: "hello",
      subSymbol: undefined,
      tags: ["external"],
    });
  });

  test("validates supported value shapes and expected symbols", () => {
    expect(isValidValue({ symbol: "number", value: 1, subSymbol: undefined, tags: [] })).toBe(true);
    expect(
      isValidValue({ symbol: "string", value: "x", subSymbol: undefined, tags: [] }, "string"),
    ).toBe(true);
    expect(
      isValidValue({ symbol: "boolean", value: false, subSymbol: undefined, tags: [] }, "boolean"),
    ).toBe(true);
    expect(
      isValidValue({ symbol: "array", value: [], subSymbol: undefined, tags: [] }, "array"),
    ).toBe(true);
    expect(
      isValidValue({ symbol: "array", value: [], subSymbol: "null", tags: [] }, "array", "null"),
    ).toBe(true);
    expect(
      isValidValue(
        { symbol: "null", value: null, subSymbol: "redacted", tags: [] },
        "null",
        "redacted",
      ),
    ).toBe(true);
  });

  test("rejects malformed values", () => {
    expect(isValidValue(null)).toBe(false);
    expect(isValidValue(1)).toBe(false);
    expect(isValidValue({ symbol: "number", value: 1, subSymbol: undefined })).toBe(false);
    expect(isValidValue({ symbol: 1, value: 1, subSymbol: undefined, tags: [] })).toBe(false);
    expect(isValidValue({ symbol: "object", value: {}, subSymbol: undefined, tags: [] })).toBe(
      false,
    );
    expect(isValidValue({ symbol: "number", value: 1, subSymbol: "number", tags: [] })).toBe(false);
    expect(isValidValue({ symbol: "array", value: [], subSymbol: "array", tags: [] })).toBe(false);
    expect(isValidValue({ symbol: "null", value: null, subSymbol: undefined, tags: [] })).toBe(
      false,
    );
    expect(isValidValue({ symbol: "null", value: null, subSymbol: "gone", tags: [] })).toBe(false);
    expect(isValidValue({ symbol: "string", value: "x", subSymbol: undefined, tags: "tag" })).toBe(
      false,
    );
    expect(
      isValidValue({ symbol: "string", value: "x", subSymbol: undefined, tags: ["ok", 1] }),
    ).toBe(false);
    expect(
      isValidValue({ symbol: "string", value: "x", subSymbol: undefined, tags: [] }, "number"),
    ).toBe(false);
    expect(
      isValidValue(
        { symbol: "array", value: [], subSymbol: "string", tags: [] },
        "array",
        "number",
      ),
    ).toBe(false);
  });
});

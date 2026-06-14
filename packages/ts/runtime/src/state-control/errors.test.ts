import { describe, expect, it } from "vitest";
import { createInvalidValueError, isValueBuilderError } from "./errors";

describe("value builder errors", () => {
  it("creates invalid value errors with and without extra context", () => {
    expect(createInvalidValueError("number", undefined)).toMatchObject({
      name: "InvalidValueError",
      kind: "invalidValue",
      symbol: "number",
      subSymbol: undefined,
      message: "Invalid value created: symbol=number, subSymbol=undefined",
    });

    expect(createInvalidValueError("array", "number", "bad element")).toMatchObject({
      name: "InvalidValueError",
      kind: "invalidValue",
      symbol: "array",
      subSymbol: "number",
      message: "Invalid value created: symbol=array, subSymbol=number - bad element",
    });
  });

  it("recognizes value builder errors only by supported kind", () => {
    expect(isValueBuilderError(createInvalidValueError("boolean", undefined))).toBe(true);
    expect(isValueBuilderError(new Error("plain"))).toBe(false);
    expect(isValueBuilderError(Object.assign(new Error("wrong"), { kind: "missingValue" }))).toBe(
      false,
    );
    expect(isValueBuilderError({ kind: "invalidValue" })).toBe(false);
  });
});

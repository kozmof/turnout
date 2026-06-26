import { describe, expect, it } from "vitest";
import {
  buildArray,
  buildBoolean,
  buildNumber,
  buildString,
  buildNull,
} from "../../state-control/value-builders.js";
import { getBinaryFn } from "./getBinaryFn.js";
import { getTransformFn } from "./getTranformFn.js";

describe("call preset lookup", () => {
  it("resolves binary functions for every namespace", () => {
    expect(
      getBinaryFn("binaryFnArray::concat" as any)(
        buildArray([buildNumber(1)]),
        buildArray([buildNumber(2)]),
      ).value,
    ).toHaveLength(2);

    expect(
      getBinaryFn("binaryFnBoolean::and" as any)(buildBoolean(true), buildBoolean(false)).value,
    ).toBe(false);

    expect(
      getBinaryFn("binaryFnGeneric::isEqual" as any)(buildNumber(1), buildNumber(1)).value,
    ).toBe(true);

    expect(getBinaryFn("binaryFnNumber::add" as any)(buildNumber(2), buildNumber(3)).value).toBe(5);

    expect(
      getBinaryFn("binaryFnString::concat" as any)(buildString("turn"), buildString("out")).value,
    ).toBe("turnout");
  });

  it("rejects malformed binary function names", () => {
    expect(() => getBinaryFn("not-a-pair" as any)).toThrow(
      "Invalid binary function name: not-a-pair",
    );
  });

  it("resolves transform functions for every namespace", () => {
    expect(getTransformFn("transformFnArray::isEmpty" as any)(buildArray([])).value).toBe(true);
    expect(getTransformFn("transformFnBoolean::not" as any)(buildBoolean(false)).value).toBe(true);
    expect(getTransformFn("transformFnNumber::abs" as any)(buildNumber(-7)).value).toBe(7);
    expect(getTransformFn("transformFnNull::pass" as any)(buildNull("missing")).subSymbol).toBe(
      "missing",
    );
    expect(getTransformFn("transformFnString::trim" as any)(buildString("  ok  ")).value).toBe(
      "ok",
    );
  });

  it("rejects malformed transform function names", () => {
    expect(() => getTransformFn("not-a-pair" as any)).toThrow(
      "Invalid transform function name: not-a-pair",
    );
  });
});

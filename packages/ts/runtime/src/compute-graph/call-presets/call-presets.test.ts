import { describe, expect, it } from "vitest";
import {
  buildArray,
  buildBoolean,
  buildNumber,
  buildString,
  buildNull,
} from "../../state-control/value-builders.js";
import { getCombineFn } from "./getCombineFn.js";
import { getTransformFn } from "./getTransformFn.js";

describe("call preset lookup", () => {
  it("resolves combine functions for every namespace", () => {
    expect(
      getCombineFn("combineFnArray::concat" as any)(
        buildArray([buildNumber(1)]),
        buildArray([buildNumber(2)]),
      ).value,
    ).toHaveLength(2);

    expect(
      getCombineFn("combineFnBoolean::and" as any)(buildBoolean(true), buildBoolean(false)).value,
    ).toBe(false);

    expect(
      getCombineFn("combineFnGeneric::isEqual" as any)(buildNumber(1), buildNumber(1)).value,
    ).toBe(true);

    expect(getCombineFn("combineFnNumber::add" as any)(buildNumber(2), buildNumber(3)).value).toBe(
      5,
    );

    expect(
      getCombineFn("combineFnString::concat" as any)(buildString("turn"), buildString("out")).value,
    ).toBe("turnout");
  });

  it("rejects malformed combine function names", () => {
    expect(() => getCombineFn("not-a-pair" as any)).toThrow(
      "Invalid combine function name: not-a-pair",
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

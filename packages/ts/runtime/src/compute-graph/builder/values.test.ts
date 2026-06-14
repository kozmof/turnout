import { describe, expect, it } from "vitest";
import { val, ref } from "./values";
import { assertNever } from "../../util/brand";
import { NAMESPACE_DELIMITER } from "../../util/constants";
import { TOM } from "../../util/tom";

describe("builder value helpers", () => {
  it("builds primitive and null values", () => {
    expect(val.number(7, ["n"])).toEqual({
      symbol: "number",
      value: 7,
      subSymbol: undefined,
      tags: ["n"],
    });
    expect(val.string("x", ["s"])).toEqual({
      symbol: "string",
      value: "x",
      subSymbol: undefined,
      tags: ["s"],
    });
    expect(val.boolean(false, ["b"])).toEqual({
      symbol: "boolean",
      value: false,
      subSymbol: undefined,
      tags: ["b"],
    });
    expect(val.null()).toEqual({ symbol: "null", value: null, subSymbol: "unknown", tags: [] });
    expect(val.null("missing", ["m"])).toEqual({
      symbol: "null",
      value: null,
      subSymbol: "missing",
      tags: ["m"],
    });
  });

  it("builds all typed array variants", () => {
    expect(val.array("number", [val.number(1)], ["a"])).toMatchObject({
      symbol: "array",
      subSymbol: "number",
      tags: ["a"],
    });
    expect(val.array("string", [val.string("x")])).toMatchObject({
      symbol: "array",
      subSymbol: "string",
    });
    expect(val.array("boolean", [val.boolean(true)])).toMatchObject({
      symbol: "array",
      subSymbol: "boolean",
    });
    expect(val.array("null", [val.null("error")])).toMatchObject({
      symbol: "array",
      subSymbol: "null",
    });
  });

  it("creates reference marker objects", () => {
    expect(ref.output("sum")).toEqual({ __type: "funcOutput", funcId: "sum" });
    expect(ref.step("pipe", 2)).toEqual({ __type: "stepOutput", pipeFuncId: "pipe", stepIndex: 2 });
    expect(ref.transform("v1", "transformFnNumber::toStr")).toEqual({
      __type: "transform",
      valueRef: { __type: "value", id: "v1" },
      transformFn: ["transformFnNumber::toStr"],
    });
    expect(
      ref.transform(ref.output("sum"), ["transformFnNumber::abs", "transformFnNumber::toStr"]),
    ).toEqual({
      __type: "transform",
      valueRef: { __type: "funcOutput", funcId: "sum" },
      transformFn: ["transformFnNumber::abs", "transformFnNumber::toStr"],
    });
  });
});

describe("runtime utility helpers", () => {
  it("throws useful assertNever errors", () => {
    expect(() => assertNever("surprise" as never)).toThrow('Unhandled discriminant: "surprise"');
    expect(() => assertNever({ kind: "unknown" } as never, "custom")).toThrow("custom");
  });

  it("exposes typed object helpers and namespace delimiter", () => {
    const obj = { a: 1, b: "two" };
    expect(TOM.keys(obj)).toEqual(["a", "b"]);
    expect(TOM.entries(obj)).toEqual([
      ["a", 1],
      ["b", "two"],
    ]);
    expect(NAMESPACE_DELIMITER).toBe("::");
  });
});

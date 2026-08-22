import { describe, expect, it } from "vitest";
import { cfString } from "./combineFn.js";
import { buildString } from "../../value-builders.js";
import { extractCapture } from "./templateExtract.js";

// ResourceId = "{kind: "foo"|"bar"}-{sequence: integer}"
function ridSpec(want: string): string {
  return JSON.stringify({
    want,
    segs: [
      { cap: "kind", t: "enum", vals: ["foo", "bar"] },
      { text: "-" },
      { cap: "sequence", t: "integer" },
    ],
  });
}

describe("extractCapture", () => {
  it("extracts each capture as raw text", () => {
    expect(extractCapture("foo-42", ridSpec("kind"))).toBe("foo");
    expect(extractCapture("foo-42", ridSpec("sequence"))).toBe("42");
    expect(extractCapture("bar-7", ridSpec("kind"))).toBe("bar");
  });

  it("returns '' when the subject does not match", () => {
    expect(extractCapture("baz-42", ridSpec("kind"))).toBe("");
    expect(extractCapture("foo-x", ridSpec("sequence"))).toBe("");
    expect(extractCapture("foo-", ridSpec("sequence"))).toBe("");
  });

  it("handles a terminal str capture", () => {
    const spec = JSON.stringify({ want: "s", segs: [{ text: "p-" }, { cap: "s", t: "str" }] });
    expect(extractCapture("p-hello world", spec)).toBe("hello world");
    expect(extractCapture("p-", spec)).toBe("");
  });

  it("handles bool and number captures", () => {
    const b = JSON.stringify({ want: "v", segs: [{ text: "b" }, { cap: "v", t: "bool" }] });
    expect(extractCapture("btrue", b)).toBe("true");
    expect(extractCapture("byes", b)).toBe("");
    const n = JSON.stringify({ want: "v", segs: [{ text: "r" }, { cap: "v", t: "number" }] });
    expect(extractCapture("r1.5", n)).toBe("1.5");
    expect(extractCapture("r1.", n)).toBe("");
    expect(extractCapture(`r1${"0".repeat(400)}`, n)).toBe("");
  });

  it("returns '' for malformed spec JSON", () => {
    expect(extractCapture("foo-42", "{not json")).toBe("");
  });

  it("returns '' when the requested capture is absent", () => {
    expect(extractCapture("foo-42", ridSpec("missing"))).toBe("");
  });
});

describe("cfString.extract / extractNum combine fns", () => {
  const S = (v: string) => buildString(v, []);

  it("extract returns the raw captured text as a StringValue", () => {
    expect(cfString.extract(S("foo-42"), S(ridSpec("kind"))).value).toBe("foo");
  });

  it("extractNum returns the parsed number", () => {
    expect(cfString.extractNum(S("foo-42"), S(ridSpec("sequence"))).value).toBe(42);
  });

  it("extractNum returns 0 when the capture is absent or non-numeric", () => {
    expect(cfString.extractNum(S("baz-42"), S(ridSpec("sequence"))).value).toBe(0);
    expect(cfString.extractNum(S("foo-42"), S(ridSpec("kind"))).value).toBe(0);
  });
});

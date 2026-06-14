import { describe, it, expect } from "vitest";
import {
  stateManagerFromUnchecked,
  stateManagerFromSchema,
  stateManagerFromStrict,
  literalToValue,
  protoValueToJs,
} from "../src/state/state-manager.js";
import {
  buildNumber,
  buildString,
  buildBoolean,
  buildArray,
  buildArrayNumber,
  buildArrayString,
  buildArrayBoolean,
  isPureNumber,
  isPureString,
  isPureBoolean,
  isPureNull,
  isArray,
} from "runtime";
import type { StateModel } from "../src/types/turnout-model_pb.js";

describe("StateManager", () => {
  it("reads a value written with from()", () => {
    const sm = stateManagerFromUnchecked({ "a.x": buildNumber(42) });
    const val = sm.read("a.x");
    expect(val).toBeDefined();
    expect(isPureNumber(val!) && val.value).toBe(42);
  });

  it('returns buildNull("missing") for absent unchecked paths', () => {
    const sm = stateManagerFromUnchecked({});
    expect(isPureNull(sm.read("no.such.path"))).toBe(true);
  });

  it("write returns a new instance with updated value", () => {
    const sm = stateManagerFromUnchecked({ "a.x": buildNumber(1) });
    const sm2 = sm.write("a.x", buildNumber(99));
    expect(isPureNumber(sm.read("a.x")!) && sm.read("a.x")!.value).toBe(1);
    expect(isPureNumber(sm2.read("a.x")!) && sm2.read("a.x")!.value).toBe(99);
  });

  it("write does not mutate original", () => {
    const sm = stateManagerFromUnchecked({ "a.x": buildNumber(5) });
    sm.write("a.x", buildNumber(500));
    expect(isPureNumber(sm.read("a.x")!) && sm.read("a.x")!.value).toBe(5);
  });

  it("snapshot returns a flat copy", () => {
    const sm = stateManagerFromUnchecked({ "a.x": buildNumber(7), "b.y": buildString("hi") });
    const snap = sm.snapshot();
    expect(Object.keys(snap)).toHaveLength(2);
    expect(isPureNumber(snap["a.x"]) && snap["a.x"].value).toBe(7);
    expect(isPureString(snap["b.y"]) && snap["b.y"].value).toBe("hi");
  });

  describe("fromSchema", () => {
    const model = {
      namespaces: [
        {
          name: "request",
          fields: [
            { name: "query", type: "str", value: "" },
            { name: "priority", type: "number", value: 1 },
            { name: "ready", type: "bool", value: false },
          ],
        },
      ],
    } as unknown as StateModel;

    it("populates defaults from schema", () => {
      const sm = stateManagerFromSchema(model);
      const q = sm.read("request.query");
      const p = sm.read("request.priority");
      const r = sm.read("request.ready");
      expect(isPureString(q!) && q.value).toBe("");
      expect(isPureNumber(p!) && p.value).toBe(1);
      expect(isPureBoolean(r!) && r.value).toBe(false);
    });

    it("overrides take precedence over schema defaults", () => {
      const sm = stateManagerFromSchema(model, {
        "request.query": buildString("override"),
      });
      const q = sm.read("request.query");
      expect(isPureString(q!) && q.value).toBe("override");
      // other fields still have defaults
      const p = sm.read("request.priority");
      expect(isPureNumber(p!) && p.value).toBe(1);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// literalToValue edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("literalToValue", () => {
  it('returns buildNull("missing") for null', () => {
    const val = literalToValue(null, "number");
    expect(isPureNull(val)).toBe(true);
  });

  it('returns buildNull("missing") for undefined', () => {
    const val = literalToValue(undefined, "str");
    expect(isPureNull(val)).toBe(true);
  });

  it("handles arr<number> with a number array", () => {
    const val = literalToValue([1, 2, 3], "arr<number>");
    expect(isArray(val)).toBe(true);
  });

  it("handles arr<str> with a string array", () => {
    const val = literalToValue(["a", "b"], "arr<str>");
    expect(isArray(val)).toBe(true);
  });

  it("handles arr<bool> with a boolean array", () => {
    const val = literalToValue([true, false], "arr<bool>");
    expect(isArray(val)).toBe(true);
  });

  it("throws when arr<number> receives a non-array value", () => {
    expect(() => literalToValue("not-an-array", "arr<number>")).toThrow("arr<number>");
  });

  it("throws for an unrecognised type", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => literalToValue("value", "unknown" as any)).toThrow(
      'unknown schema type "unknown"',
    );
  });

  it('throws when type "number" receives a non-number value', () => {
    expect(() => literalToValue("42", "number")).toThrow('schema type "number"');
  });

  it('throws when type "str" receives a non-string value', () => {
    expect(() => literalToValue(99, "str")).toThrow('schema type "str"');
  });

  it("throws when arr<str> receives a non-array value", () => {
    expect(() => literalToValue("not-an-array", "arr<str>")).toThrow("arr<str>");
  });

  it("throws when arr<bool> receives a non-array value", () => {
    expect(() => literalToValue("not-an-array", "arr<bool>")).toThrow("arr<bool>");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// write() path validation
// ─────────────────────────────────────────────────────────────────────────────

// spec: state-shape-spec.md §schema — write() validates against declared schema paths
describe("StateManager — write() path validation", () => {
  const model = {
    namespaces: [
      {
        name: "applicant",
        fields: [
          { name: "income", type: "number", value: 0 },
          { name: "name", type: "str", value: "" },
        ],
      },
    ],
  } as unknown as StateModel;

  it("write() to a declared schema path succeeds", () => {
    const sm = stateManagerFromSchema(model);
    expect(() => sm.write("applicant.income", buildNumber(50_000))).not.toThrow();
  });

  it("write() to an unknown path throws with the bad path in the message", () => {
    const sm = stateManagerFromSchema(model);
    expect(() => sm.write("applicant.typo", buildNumber(1))).toThrow('"applicant.typo"');
  });

  it("write() propagates the schema constraint to the returned manager", () => {
    const sm = stateManagerFromSchema(model);
    const sm2 = sm.write("applicant.income", buildNumber(1));
    expect(() => sm2.write("applicant.typo", buildNumber(2))).toThrow('"applicant.typo"');
  });

  it("write() on a schema-less manager never throws for unknown paths", () => {
    const sm = stateManagerFromUnchecked({ "a.x": buildNumber(1) });
    expect(() => sm.write("any.unknown.path", buildNumber(99))).not.toThrow();
  });
});

describe("stateManagerFromSchema — array field types", () => {
  it("populates arr<number> defaults from schema", () => {
    const model = {
      namespaces: [
        {
          name: "data",
          fields: [{ name: "nums", type: "arr<number>", value: [10, 20] }],
        },
      ],
    } as unknown as StateModel;
    const sm = stateManagerFromSchema(model);
    const val = sm.read("data.nums");
    expect(val).toBeDefined();
    expect(isArray(val!)).toBe(true);
  });

  it("populates arr<str> defaults from schema", () => {
    const model = {
      namespaces: [
        {
          name: "data",
          fields: [{ name: "tags", type: "arr<str>", value: ["x", "y"] }],
        },
      ],
    } as unknown as StateModel;
    const sm = stateManagerFromSchema(model);
    expect(isArray(sm.read("data.tags")!)).toBe(true);
  });

  it("populates arr<bool> defaults from schema", () => {
    const model = {
      namespaces: [
        {
          name: "data",
          fields: [{ name: "flags", type: "arr<bool>", value: [true, false] }],
        },
      ],
    } as unknown as StateModel;
    const sm = stateManagerFromSchema(model);
    expect(isArray(sm.read("data.flags")!)).toBe(true);
  });
});

describe("protoValueToJs", () => {
  it("does not treat arbitrary objects with a kind property as protobuf Values", () => {
    const value = { kind: "scene", value: 42 };
    expect(protoValueToJs(value)).toBe(value);
  });
});

describe("matchesSchemaType — unknown type guard", () => {
  it("throws when the schema declares an unrecognised type string", () => {
    // Construct a schema with an invalid type string to force the default branch.
    const model = {
      namespaces: [
        {
          name: "x",
          fields: [{ name: "v", type: "invalid_type", value: null }],
        },
      ],
    } as unknown as StateModel;
    const sm = stateManagerFromSchema(model);
    // write() invokes matchesSchemaType, which should throw for 'invalid_type'.
    expect(() => sm.write("x.v", buildNumber(1))).toThrow('unknown schema type "invalid_type"');
  });
});

describe("StateManager — additional validation branches", () => {
  it("rejects reserved paths on read and write", () => {
    const sm = stateManagerFromUnchecked({});

    expect(() => sm.read("__proto__")).toThrow('reserved path "__proto__"');
    expect(() => sm.write("constructor", buildNumber(1))).toThrow('reserved path "constructor"');
  });

  it("rejects expanded set of Object built-in property names", () => {
    const sm = stateManagerFromUnchecked({});
    const builtins = [
      "hasOwnProperty",
      "toString",
      "valueOf",
      "toLocaleString",
      "isPrototypeOf",
      "propertyIsEnumerable",
    ] as const;
    for (const name of builtins) {
      expect(() => sm.read(name), `read("${name}")`).toThrow(`reserved path "${name}"`);
      expect(() => sm.write(name, buildNumber(1)), `write("${name}")`).toThrow(
        `reserved path "${name}"`,
      );
    }
  });

  it("rejects reserved paths in the initial state passed to stateManagerFromUnchecked", () => {
    // 'constructor' and 'prototype' are reachable as own enumerable keys via object literals.
    // '__proto__' in an object literal invokes the prototype setter, not an own property,
    // so it does not appear in Object.keys; the existing read()/write() guards cover that case.
    expect(() => stateManagerFromUnchecked({ constructor: buildString("x") })).toThrow(
      'reserved path "constructor"',
    );
    expect(() => stateManagerFromUnchecked({ prototype: buildBoolean(true) })).toThrow(
      'reserved path "prototype"',
    );
    // Via Object.defineProperty, __proto__ can appear as an own enumerable key (e.g. from JSON.parse).
    const withProto: Record<string, ReturnType<typeof buildNumber>> = {};
    Object.defineProperty(withProto, "__proto__", {
      value: buildNumber(1),
      enumerable: true,
      configurable: true,
    });
    expect(() => stateManagerFromUnchecked(withProto)).toThrow('reserved path "__proto__"');
  });

  it("read() rejects unknown paths for schema-backed managers", () => {
    const sm = stateManagerFromStrict({}, new Set(["known.path"]));

    expect(() => sm.read("unknown.path")).toThrow('unknown path "unknown.path"');
  });

  it("validPaths returns null for unchecked managers and a set for strict managers", () => {
    expect(stateManagerFromUnchecked({}).validPaths()).toBeNull();

    const paths = new Set(["a.b"]);
    expect(stateManagerFromStrict({}, paths).validPaths()).toBe(paths);
  });

  it("write() validates primitive schema types", () => {
    const sm = stateManagerFromStrict(
      {},
      new Set(["n", "s", "b"]),
      new Map([
        ["n", "number"],
        ["s", "str"],
        ["b", "bool"],
      ]),
    );

    expect(() => sm.write("n", buildString("nope"))).toThrow("expected number, got string");
    expect(() => sm.write("s", buildNumber(1))).toThrow("expected str, got number");
    expect(() => sm.write("b", buildNumber(1))).toThrow("expected bool, got number");
  });

  it("write() validates array schema subtypes while accepting untyped arrays", () => {
    const sm = stateManagerFromStrict(
      {},
      new Set(["nums", "tags", "flags"]),
      new Map([
        ["nums", "arr<number>"],
        ["tags", "arr<str>"],
        ["flags", "arr<bool>"],
      ]),
    );

    expect(() => sm.write("nums", buildString("nope"))).toThrow("expected arr<number>, got string");
    expect(() => sm.write("nums", literalToValue([], "arr<number>"))).not.toThrow();
    expect(() => sm.write("tags", literalToValue([], "arr<str>"))).not.toThrow();
    expect(() => sm.write("flags", literalToValue([], "arr<bool>"))).not.toThrow();
  });

  it("literalToValue validates scalar bool and array elements", () => {
    expect(() => literalToValue("true", "bool")).toThrow('schema type "bool"');
    expect(() => literalToValue([1, "bad"], "arr<number>")).toThrow(
      "arr<number> element is string",
    );
    expect(() => literalToValue(["ok", 2], "arr<str>")).toThrow("arr<str> element is number");
    expect(() => literalToValue([true, "bad"], "arr<bool>")).toThrow("arr<bool> element is string");
  });

  it("protoValueToJs returns nullish inputs unchanged and ignores malformed proto-like objects", () => {
    expect(protoValueToJs(null)).toBeNull();
    expect(protoValueToJs(undefined)).toBeUndefined();

    const missingKind = { $typeName: "google.protobuf.Value" };
    const missingCase = { $typeName: "google.protobuf.Value", kind: {} };
    expect(protoValueToJs(missingKind)).toBe(missingKind);
    expect(protoValueToJs(missingCase)).toBe(missingCase);
  });
});

describe("Array subtype enforcement — regression tests", () => {
  // Regression: literalToValue previously used buildArray (subSymbol: undefined)
  // for all typed array schema fields. It now uses buildArrayNumber / buildArrayString
  // / buildArrayBoolean so schema defaults carry their declared element type.
  it("literalToValue produces typed arrays for arr<number>", () => {
    const v = literalToValue([1, 2, 3], "arr<number>");
    expect(v.symbol).toBe("array");
    expect(v.subSymbol).toBe("number");
  });

  it("literalToValue produces typed arrays for arr<str>", () => {
    const v = literalToValue(["a", "b"], "arr<str>");
    expect(v.symbol).toBe("array");
    expect(v.subSymbol).toBe("string");
  });

  it("literalToValue produces typed arrays for arr<bool>", () => {
    const v = literalToValue([true, false], "arr<bool>");
    expect(v.symbol).toBe("array");
    expect(v.subSymbol).toBe("boolean");
  });

  it("stateManagerFromSchema populates arr<number> defaults with subSymbol number", () => {
    const schema = {
      namespaces: [
        { name: "ns", fields: [{ name: "items", type: "arr<number>", value: [1, 2, 3] }] },
      ],
    } as unknown as StateModel;
    const mgr = stateManagerFromSchema(schema);
    const v = mgr.read("ns.items");
    expect(v.symbol).toBe("array");
    expect(v.subSymbol).toBe("number");
  });

  // Regression: matchesSchemaType previously allowed any array with
  // subSymbol === undefined to pass type validation for any arr<T> field,
  // meaning buildArray([buildBoolean(true)]) could be written to arr<number>.
  it("write() rejects a non-empty untyped array written to arr<number> field", () => {
    const sm = stateManagerFromStrict(
      {},
      new Set(["ns.items"]),
      new Map([["ns.items", "arr<number>"]]),
    );
    const wrongArray = buildArray([buildBoolean(true)]);
    expect(() => sm.write("ns.items", wrongArray)).toThrow("type mismatch");
  });

  it("write() rejects a non-empty untyped array written to arr<str> field", () => {
    const sm = stateManagerFromStrict({}, new Set(["ns.tags"]), new Map([["ns.tags", "arr<str>"]]));
    const wrongArray = buildArray([buildNumber(1)]);
    expect(() => sm.write("ns.tags", wrongArray)).toThrow("type mismatch");
  });

  it("write() accepts an empty untyped array written to any arr<T> field", () => {
    const sm = stateManagerFromStrict(
      {},
      new Set(["nums", "tags", "flags"]),
      new Map([
        ["nums", "arr<number>"],
        ["tags", "arr<str>"],
        ["flags", "arr<bool>"],
      ]),
    );
    const emptyUntyped = buildArray([]);
    expect(() => sm.write("nums", emptyUntyped)).not.toThrow();
    expect(() => sm.write("tags", emptyUntyped)).not.toThrow();
    expect(() => sm.write("flags", emptyUntyped)).not.toThrow();
  });

  it("write() accepts typed array builders for matching arr<T> fields", () => {
    const sm = stateManagerFromStrict(
      {},
      new Set(["nums", "tags", "flags"]),
      new Map([
        ["nums", "arr<number>"],
        ["tags", "arr<str>"],
        ["flags", "arr<bool>"],
      ]),
    );
    expect(() => sm.write("nums", buildArrayNumber([buildNumber(1)]))).not.toThrow();
    expect(() => sm.write("tags", buildArrayString([buildString("x")]))).not.toThrow();
    expect(() => sm.write("flags", buildArrayBoolean([buildBoolean(true)]))).not.toThrow();
  });

  it("write() rejects mismatched typed arrays (arr<number> into arr<str>)", () => {
    const sm = stateManagerFromStrict({}, new Set(["tags"]), new Map([["tags", "arr<str>"]]));
    expect(() => sm.write("tags", buildArrayNumber([buildNumber(1)]))).toThrow("type mismatch");
  });
});

describe("StateManager — isDeclared() and exists()", () => {
  it("isDeclared() returns true for schema-declared paths", () => {
    const sm = stateManagerFromStrict({}, new Set(["a.b", "a.c"]));
    expect(sm.isDeclared("a.b")).toBe(true);
    expect(sm.isDeclared("a.c")).toBe(true);
    expect(sm.isDeclared("a.d")).toBe(false);
  });

  it("isDeclared() always returns true for unchecked managers", () => {
    const sm = stateManagerFromUnchecked({});
    expect(sm.isDeclared("anything.goes")).toBe(true);
  });

  it("exists() returns false before a value is written", () => {
    const sm = stateManagerFromStrict({}, new Set(["a.b"]));
    expect(sm.exists("a.b")).toBe(false);
  });

  it("exists() returns true after a value is written", () => {
    const sm = stateManagerFromStrict({}, new Set(["a.b"])).write("a.b", buildNumber(1));
    expect(sm.exists("a.b")).toBe(true);
  });

  it("isDeclared() true but exists() false for unwritten schema paths", () => {
    const sm = stateManagerFromStrict({}, new Set(["ns.field"]));
    expect(sm.isDeclared("ns.field")).toBe(true);
    expect(sm.exists("ns.field")).toBe(false);
  });

  it("exists() false for any unwritten path in unchecked mode", () => {
    const sm = stateManagerFromUnchecked({});
    expect(sm.exists("never.written")).toBe(false);
    const sm2 = sm.write("never.written", buildString("hello"));
    expect(sm2.exists("never.written")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// stateManagerFromSchema — override validation
// ─────────────────────────────────────────────────────────────────────────────

describe("stateManagerFromSchema — override key validation", () => {
  const model = {
    namespaces: [
      {
        name: "session",
        fields: [
          { name: "count", type: "number", value: 0 },
          { name: "label", type: "str", value: "" },
        ],
      },
    ],
  } as unknown as StateModel;

  it("accepts a valid override key", () => {
    const sm = stateManagerFromSchema(model, { "session.count": buildNumber(42) });
    const v = sm.read("session.count");
    expect(isPureNumber(v) && v.value).toBe(42);
  });

  it("throws at construction time for an unknown override key", () => {
    expect(() => stateManagerFromSchema(model, { "session.typo": buildString("oops") })).toThrow(
      /unknown override path "session\.typo"/,
    );
  });

  it("throws at construction time when override type does not match schema type", () => {
    expect(() =>
      stateManagerFromSchema(model, { "session.count": buildString("not-a-number") }),
    ).toThrow(/type mismatch in override for "session\.count".*expected number/);
  });

  it("throws at construction time when str field receives a number override", () => {
    expect(() => stateManagerFromSchema(model, { "session.label": buildNumber(99) })).toThrow(
      /type mismatch in override for "session\.label".*expected str/,
    );
  });

  it("accepts a correctly typed override for each field type", () => {
    expect(() =>
      stateManagerFromSchema(model, {
        "session.count": buildNumber(7),
        "session.label": buildString("ok"),
      }),
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// matchesArraySubtype — empty-array edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("matchesArraySubtype — empty-array edge cases", () => {
  // An untyped empty array (buildArray([])) has subSymbol undefined.
  // Schema-backed managers accept it for any arr<X> field because there is
  // nothing to check element-wise; the Go validator rejects [] as a fn arg
  // (CodeEmptyArrayLitArg) so this path only arises for value bindings where
  // the schema already declares the expected type.
  const arrSchema = {
    namespaces: [{ name: "ns", fields: [{ name: "nums", type: "arr<number>", value: [] }] }],
  } as unknown as StateModel;

  it("write() accepts an untyped empty array for an arr<number> field", () => {
    const sm = stateManagerFromSchema(arrSchema);
    expect(() => sm.write("ns.nums", buildArray([]))).not.toThrow();
  });

  it("write() accepts a typed buildArrayNumber for an arr<number> field", () => {
    const sm = stateManagerFromSchema(arrSchema);
    expect(() => sm.write("ns.nums", buildArrayNumber([buildNumber(1)]))).not.toThrow();
  });

  it("write() rejects a typed buildArrayString for an arr<number> field", () => {
    const sm = stateManagerFromSchema(arrSchema);
    expect(() => sm.write("ns.nums", buildArrayString([buildString("a")]))).toThrow(
      /expected arr<number>/,
    );
  });
});

describe("StateReader — forEach", () => {
  it("iterates all written paths without allocating a copy", () => {
    const sm = stateManagerFromUnchecked({
      "player.score": buildNumber(42),
      "player.label": buildString("winner"),
    });
    const collected: Array<[string, unknown]> = [];
    sm.forEach((path, value) => collected.push([path, value]));
    expect(collected).toHaveLength(2);
    expect(collected.find(([p]) => p === "player.score")?.[1]).toMatchObject({ value: 42 });
    expect(collected.find(([p]) => p === "player.label")?.[1]).toMatchObject({ value: "winner" });
  });

  it("iterates no entries for an empty state", () => {
    const sm = stateManagerFromUnchecked({});
    let count = 0;
    sm.forEach(() => {
      count++;
    });
    expect(count).toBe(0);
  });

  it("reflects written entries on schema-backed managers", () => {
    const sm = stateManagerFromStrict({ "a.x": buildNumber(1) }, new Set(["a.x", "a.y"]));
    const paths: string[] = [];
    sm.forEach((p) => paths.push(p));
    expect(paths).toEqual(["a.x"]);
  });
});

// --- adversarial ---

describe("reserved-key paths", () => {
  const RESERVED = [
    "__proto__",
    "constructor",
    "prototype",
    "hasOwnProperty",
    "toString",
    "valueOf",
  ];

  for (const key of RESERVED) {
    it(`throws on read("${key}")`, () => {
      const sm = stateManagerFromUnchecked({});
      expect(() => sm.read(key)).toThrow("reserved path");
    });

    it(`throws on write("${key}")`, () => {
      const sm = stateManagerFromUnchecked({});
      expect(() => sm.write(key, buildNumber(1))).toThrow("reserved path");
    });

    it(`throws when ${key} is in initial state`, () => {
      expect(() => stateManagerFromUnchecked({ [key]: buildNumber(1) })).toThrow("reserved path");
    });
  }
});

describe("stateManagerFromStrict — adversarial", () => {
  it("throws on initial value for undeclared path", () => {
    expect(() => stateManagerFromStrict({ "a.typo": buildNumber(1) }, new Set(["a.x"]))).toThrow(
      "unknown initial path",
    );
  });

  it("throws on initial value with wrong type", () => {
    expect(() =>
      stateManagerFromStrict(
        { "a.x": buildString("wrong") },
        new Set(["a.x"]),
        new Map([["a.x", "number"]]),
      ),
    ).toThrow("type mismatch in initial state");
  });

  it("throws on write with wrong type", () => {
    const sm = stateManagerFromStrict(
      { "a.x": buildNumber(1) },
      new Set(["a.x"]),
      new Map([["a.x", "number"]]),
    );
    expect(() => sm.write("a.x", buildString("bad"))).toThrow("type mismatch");
  });

  it("writeBatch is atomic — no partial writes on invalid path", () => {
    const sm = stateManagerFromStrict({ "a.x": buildNumber(1) }, new Set(["a.x"]));
    expect(() => sm.writeBatch({ "a.x": buildNumber(2), "a.bad": buildNumber(3) })).toThrow(
      "unknown path",
    );
    // 'a.x' must remain 1 (batch was rejected before any write committed)
    expect(sm.read("a.x")).toMatchObject({ value: 1 });
  });
});

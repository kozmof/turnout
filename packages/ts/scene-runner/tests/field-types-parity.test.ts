import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { buildNumber, buildString, buildBoolean, buildArrayNumber } from "runtime";
import { getSchemaTypeEntry, schemaTypeTable } from "../src/state/schema-types.js";
import { matchesSchemaType } from "../src/state/state-manager.js";

// spec/field-types.json is the shared DSL type vocabulary. The Go converter
// writes these exact strings into FieldModel.type / BindingModel.type via
// FieldType.ProtoString(), and this table looks them up by the same strings. A
// rename on one side alone surfaces as an "unknown schema type" at runtime
// rather than a compile error, so both languages assert against the spec —
// mirroring what spec/fn-aliases.json does for function names.
//
// The Go half is packages/go/converter/internal/ast/field_types_spec_test.go.
const __dirname = dirname(fileURLToPath(import.meta.url));
const fieldTypes = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../spec/field-types.json"), "utf-8"),
) as Array<{ dsl: string; element: string | null }>;

describe("schema type vocabulary parity", () => {
  it("the spec is non-empty", () => {
    expect(fieldTypes.length).toBeGreaterThan(0);
  });

  it("covers every type declared in spec/field-types.json", () => {
    for (const { dsl } of fieldTypes) {
      expect(
        schemaTypeTable,
        `schemaTypeTable is missing the DSL type "${dsl}" that the Go converter emits`,
      ).toHaveProperty(dsl);
    }
  });

  // schemaTypeTable is a pre-built cache of the spec vocabulary, not the set of
  // types this package accepts: getSchemaTypeEntry falls back to building an
  // entry for anything absent, and the guard it builds asks the engine, which
  // composes arr< and rec< to any depth it can hold. So this pins the cache's
  // contents — a stale entry left behind by a rename — and says nothing about
  // what a model may declare.
  it("caches exactly the spec vocabulary and nothing stale", () => {
    const declared = new Set(fieldTypes.map((t) => t.dsl));
    for (const key of Object.keys(schemaTypeTable)) {
      expect(
        declared.has(key),
        `schemaTypeTable caches "${key}", which is not in spec/field-types.json`,
      ).toBe(true);
    }
    // Catches a simultaneous add and remove, which would slip past both directions.
    expect(Object.keys(schemaTypeTable).length).toBe(fieldTypes.length);
  });

  // The fallback is the half that makes the vocabulary open. A composed type
  // outside the cache must still produce a working entry, because the Go
  // compiler accepts such types and emits them into models.
  it("builds an entry for a composed type outside the cache", () => {
    const composed = "arr<arr<number>>";
    expect(schemaTypeTable).not.toHaveProperty(composed);
    const entry = getSchemaTypeEntry(composed);
    // A non-empty array of plain numbers: an empty one would match vacuously,
    // there being no element for the inner arr<number> to reject.
    expect(entry.guard(buildArrayNumber([buildNumber(1), buildNumber(2)]))).toBe(false);
    expect(entry.guard(entry.build([[1, 2]]))).toBe(true);
  });

  it("names array types with an arr<element> spelling the spec agrees with", () => {
    for (const { dsl, element } of fieldTypes) {
      if (element === null) {
        expect(dsl, `"${dsl}" is a scalar and must not be spelled as an array`).not.toMatch(
          /^arr</,
        );
        continue;
      }
      expect(dsl).toBe(`arr<${element}>`);
      // The element type must itself be part of the vocabulary.
      expect(schemaTypeTable, `element type "${element}" is not a schema type`).toHaveProperty(
        element,
      );
    }
  });

  it("every declared type accepts a value it builds", () => {
    for (const { dsl } of fieldTypes) {
      const entry = schemaTypeTable[dsl];
      expect(entry, `no entry for "${dsl}"`).toBeDefined();
      const sample = sampleFor(dsl);
      expect(
        matchesSchemaType(entry!.build(sample), dsl),
        `"${dsl}" rejects the value its own build() produced`,
      ).toBe(true);
    }
  });

  it("rejects a type name outside the vocabulary", () => {
    expect(() => matchesSchemaType(buildNumber(1), "arr<unknown>")).toThrow(/unknown schema type/);
  });
});

/** A raw JS value valid for the given DSL type, used to exercise build(). */
function sampleFor(dsl: string): unknown {
  switch (dsl) {
    case "number":
      return 1;
    case "str":
      return "x";
    case "bool":
      return true;
    case "arr<number>":
      return [1];
    case "arr<str>":
      return ["x"];
    case "arr<bool>":
      return [true];
    case "arr<rec<str, number>>":
      return [{ count: 1 }];
    case "rec<str, arr<number>>":
      return { scores: [1] };
    case "rec<str, number>":
    case "rec<str, str>":
    case "rec<str, bool>":
    case "rec<number, number>":
    case "rec<number, str>":
    case "rec<number, bool>":
      return {};
    default:
      throw new Error(
        `spec/field-types.json declares "${dsl}", which this test has no sample for — ` +
          `add one so the new type is actually exercised`,
      );
  }
}

// A guard that accepts the wrong shape is the failure this vocabulary exists to
// prevent, so check that the types genuinely discriminate rather than only that
// they are present.
describe("schema type guards discriminate", () => {
  it("does not accept a scalar for an array type or vice versa", () => {
    expect(matchesSchemaType(buildNumber(1), "number")).toBe(true);
    expect(matchesSchemaType(buildNumber(1), "str")).toBe(false);
    expect(matchesSchemaType(buildNumber(1), "arr<number>")).toBe(false);
    expect(matchesSchemaType(buildArrayNumber([buildNumber(1)]), "arr<number>")).toBe(true);
    expect(matchesSchemaType(buildArrayNumber([buildNumber(1)]), "arr<str>")).toBe(false);
    expect(matchesSchemaType(buildArrayNumber([buildNumber(1)]), "number")).toBe(false);
    expect(matchesSchemaType(buildString("x"), "str")).toBe(true);
    expect(matchesSchemaType(buildBoolean(true), "bool")).toBe(true);
    expect(matchesSchemaType(buildBoolean(true), "number")).toBe(false);
  });
});

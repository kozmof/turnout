import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { buildNumber, buildString, buildBoolean, buildArrayNumber } from "runtime";
import { schemaTypeTable } from "../src/state/schema-types.js";
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

  it("declares no type absent from the spec", () => {
    const declared = new Set(fieldTypes.map((t) => t.dsl));
    for (const key of Object.keys(schemaTypeTable)) {
      expect(
        declared.has(key),
        `schemaTypeTable declares "${key}", which is not in spec/field-types.json`,
      ).toBe(true);
    }
  });

  // Catches a simultaneous add and remove, which would slip past both directions.
  it("matches the spec entry count", () => {
    expect(Object.keys(schemaTypeTable).length).toBe(fieldTypes.length);
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
    case "arr<Record<str, number>>":
      return [{ count: 1 }];
    case "Record<str, arr<number>>":
      return { scores: [1] };
    case "Record<str, number>":
    case "Record<str, str>":
    case "Record<str, bool>":
    case "Record<number, number>":
    case "Record<number, str>":
    case "Record<number, bool>":
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

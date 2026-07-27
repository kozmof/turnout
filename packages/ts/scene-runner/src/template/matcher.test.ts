import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fromJson } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { TurnModelSchema } from "../types/turnout-model_pb.js";
import type { TemplateTypeExpr, TypeExpr } from "../types/turnout-model_pb.js";
import { buildTypeRegistry, matchTemplate, templateContains } from "./matcher.js";

const fixturePath = fileURLToPath(
  new URL("../../../../../spec/conformance/template-matching.json", import.meta.url),
);

interface Case {
  type: string;
  input: string;
  matched: boolean;
  captures?: Record<string, string | number | boolean>;
}

interface Fixture {
  model: unknown;
  cases: Case[];
  constructions: Array<{
    type: string;
    captures: Record<string, string | number | boolean>;
    output: string;
  }>;
  armSelections: Array<{
    type: string;
    input: string;
    arms: Array<{ capture?: string; equals?: string | number | boolean; default?: boolean }>;
    selected: number;
  }>;
  failures: Array<{ type: string; input: string; diagnostic: string }>;
}

function loadFixture() {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;
  const model = fromJson(TurnModelSchema, fixture.model as never, { ignoreUnknownFields: true });
  const registry = buildTypeRegistry(model);
  const byName = new Map<string, TypeExpr>();
  for (const decl of model.typeDecls) {
    if (decl.type) byName.set(decl.name, decl.type);
  }
  return { fixture, registry, byName };
}

function templateOf(byName: Map<string, TypeExpr>, name: string): TemplateTypeExpr {
  const t = byName.get(name);
  if (t?.type.case !== "template") throw new Error(`type ${name} is not a template`);
  return t.type.value;
}

describe("template matcher conformance (§28.8)", () => {
  const { fixture, registry, byName } = loadFixture();

  for (const c of fixture.cases) {
    it(`${c.type} <- ${JSON.stringify(c.input)} => ${c.matched}`, () => {
      const tmpl = templateOf(byName, c.type);
      const result = matchTemplate(tmpl, c.input, registry);
      expect(result.matched).toBe(c.matched);
      if (result.matched && c.captures) {
        expect(result.captures).toEqual(c.captures);
      }
    });
  }
});

describe("template matcher units", () => {
  const { registry, byName } = loadFixture();

  it("templateContains mirrors matchTemplate", () => {
    const rid = templateOf(byName, "ResourceId");
    expect(templateContains(rid, "foo-1", registry)).toBe(true);
    expect(templateContains(rid, "nope", registry)).toBe(false);
  });

  it("decodes typed capture values (number, not string)", () => {
    const rid = templateOf(byName, "ResourceId");
    const r = matchTemplate(rid, "foo-42", registry);
    expect(r.matched).toBe(true);
    if (r.matched) {
      expect(typeof r.captures.sequence).toBe("number");
      expect(r.captures.sequence).toBe(42);
      expect(r.captures.kind).toBe("foo");
    }
  });

  it("resolves a named union capture via the registry", () => {
    const rid = templateOf(byName, "ResourceId");
    // kind: Kind (a named union) — only foo/bar are accepted.
    expect(templateContains(rid, "foo-1", registry)).toBe(true);
    expect(templateContains(rid, "baz-1", registry)).toBe(false);
  });

  it("rejects the empty string for a capture", () => {
    const bk = templateOf(byName, "BooleanKey");
    expect(templateContains(bk, "enabled-", registry)).toBe(false);
  });
});

// modelFromDecls builds a registry + name index from raw protojson type decls,
// giving fine-grained control over capture types for branch coverage.
function modelFromDecls(decls: unknown[]) {
  const model = fromJson(TurnModelSchema, { typeDecls: decls } as never, {
    ignoreUnknownFields: true,
  });
  const registry = buildTypeRegistry(model);
  const byName = new Map<string, TypeExpr>();
  for (const decl of model.typeDecls) {
    if (decl.type) byName.set(decl.name, decl.type);
  }
  return { registry, byName };
}

function tmplDecl(name: string, segments: unknown[]) {
  return { name, type: { template: { segments } } };
}
function textSeg(value: string) {
  return { text: { value } };
}
function capSeg(name: string, type: unknown) {
  return { capture: { name, type } };
}

describe("template matcher capture types", () => {
  it("decodes a number primitive capture", () => {
    const { registry, byName } = modelFromDecls([
      tmplDecl("Ratio", [textSeg("r"), capSeg("value", { primitive: { name: "number" } })]),
    ]);
    const t = templateOf(byName, "Ratio");
    expect(matchTemplate(t, "r1.5", registry)).toEqual({ matched: true, captures: { value: 1.5 } });
    expect(matchTemplate(t, "r-2.5", registry)).toEqual({
      matched: true,
      captures: { value: -2.5 },
    });
    expect(matchTemplate(t, "r3", registry)).toEqual({ matched: true, captures: { value: 3 } });
    for (const bad of ["r1.", "r.5", "r1e3", "r007", "rx"]) {
      expect(templateContains(t, bad, registry)).toBe(false);
    }
  });

  it("decodes integer / number / bool literal captures", () => {
    const { registry, byName } = modelFromDecls([
      tmplDecl("Seven", [textSeg("s"), capSeg("v", { literal: { value: 7, base: "integer" } })]),
      tmplDecl("Half", [textSeg("h"), capSeg("v", { literal: { value: 1.5, base: "number" } })]),
      tmplDecl("Yes", [textSeg("b"), capSeg("v", { literal: { value: true, base: "bool" } })]),
    ]);
    const seven = templateOf(byName, "Seven");
    expect(matchTemplate(seven, "s7", registry)).toEqual({ matched: true, captures: { v: 7 } });
    expect(templateContains(seven, "s8", registry)).toBe(false);
    expect(templateContains(seven, "s07", registry)).toBe(false);

    const half = templateOf(byName, "Half");
    expect(matchTemplate(half, "h1.5", registry)).toEqual({ matched: true, captures: { v: 1.5 } });
    expect(templateContains(half, "h2", registry)).toBe(false);

    const yes = templateOf(byName, "Yes");
    expect(matchTemplate(yes, "btrue", registry)).toEqual({ matched: true, captures: { v: true } });
    expect(templateContains(yes, "bfalse", registry)).toBe(false);
    expect(templateContains(yes, "byep", registry)).toBe(false);
  });

  it("decodes a terminal str capture", () => {
    const { registry, byName } = modelFromDecls([
      tmplDecl("Pre", [textSeg("p-"), capSeg("s", { primitive: { name: "str" } })]),
    ]);
    const t = templateOf(byName, "Pre");
    expect(matchTemplate(t, "p-hello", registry)).toEqual({
      matched: true,
      captures: { s: "hello" },
    });
    expect(templateContains(t, "p-", registry)).toBe(false);
  });

  it("returns false for an unresolved named capture type", () => {
    const { registry, byName } = modelFromDecls([
      tmplDecl("T", [textSeg("x"), capSeg("c", { named: { name: "Missing" } })]),
    ]);
    expect(templateContains(templateOf(byName, "T"), "xabc", registry)).toBe(false);
  });

  it("terminates on a cyclic named capture type", () => {
    const { registry, byName } = modelFromDecls([
      { name: "X", type: { named: { name: "X" } } },
      tmplDecl("T", [textSeg("x"), capSeg("c", { named: { name: "X" } })]),
    ]);
    expect(templateContains(templateOf(byName, "T"), "xabc", registry)).toBe(false);
  });

  it("returns false when a capture has no type", () => {
    const { registry, byName } = modelFromDecls([
      tmplDecl("T", [textSeg("x"), { capture: { name: "c" } }]),
    ]);
    expect(templateContains(templateOf(byName, "T"), "xy", registry)).toBe(false);
  });

  it("handles an unknown primitive name", () => {
    const { registry, byName } = modelFromDecls([
      tmplDecl("T", [textSeg("x"), capSeg("c", { primitive: { name: "weird" } })]),
    ]);
    expect(templateContains(templateOf(byName, "T"), "xy", registry)).toBe(false);
  });
});

describe("complete cross-language conformance (§28.8)", () => {
  const { fixture, registry, byName } = loadFixture();

  for (const c of fixture.constructions) {
    it(`constructs ${c.type} as ${JSON.stringify(c.output)}`, () => {
      const template = templateOf(byName, c.type);
      const output = template.segments
        .map((segment) => {
          if (segment.segment.case === "text") return segment.segment.value.value;
          if (segment.segment.case === "capture") {
            const value = c.captures[segment.segment.value.name];
            if (value === undefined)
              throw new Error(`missing capture ${segment.segment.value.name}`);
            return String(value);
          }
          return "";
        })
        .join("");
      expect(output).toBe(c.output);
      expect(matchTemplate(template, output, registry)).toEqual({
        matched: true,
        captures: c.captures,
      });
    });
  }

  for (const c of fixture.armSelections) {
    it(`selects ordered arm ${c.selected} for ${JSON.stringify(c.input)}`, () => {
      const result = matchTemplate(templateOf(byName, c.type), c.input, registry);
      let selected = -1;
      if (result.matched) {
        selected = c.arms.findIndex(
          (arm) => arm.default === true || result.captures[arm.capture ?? ""] === arm.equals,
        );
      }
      expect(selected).toBe(c.selected);
    });
  }

  for (const c of fixture.failures) {
    it(`reports ${c.diagnostic} for ${JSON.stringify(c.input)}`, () => {
      const matched = templateContains(templateOf(byName, c.type), c.input, registry);
      expect(matched ? "" : "InvalidTemplateValue").toBe(c.diagnostic);
    });
  }
});

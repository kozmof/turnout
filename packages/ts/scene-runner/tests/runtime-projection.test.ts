import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultZigRuntimeClient } from "../src/zig-runtime/default-client.js";
import { runtimeProjection } from "../src/model-encoding.js";

type CompilerOnlyField = {
  message: string;
  field: string;
  path: string;
  why: string;
};

const spec = JSON.parse(
  readFileSync(new URL("../../../../spec/runtime-projection.json", import.meta.url), "utf8"),
) as { compilerOnly: CompilerOnlyField[] };

/**
 * A model carrying `leafKey` at the position `path` describes, and nothing else.
 *
 * `a.b[].c` becomes `{a: {b: [{c: <marker>}]}}`. One element per repeated field
 * is enough: the rule is about the field existing anywhere, not how often.
 */
function plant(path: string, leafKey: string, marker: unknown): Record<string, unknown> {
  const root: Record<string, unknown> = { version: 2 };
  let node = root;
  const segments = path.split(".");
  segments.forEach((segment, index) => {
    const repeated = segment.endsWith("[]");
    const key = repeated ? segment.slice(0, -2) : segment;
    if (index === segments.length - 1) {
      node[leafKey] = marker;
      return;
    }
    const child: Record<string, unknown> = {};
    node[key] = repeated ? [child] : child;
    node = child;
  });
  return root;
}

function read(model: unknown, path: string): unknown {
  let node: unknown = model;
  for (const segment of path.split(".")) {
    if (node === undefined || node === null) return undefined;
    const repeated = segment.endsWith("[]");
    const key = repeated ? segment.slice(0, -2) : segment;
    node = (node as Record<string, unknown>)[key];
    if (repeated) node = Array.isArray(node) ? node[0] : undefined;
  }
  return node;
}

function runtimeError(model: unknown): string | undefined {
  const response = defaultZigRuntimeClient.prepareModel(
    new TextEncoder().encode(JSON.stringify(model)),
  );
  if (response.status === "ok") {
    defaultZigRuntimeClient.destroyModel((response.payload as { handle: number }).handle);
    return undefined;
  }
  const payload = response.payload as { error?: unknown };
  return typeof payload?.error === "string" ? payload.error : response.status;
}

// The projection rule is implemented three times — the Go emitter strips these
// fields, the TypeScript encoder strips them again, and the Zig runtime rejects
// them. Each implementation is gated against spec/runtime-projection.json in its
// own language; these two suites are the TypeScript and Zig halves. Adding a
// compiler-only field to the proto means adding it to the spec file, and these
// fail until both sides handle it.
describe("runtime projection, against spec/runtime-projection.json", () => {
  it("covers every compiler-only field the spec declares", () => {
    expect(spec.compilerOnly.length).toBeGreaterThan(0);
  });

  describe.each(spec.compilerOnly)("$path", (entry) => {
    it("is stripped by the TypeScript encoder", () => {
      const model = plant(entry.path, entry.path.split(".").at(-1) as string, { planted: true });
      expect(read(model, entry.path)).toEqual({ planted: true });

      expect(read(runtimeProjection(model), entry.path)).toBeUndefined();
    });

    it("is rejected by the Zig runtime", () => {
      const leaf = entry.path.split(".").at(-1) as string;
      expect(runtimeError(plant(entry.path, leaf, { planted: true }))).toBe("CompilerMetadata");

      // The same shape without the compiler-only field must fail for some other
      // reason or not at all, so the rejection above is attributable to the
      // field rather than to the surrounding structure.
      expect(runtimeError(plant(entry.path, "notCompilerOnly", { planted: true }))).not.toBe(
        "CompilerMetadata",
      );
    });
  });
});

describe("runtimeProjection", () => {
  it("removes compiler metadata from every projected location", () => {
    const projected = runtimeProjection({
      version: 2,
      annotations: { entries: [{ sigil: "@" }] },
      typeDecls: [{ name: "Status", sourcePos: { line: 1 } }],
      routes: [{ id: "route", entrySceneId: "scene" }],
      scenes: [
        {
          id: "scene",
          view: {
            name: "overview",
            flow: "lr",
            enforce: true,
            nodes: [{ id: "action" }],
            edges: [{ from: "action", to: "done" }],
            sourcePos: { line: 2 },
          },
          actions: [
            {
              id: "action",
              compute: {
                prog: {
                  name: "action-program",
                  sigils: { value: 1 },
                  bindings: [
                    {
                      name: "value",
                      type: "number",
                      value: 1,
                      extExpr: { ref: "external" },
                      sourcePos: { line: 3 },
                      declaredType: { primitive: { name: "number" } },
                    },
                  ],
                },
              },
              next: [
                {
                  action: "done",
                  compute: {
                    prog: {
                      name: "next-program",
                      sigils: { condition: 2 },
                      bindings: [
                        {
                          name: "condition",
                          type: "bool",
                          value: true,
                          extExpr: { ref: "external" },
                          sourcePos: { line: 4 },
                          declaredType: { primitive: { name: "bool" } },
                        },
                      ],
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
      futureRuntimeField: { retained: true },
    });

    expect(projected).toEqual({
      version: 2,
      typeDecls: [{ name: "Status" }],
      routes: [{ id: "route", entrySceneId: "scene", match: [] }],
      scenes: [
        {
          id: "scene",
          view: { name: "overview", flow: "lr", enforce: true },
          actions: [
            {
              id: "action",
              compute: {
                prog: {
                  name: "action-program",
                  bindings: [{ name: "value", type: "number", value: 1 }],
                },
              },
              next: [
                {
                  action: "done",
                  compute: {
                    prog: {
                      name: "next-program",
                      bindings: [{ name: "condition", type: "bool", value: true }],
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
      futureRuntimeField: { retained: true },
    });
  });

  it("does not mutate the compiler model", () => {
    const input = {
      annotations: { entries: [] },
      scenes: [{ id: "scene", view: { nodes: [{ id: "action" }] } }],
    };

    runtimeProjection(input);

    expect(input.annotations).toEqual({ entries: [] });
    expect(input.scenes[0]?.view.nodes).toEqual([{ id: "action" }]);
  });
});

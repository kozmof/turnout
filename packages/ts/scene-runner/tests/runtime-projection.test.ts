import { describe, expect, it } from "vitest";
import { runtimeProjection } from "../src/runner.js";

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

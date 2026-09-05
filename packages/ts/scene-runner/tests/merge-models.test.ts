import { describe, expect, it } from "vitest";
import { mergeModels, ModelMergeError } from "../src/merge-models.js";
import { createRunner, prepareModel } from "../src/runner.js";
import type { SceneBlock, TurnModel } from "../src/types/turnout-model_pb.js";

function scene(id: string, toState: string, value: number): SceneBlock {
  return {
    id,
    entryAction: "act",
    actions: [
      {
        id: "act",
        compute: {
          root: "result",
          prog: { name: "p", bindings: [{ name: "result", type: "number", value }] },
        },
        merge: [{ binding: "result", toState }],
      },
    ],
  } as unknown as SceneBlock;
}

function model(scenes: SceneBlock[], fields: [string, string, unknown][] = []): TurnModel {
  const base = {
    version: 2,
    minVersion: 0,
    maxVersion: 0,
    scenes,
    routes: [],
  } as unknown as TurnModel;
  if (fields.length > 0) {
    base.state = {
      namespaces: [
        {
          name: "app",
          fields: fields.map(([name, type, value]) => ({ name, type, value })),
        },
      ],
    } as never;
  }
  return base;
}

const options = { initialState: {}, allowUncheckedState: true } as const;

describe("mergeModels", () => {
  it("returns the single input unchanged", () => {
    const only = model([scene("a", "score", 1)]);
    expect(mergeModels([only])).toBe(only);
  });

  it("combines scenes from separately compiled models and runs them", async () => {
    const merged = mergeModels([
      model([scene("first", "one", 1)]),
      model([scene("second", "two", 2)]),
    ]);
    expect(merged.scenes.map((s) => s.id)).toEqual(["first", "second"]);

    // Both scenes are reachable in the merged model, each with its own entry.
    const first = await createRunner(merged, { ...options, entryId: "first" }).run();
    expect(first.finalState.one?.value).toBe(1);
    const second = await createRunner(merged, { ...options, entryId: "second" }).run();
    expect(second.finalState.two?.value).toBe(2);
  });

  it("works with a prepared model", async () => {
    const merged = mergeModels([
      model([scene("first", "one", 1)]),
      model([scene("second", "two", 2)]),
    ]);
    const prepared = prepareModel(merged);
    const result = await createRunner(prepared, { ...options, entryId: "second" }).run();
    expect(result.finalState.two?.value).toBe(2);
    prepared.release();
  });

  it("rejects a scene declared by two inputs, naming both", () => {
    expect(() =>
      mergeModels([model([scene("dup", "a", 1)]), model([scene("dup", "b", 2)])], {
        labels: ["base", "extra"],
      }),
    ).toThrow(/scene "dup" is declared by base and extra/);
  });

  it("rejects a route declared by two inputs", () => {
    const withRoute = (target: string): TurnModel => {
      const built = model([scene(target, "s", 1)]);
      built.routes = [
        { id: "r", entrySceneId: target, match: [] },
      ] as unknown as TurnModel["routes"];
      return built;
    };
    expect(() => mergeModels([withRoute("x"), withRoute("y")])).toThrow(
      /route "r" is declared by model 0 and model 1/,
    );
  });

  it("unions STATE namespaces and accepts an identical redeclaration", () => {
    const merged = mergeModels([
      model([scene("a", "app.one", 1)], [["shared", "number", 0]]),
      model(
        [scene("b", "app.two", 2)],
        [
          ["shared", "number", 0],
          ["extra", "str", ""],
        ],
      ),
    ]);
    const fields = merged.state?.namespaces[0]?.fields.map((f) => f.name);
    // "shared" is declared by both, identically, so it appears once.
    expect(fields).toEqual(["shared", "extra"]);
  });

  it("rejects a STATE field two inputs declare differently", () => {
    expect(() =>
      mergeModels(
        [
          model([scene("a", "app.x", 1)], [["shared", "number", 0]]),
          model([scene("b", "app.y", 2)], [["shared", "str", ""]]),
        ],
        { labels: ["base", "extra"] },
      ),
    ).toThrow(/STATE field "app.shared" is declared as str/);
  });

  it("reports every conflict at once", () => {
    try {
      mergeModels([
        model([scene("dup", "a", 1)], [["shared", "number", 0]]),
        model([scene("dup", "b", 2)], [["shared", "bool", false]]),
      ]);
      expect.unreachable("merge should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelMergeError);
      expect((error as ModelMergeError).conflicts).toHaveLength(2);
    }
  });

  it("keeps a model without STATE unchecked", () => {
    const merged = mergeModels([model([scene("a", "x", 1)]), model([scene("b", "y", 2)])]);
    // Gaining an empty schema would switch execution to schema-managed and
    // reject every write.
    expect(merged.state).toBeUndefined();
  });

  it("narrows the version window to satisfy every input", () => {
    const low = model([scene("a", "x", 1)]);
    low.minVersion = 1;
    low.maxVersion = 5;
    const high = model([scene("b", "y", 2)]);
    high.minVersion = 2;
    high.maxVersion = 4;
    const merged = mergeModels([low, high]);
    expect(merged.minVersion).toBe(2);
    expect(merged.maxVersion).toBe(4);
  });

  it("rejects inputs compiled at different schema versions", () => {
    const older = model([scene("a", "x", 1)]);
    older.version = 1;
    expect(() => mergeModels([model([scene("b", "y", 2)]), older])).toThrow(/is version 1/);
  });
});

describe("mergeModels — type declarations and edge cases", () => {
  const withTypes = (id: string, decls: unknown[]): TurnModel => {
    const built = model([scene(id, "x", 1)]);
    built.typeDecls = decls as TurnModel["typeDecls"];
    return built;
  };

  it("unions type declarations and accepts an identical redeclaration", () => {
    const decl = { name: "Status", type: { literal: { stringValue: "ok" } } };
    const other = { name: "Code", type: { literal: { numberValue: 1 } } };
    const merged = mergeModels([withTypes("a", [decl]), withTypes("b", [decl, other])]);
    expect(merged.typeDecls.map((d) => d.name)).toEqual(["Status", "Code"]);
  });

  it("rejects a type two inputs declare differently", () => {
    expect(() =>
      mergeModels(
        [
          withTypes("a", [{ name: "Status", type: { literal: { stringValue: "ok" } } }]),
          withTypes("b", [{ name: "Status", type: { literal: { stringValue: "no" } } }]),
        ],
        { labels: ["base", "extra"] },
      ),
    ).toThrow(/type "Status" is declared differently by base and extra/);
  });

  it("rejects an empty input list", () => {
    expect(() => mergeModels([])).toThrow(ModelMergeError);
  });

  it("keeps a namespace that declares no fields", () => {
    const empty = model([scene("a", "x", 1)]);
    empty.state = { namespaces: [{ name: "app", fields: [] }] } as never;
    const merged = mergeModels([empty, model([scene("b", "y", 2)], [["one", "number", 0]])]);
    expect(merged.state?.namespaces.map((n) => n.name)).toEqual(["app"]);
    expect(merged.state?.namespaces[0]?.fields.map((f) => f.name)).toEqual(["one"]);
  });
});

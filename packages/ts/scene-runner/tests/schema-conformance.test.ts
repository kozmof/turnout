/**
 * Proto contract conformance tests for the Go→TS JSON boundary.
 *
 * The schema is now defined in schema/turnout-model.proto. Both Go and
 * TypeScript types are generated from that file, so structural drift is
 * caught at compile time. These runtime tests verify that:
 *   1. JSON fixture files can be loaded with fromJson (valid proto JSON).
 *   2. TypeScript can construct valid TurnModel values using the generated types.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fromJson, type JsonObject } from "@bufbuild/protobuf";
import type { TurnModel, SceneBlock, ActionModel } from "../src/types/turnout-model_pb.js";
import { TurnModelSchema } from "../src/types/turnout-model_pb.js";
import { validateModel } from "../src/executor/validate-model.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, "fixtures");

function loadFixture(name: string): TurnModel {
  const raw = readFileSync(resolve(fixturesDir, name), "utf-8");
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return fromJson(TurnModelSchema, JSON.parse(raw) as JsonObject);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixture file tests
// ─────────────────────────────────────────────────────────────────────────────

describe("fixture files are valid proto JSON", () => {
  for (const fixture of ["workflow.json", "scene-graph.json", "two-scene-route.json"]) {
    it(fixture, () => {
      expect(() => loadFixture(fixture)).not.toThrow();
      const model = loadFixture(fixture);
      expect(Array.isArray(model.scenes)).toBe(true);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Inline TurnModel type conformance (compile-time + shape check)
// ─────────────────────────────────────────────────────────────────────────────

describe("inline TurnModel type conformance", () => {
  it("accepts a minimal valid TurnModel", () => {
    const model = {
      scenes: [
        {
          id: "test",
          entryActions: ["a"],
          actions: [
            {
              id: "a",
              compute: {
                root: "out",
                prog: { name: "p", bindings: [{ name: "out", type: "bool", value: true }] },
              },
            } as unknown as ActionModel,
          ],
        } as unknown as SceneBlock,
      ],
    } as unknown as TurnModel;
    expect(Array.isArray(model.scenes)).toBe(true);
    expect(model.scenes[0]?.id).toBe("test");
  });

  it("accepts a TurnModel with state and routes", () => {
    const model = {
      state: {
        namespaces: [{ name: "user", fields: [{ name: "active", type: "bool", value: false }] }],
      },
      scenes: [
        {
          id: "s",
          entryActions: ["a"],
          nextPolicy: "first-match",
          actions: [{ id: "a" } as unknown as ActionModel],
        } as unknown as SceneBlock,
      ],
      routes: [
        {
          id: "main",
          match: [{ patterns: ["_"], target: "s" }],
        } as unknown as import("../src/types/turnout-model_pb.js").RouteModel,
      ],
    } as unknown as TurnModel;
    expect(model.state?.namespaces).toHaveLength(1);
    expect(model.routes).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateModel — structural invariant checks
// ─────────────────────────────────────────────────────────────────────────────

describe("validateModel", () => {
  function makeScene(id: string, actions: ActionModel[]): SceneBlock {
    return { id, entryActions: [], actions } as unknown as SceneBlock;
  }

  function makeAction(id: string): ActionModel {
    return { id, next: [], prepare: [], merge: [], publish: [] } as unknown as ActionModel;
  }

  it("returns no errors for a structurally valid model", () => {
    const model = {
      scenes: [makeScene("s1", [makeAction("a"), makeAction("b")])],
    } as unknown as TurnModel;
    expect(validateModel(model)).toHaveLength(0);
  });

  it("returns no errors for a model with no scenes", () => {
    const model = { scenes: [] } as unknown as TurnModel;
    expect(validateModel(model)).toHaveLength(0);
  });

  it("reports duplicate action IDs within a scene", () => {
    const model = {
      scenes: [makeScene("s1", [makeAction("a"), makeAction("a")])],
    } as unknown as TurnModel;
    const errors = validateModel(model);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/duplicate action id "a"/);
  });

  it("reports a binding with neither value nor expr", () => {
    const action = {
      id: "a",
      next: [],
      prepare: [],
      merge: [],
      publish: [],
      compute: {
        prog: { name: "p", bindings: [{ name: "out", type: "bool" }] },
      },
    } as unknown as ActionModel;
    const model = { scenes: [makeScene("s1", [action])] } as unknown as TurnModel;
    const errors = validateModel(model);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/binding "out" has neither value nor expr/);
  });

  it("reports a binding with both value and expr set", () => {
    const action = {
      id: "a",
      next: [],
      prepare: [],
      merge: [],
      publish: [],
      compute: {
        prog: {
          name: "p",
          bindings: [
            {
              name: "out",
              type: "bool",
              value: { kind: { case: "boolValue", value: true } },
              expr: {},
            },
          ],
        },
      },
    } as unknown as ActionModel;
    const model = { scenes: [makeScene("s1", [action])] } as unknown as TurnModel;
    const errors = validateModel(model);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/binding "out" has both value and expr/);
  });

  it("reports a next-rule condition that is not in the prog bindings", () => {
    const action = {
      id: "a",
      next: [
        {
          action: "_done",
          compute: {
            condition: "no_such_binding",
            prog: {
              name: "p",
              bindings: [
                { name: "cond", type: "bool", value: { kind: { case: "boolValue", value: true } } },
              ],
            },
          },
        },
      ],
      prepare: [],
      merge: [],
      publish: [],
    } as unknown as ActionModel;
    const model = { scenes: [makeScene("s1", [action])] } as unknown as TurnModel;
    const errors = validateModel(model);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/condition "no_such_binding" is not declared in prog bindings/);
  });

  it("accepts a next-rule whose condition is declared in its prog", () => {
    const action = {
      id: "a",
      next: [
        {
          action: "_done",
          compute: {
            condition: "cond",
            prog: {
              name: "p",
              bindings: [
                { name: "cond", type: "bool", value: { kind: { case: "boolValue", value: true } } },
              ],
            },
          },
        },
      ],
      prepare: [],
      merge: [],
      publish: [],
    } as unknown as ActionModel;
    const model = { scenes: [makeScene("s1", [action])] } as unknown as TurnModel;
    expect(validateModel(model)).toHaveLength(0);
  });
});

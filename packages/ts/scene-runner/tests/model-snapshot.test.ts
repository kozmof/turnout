import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fromJson } from "@bufbuild/protobuf";
import { isSnapshot, snapshotModel, snapshotRecord } from "../src/model-snapshot.js";
import { createRunner } from "../src/runner.js";
import { TurnModelSchema } from "../src/types/turnout-model_pb.js";
import type { TurnModel } from "../src/types/turnout-model_pb.js";

const here = dirname(fileURLToPath(import.meta.url));

function loadModel(name: string): TurnModel {
  const json: unknown = JSON.parse(readFileSync(resolve(here, "fixtures", name), "utf-8"));
  return fromJson(TurnModelSchema, json as Parameters<typeof fromJson>[1]);
}

describe("snapshotModel", () => {
  it("deep-freezes the clone and leaves the input alone", () => {
    const input = { id: "s", actions: [{ id: "a" }] };
    const snap = snapshotModel(input);

    expect(snap).not.toBe(input);
    expect(snap).toEqual(input);
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.actions)).toBe(true);
    expect(Object.isFrozen(snap.actions[0])).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
  });

  it("is idempotent — re-snapshotting returns the same reference", () => {
    const snap = snapshotModel({ id: "s", actions: [{ id: "a" }] });

    expect(snapshotModel(snap)).toBe(snap);
    // Nested members are owned too, so a caller that reaches into a snapshot and
    // re-snapshots a fragment also pays nothing.
    expect(snapshotModel(snap.actions)).toBe(snap.actions);
    expect(snapshotModel(snap.actions[0])).toBe(snap.actions[0]);
  });

  it("reports ownership only for values it produced", () => {
    const input = { id: "s" };

    expect(isSnapshot(input)).toBe(false);
    expect(isSnapshot(snapshotModel(input))).toBe(true);
    expect(isSnapshot(null)).toBe(false);
    expect(isSnapshot("s")).toBe(false);
  });

  it("still clones a structurally identical but unowned object", () => {
    const snap = snapshotModel({ id: "s" });
    const lookalike = { id: "s" };

    expect(snapshotModel(lookalike)).not.toBe(snap);
    expect(snapshotModel(lookalike)).not.toBe(lookalike);
  });
});

describe("snapshotRecord", () => {
  it("passes owned values through by reference while copying the container", () => {
    const scene = snapshotModel({ id: "s1", actions: [{ id: "a" }] });
    const container = { s1: scene };

    const snap = snapshotRecord(container);

    expect(snap).not.toBe(container);
    expect(snap.s1).toBe(scene);
    expect(Object.isFrozen(snap)).toBe(true);
  });

  it("snapshots values that are not yet owned", () => {
    const raw = { id: "s1", actions: [{ id: "a" }] };

    const snap = snapshotRecord({ s1: raw });

    expect(snap.s1).not.toBe(raw);
    expect(Object.isFrozen(snap.s1)).toBe(true);
  });

  it("is idempotent", () => {
    const snap = snapshotRecord({ s1: { id: "s1" } });
    expect(snapshotRecord(snap)).toBe(snap);
  });
});

// The point of idempotence is not allocation, it is identity. The executor caches
// built contexts in a WeakMap keyed on ProgModel identity, so a second clone inside
// a composed entry point would replace the very keys the cache was warmed with and
// reduce it to a permanent miss. These tests pin the identity the cache observes.
describe("composed entry points preserve model identity", () => {
  const options = {
    entryId: "ai_workflow",
    initialState: {},
    allowUncheckedState: true,
    onWarning: () => {},
  };

  // createRunner snapshots the caller's model exactly once — that clone is the
  // point, since the caller's object is mutable. What must not happen is a second
  // clone as the scene travels on to createSceneRunner and the executor. If one
  // did, the fragments hanging off the executed model would be foreign objects
  // rather than the ones this module owns.
  it("hands the executor the same objects it reports back", async () => {
    const model = loadModel("workflow.json");
    const result = await createRunner(model, options).run();

    expect(result.model.scenes.length).toBeGreaterThan(0);
    for (const scene of result.model.scenes) {
      expect(isSnapshot(scene)).toBe(true);
      expect(snapshotModel(scene)).toBe(scene);

      expect(scene.actions.length).toBeGreaterThan(0);
      for (const action of scene.actions) {
        const prog = action.compute?.prog;
        if (prog) {
          expect(isSnapshot(prog)).toBe(true);
          // The cache key survives the whole composition.
          expect(snapshotModel(prog)).toBe(prog);
        }
      }
    }
  });

  it("does not adopt the caller's model, so later mutation cannot reach it", async () => {
    const model = loadModel("workflow.json");
    const result = await createRunner(model, options).run();

    expect(result.model).not.toBe(model);
    expect(isSnapshot(model)).toBe(false);
    expect(Object.isFrozen(model)).toBe(false);
  });

  it("executes a route model without re-cloning its scene map", async () => {
    const model = loadModel("two-scene-route.json");
    const result = await createRunner(model, {
      ...options,
      entryId: model.routes[0]?.id ?? "",
    }).run();

    expect(result.trace.kind).toBe("route");
    for (const scene of result.model.scenes) {
      expect(snapshotModel(scene)).toBe(scene);
    }
  });
});

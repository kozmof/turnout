import { describe, expect, it } from "vitest";
import { createRouteStepper } from "../src/executor/route-stepper.js";
import { parseMatchArms } from "../src/executor/route-pattern.js";
import { stateManagerFromUnchecked } from "../src/state/state-manager.js";
import type { SceneBlock } from "../src/types/turnout-model_pb.js";

function scene(
  id: string,
  entry: string,
  next?: SceneBlock["actions"][number]["next"],
): SceneBlock {
  return {
    id,
    entryActions: [entry],
    actions: [{ id: entry, next }],
  } as unknown as SceneBlock;
}

function sceneMap(...scenes: SceneBlock[]): Record<string, SceneBlock> {
  return Object.fromEntries(scenes.map((s) => [s.id, s]));
}

describe("createRouteStepper", () => {
  it("steps through scenes, tracks current scene, and returns a result only after completion", async () => {
    const s1 = scene("s1", "a");
    const s2 = scene("s2", "b");
    const stepper = createRouteStepper(
      "route1",
      parseMatchArms([{ patterns: ["s1.a"], target: "s2" }] as any),
      "s1",
      sceneMap(s1, s2),
      stateManagerFromUnchecked({}),
      { prepare: {}, publish: {} },
    );

    expect(stepper.currentSceneId()).toBe("s1");
    expect(() => stepper.result()).toThrow("result() called before execution is complete");

    const first = await stepper.next();
    expect(first).toMatchObject({ done: false, sceneId: "s1" });

    const second = await stepper.next();
    expect(second).toMatchObject({ done: false, sceneId: "s2" });
    expect(stepper.currentSceneId()).toBe("s2");
    expect(stepper.isDone()).toBe(true);
    expect(stepper.result().trace.scenes.map((trace) => trace.sceneId)).toEqual(["s1", "s2"]);
  });

  it("exposes partial state after completed actions within an active scene", async () => {
    const s1 = {
      id: "s1",
      entryActions: ["a"],
      actions: [
        {
          id: "a",
          compute: {
            root: "out",
            prog: {
              name: "p",
              bindings: [
                { name: "v", type: "number", value: 7 },
                {
                  name: "out",
                  type: "number",
                  expr: { combine: { fn: "add", args: [{ ref: "v" }, { lit: 0 }] } },
                },
              ],
            },
          },
          merge: [{ binding: "out", toState: "route.value" }],
          next: [{ action: "b" }],
        },
        { id: "b" },
      ],
    } as unknown as SceneBlock;
    const stepper = createRouteStepper(
      "route_state",
      parseMatchArms([]),
      "s1",
      sceneMap(s1),
      stateManagerFromUnchecked({}),
      { prepare: {}, publish: {} },
    );

    await stepper.next();

    expect(stepper.isDone()).toBe(false);
    expect(stepper.partialState().read("route.value")).toMatchObject({
      symbol: "number",
      value: 7,
    });
  });

  it("rejects missing entry and transition scenes", async () => {
    expect(() =>
      createRouteStepper(
        "missing_entry",
        parseMatchArms([]),
        "missing",
        {},
        stateManagerFromUnchecked({}),
        { prepare: {}, publish: {} },
      ),
    ).toThrow('entry scene "missing" not found');

    const s1 = scene("s1", "a");
    const stepper = createRouteStepper(
      "missing_next",
      parseMatchArms([{ patterns: ["s1.a"], target: "missing" }] as any),
      "s1",
      sceneMap(s1),
      stateManagerFromUnchecked({}),
      { prepare: {}, publish: {} },
    );

    await expect(() => stepper.next()).rejects.toThrow('unknown scene "missing"');
  });

  it("rejects scenes with no entry action and max route transition overflow", async () => {
    expect(() =>
      createRouteStepper(
        "no_entry",
        parseMatchArms([]),
        "s1",
        { s1: { id: "s1", entryActions: [], actions: [] } as unknown as SceneBlock },
        stateManagerFromUnchecked({}),
        { prepare: {}, publish: {} },
      ),
    ).toThrow("has no entry actions");

    const s1 = scene("s1", "a");
    const s2 = scene("s2", "b");
    const stepper = createRouteStepper(
      "overflow",
      parseMatchArms([{ patterns: ["s1.a"], target: "s2" }] as any),
      "s1",
      sceneMap(s1, s2),
      stateManagerFromUnchecked({}),
      { prepare: {}, publish: {} },
      undefined,
      0,
    );

    await expect(() => stepper.next()).rejects.toThrow("exceeded 0 scene transitions");
  });

  it("permits exactly maxRouteTransitions transitions before throwing", async () => {
    // maxTransitions: 1 must allow one transition (s1 → s2) and then complete,
    // not reject the first transition (off-by-one regression guard).
    const s1 = scene("s1", "a");
    const s2 = scene("s2", "b");
    const stepper = createRouteStepper(
      "boundary_one_ok",
      parseMatchArms([{ patterns: ["s1.a"], target: "s2" }] as any),
      "s1",
      sceneMap(s1, s2),
      stateManagerFromUnchecked({}),
      { prepare: {}, publish: {} },
      undefined,
      1,
    );

    expect((await stepper.next()).done).toBe(false); // s1.a
    expect((await stepper.next()).done).toBe(false); // s2.b (after the one transition)
    expect(stepper.isDone()).toBe(true);
    expect(stepper.result().trace.scenes.map((t) => t.sceneId)).toEqual(["s1", "s2"]);
  });

  it("throws once a route exceeds maxRouteTransitions", async () => {
    // A two-way loop needs a second transition (s2 → s1), which exceeds max: 1.
    const s1 = scene("s1", "a");
    const s2 = scene("s2", "b");
    const stepper = createRouteStepper(
      "boundary_one_overflow",
      parseMatchArms([
        { patterns: ["s1.a"], target: "s2" },
        { patterns: ["s2.b"], target: "s1" },
      ] as any),
      "s1",
      sceneMap(s1, s2),
      stateManagerFromUnchecked({}),
      { prepare: {}, publish: {} },
      undefined,
      1,
    );

    // s1.a (transition 1 → s2) then s2.b triggers transition 2, which throws.
    await expect(async () => {
      await stepper.next();
      await stepper.next();
    }).rejects.toThrow("exceeded 1 scene transitions");
  });
});

describe("createRouteStepper — logging and terminal stability", () => {
  it("ignores lifecycle logger failures and remains idempotent after completion", async () => {
    const s1 = scene("s1", "a");
    const s2 = scene("s2", "b");
    const stepper = createRouteStepper(
      "stable_route",
      parseMatchArms([{ patterns: ["s1.a"], target: "s2" }] as any),
      "s1",
      sceneMap(s1, s2),
      stateManagerFromUnchecked({}),
      { prepare: {}, publish: {} },
      undefined,
      undefined,
      undefined,
      () => {
        throw new Error("logging sink failed");
      },
    );

    expect((await stepper.next()).done).toBe(false);
    expect((await stepper.next()).done).toBe(false);
    expect(stepper.isDone()).toBe(true);

    expect(await stepper.next()).toEqual({ done: true });
    expect(await stepper.next()).toEqual({ done: true });
    expect(stepper.result().trace.scenes.map((trace) => trace.sceneId)).toEqual(["s1", "s2"]);
  });
});

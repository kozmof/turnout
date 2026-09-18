import { describe, it, expect } from "vitest";
import { createRunner } from "../src/runner.js";
import { PrepareError } from "../src/errors.js";
import type { RouteModel, SceneBlock, TurnModel } from "../src/types/turnout-model_pb.js";

/**
 * A scene whose single action writes `value` to `toState` and then stops.
 *
 * Scenes arriving from an extend hook are ordinary scenes; nothing about them
 * says they were merged in rather than compiled in, which is the point.
 */
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

/** The scene the run starts in: it declares an extend hook and nothing else. */
function loaderScene(hooks: string[]): SceneBlock {
  return {
    id: "loader",
    entryAction: "load",
    actions: [
      {
        id: "load",
        extend: hooks,
        compute: {
          root: "ready",
          prog: { name: "p", bindings: [{ name: "ready", type: "bool", value: true }] },
        },
      },
    ],
  } as unknown as SceneBlock;
}

/**
 * A route whose only arm targets a scene the base model does not contain. It is
 * dead until an extend hook brings that scene in.
 */
function routeTo(target: string): RouteModel {
  return {
    id: "r",
    entrySceneId: "loader",
    match: [{ patterns: ["loader.load"], target }],
  } as unknown as RouteModel;
}

function baseModel(hooks: string[], routes: RouteModel[] = []): TurnModel {
  return {
    version: 2,
    minVersion: 0,
    maxVersion: 0,
    scenes: [loaderScene(hooks)],
    routes,
  } as unknown as TurnModel;
}

function arrivingModel(scenes: SceneBlock[]): TurnModel {
  return { version: 2, minVersion: 0, maxVersion: 0, scenes, routes: [] } as unknown as TurnModel;
}

const options = { entryId: "r", initialState: {}, allowUncheckedState: true } as const;

describe("extend hooks", () => {
  it("merges a model mid-run and reaches a scene the run did not start with", async () => {
    const result = await createRunner(baseModel(["plugins"], [routeTo("arrived")]), options)
      .useExtendHook("plugins", () => arrivingModel([scene("arrived", "score", 7)]))
      .run();

    // The route arm named "arrived" when no such scene existed. It went live
    // when the hook brought the scene in, which is what merging mid-run is for.
    expect(result.finalState.score).toMatchObject({ value: 7 });
  });

  it("merges several models from one hook, and from several hooks", async () => {
    const fromList = await createRunner(baseModel(["plugins"], [routeTo("arrived")]), options)
      .useExtendHook("plugins", () => [
        arrivingModel([scene("arrived", "score", 1)]),
        arrivingModel([scene("other", "unused", 2)]),
      ])
      .run();
    expect(fromList.finalState.score).toMatchObject({ value: 1 });

    const fromHooks = await createRunner(
      baseModel(["first", "second"], [routeTo("arrived")]),
      options,
    )
      .useExtendHook("first", () => arrivingModel([scene("arrived", "score", 3)]))
      .useExtendHook("second", () => arrivingModel([scene("other", "unused", 4)]))
      .run();
    expect(fromHooks.finalState.score).toMatchObject({ value: 3 });
  });

  it("awaits an async hook before the action runs", async () => {
    const result = await createRunner(baseModel(["plugins"], [routeTo("arrived")]), options)
      .useExtendHook("plugins", async () => {
        await Promise.resolve();
        return arrivingModel([scene("arrived", "score", 9)]);
      })
      .run();

    expect(result.finalState.score).toMatchObject({ value: 9 });
  });

  it("names the action and hook it is called for", async () => {
    const seen: Array<{ actionId: string; hookName: string }> = [];
    await createRunner(baseModel(["plugins"], [routeTo("arrived")]), options)
      .useExtendHook("plugins", (ctx) => {
        seen.push({ actionId: ctx.actionId, hookName: ctx.hookName });
        return arrivingModel([scene("arrived", "score", 1)]);
      })
      .run();

    expect(seen).toEqual([{ actionId: "load", hookName: "plugins" }]);
  });

  it("rejects a returned model that collides with the running one", async () => {
    const runner = createRunner(baseModel(["plugins"]), {
      ...options,
      entryId: "loader",
    }).useExtendHook("plugins", () => arrivingModel([scene("loader", "score", 1)]));

    // Redeclaring the scene the run is inside has no defensible winner, so it
    // fails rather than overriding. The message names the running model and the
    // hook the other declaration came from.
    await expect(runner.run()).rejects.toThrow(/scene "loader" is declared by model and plugins/);
  });

  it("fails the action when the hook is not registered", async () => {
    const runner = createRunner(baseModel(["plugins"]), { ...options, entryId: "loader" });

    await expect(runner.run()).rejects.toThrow(PrepareError);
    await expect(
      createRunner(baseModel(["plugins"]), { ...options, entryId: "loader" }).run(),
    ).rejects.toThrow(/extend hook "plugins" is not registered/);
  });

  it("surfaces what the hook threw", async () => {
    const runner = createRunner(baseModel(["plugins"]), {
      ...options,
      entryId: "loader",
    }).useExtendHook("plugins", () => {
      throw new Error("registry unreachable");
    });

    await expect(runner.run()).rejects.toThrow("registry unreachable");
  });

  it("rejects a hook that returns something other than a model", async () => {
    const runner = createRunner(baseModel(["plugins"]), {
      ...options,
      entryId: "loader",
    }).useExtendHook("plugins", () => "not a model" as unknown as TurnModel);

    await expect(runner.run()).rejects.toThrow(/returned something that is not a model/);
  });

  it("leaves an action without an extend block alone", async () => {
    const result = await createRunner(
      { ...baseModel([]), scenes: [scene("plain", "score", 5)] } as TurnModel,
      { ...options, entryId: "plain" },
    ).run();

    expect(result.finalState.score).toMatchObject({ value: 5 });
  });
});

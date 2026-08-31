import { readFile } from "node:fs/promises";

await import("../packages/ts/runtime/dist/index.js");
await import("../packages/ts/scene-runner/dist/index.js");
await import("../packages/ts/scene-runner/dist/server/index.js");

const wasm = await readFile(
  new URL("../packages/ts/scene-runner/dist/zig-runtime/turnout-runtime.wasm", import.meta.url),
);
if (wasm.length < 8 || !wasm.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109]))) {
  throw new Error("scene-runner distribution is missing its Zig WASM module");
}
const { fromJson } =
  await import("../packages/ts/scene-runner/node_modules/@bufbuild/protobuf/dist/esm/index.js");
const { createRunnerWithEngine } = await import("../packages/ts/scene-runner/dist/runner.js");
const { instantiateZigRuntime } =
  await import("../packages/ts/scene-runner/dist/zig-runtime/client.js");
const { TurnModelSchema } =
  await import("../packages/ts/scene-runner/dist/types/turnout-model_pb.js");

const client = await instantiateZigRuntime(wasm);
const sceneModel = fromJson(TurnModelSchema, {
  version: 2,
  scenes: [
    {
      id: "main",
      entryAction: "start",
      actions: [
        {
          id: "start",
          compute: {
            root: "result",
            prog: {
              bindings: [{ name: "result", type: "number", value: 7 }],
            },
          },
          merge: [{ binding: "result", toState: "score" }],
        },
      ],
    },
  ],
  routes: [],
});
const sceneResult = await createRunnerWithEngine(
  sceneModel,
  { entryId: "main", initialState: {}, allowUncheckedState: true },
  { kind: "zig", client },
).run();
if (sceneResult.finalState.score?.symbol !== "number" || sceneResult.finalState.score.value !== 7) {
  throw new Error("packaged Zig scene runner returned the wrong STATE");
}

const routeModel = fromJson(TurnModelSchema, {
  version: 2,
  scenes: [
    { id: "one", entryAction: "a", actions: [{ id: "a" }] },
    { id: "two", entryAction: "b", actions: [{ id: "b" }] },
  ],
  routes: [
    {
      id: "route",
      entrySceneId: "one",
      match: [{ patterns: ["one.a"], target: "two" }],
    },
  ],
});
const routeResult = await createRunnerWithEngine(
  routeModel,
  { entryId: "route", initialState: {}, allowUncheckedState: true },
  { kind: "zig", client },
).run();
if (
  routeResult.trace.kind !== "route" ||
  routeResult.trace.route.scenes.map((scene) => scene.sceneId).join(",") !== "one,two"
) {
  throw new Error("packaged Zig route runner returned the wrong trace");
}

console.log("dist smoke imports and Zig execution passed");

import { readFile, stat } from "node:fs/promises";

const staleExecutor = new URL("../packages/ts/scene-runner/dist/executor/", import.meta.url);
if (
  await stat(staleExecutor).then(
    () => true,
    () => false,
  )
) {
  throw new Error("scene-runner distribution contains the removed TypeScript executor");
}

const publicApi = await import("../packages/ts/scene-runner/dist/index.js");
const serverApi = await import("../packages/ts/scene-runner/dist/server/index.js");
const { fromJson } =
  await import("../packages/ts/scene-runner/node_modules/@bufbuild/protobuf/dist/esm/index.js");
const { TurnModelSchema } =
  await import("../packages/ts/scene-runner/dist/types/turnout-model_pb.js");

const wasm = await readFile(
  new URL("../packages/ts/scene-runner/dist/zig-runtime/turnout-runtime.wasm", import.meta.url),
);
if (wasm.length < 8 || !wasm.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109]))) {
  throw new Error("scene-runner distribution is missing its Zig WASM module");
}

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
            prog: { bindings: [{ name: "result", type: "number", value: 7 }] },
          },
          merge: [{ binding: "result", toState: "score" }],
        },
      ],
    },
  ],
  routes: [],
});
const sceneResult = await publicApi.runHarness({
  model: sceneModel,
  entryId: "main",
  initialState: {},
  allowUncheckedState: true,
});
if (sceneResult.finalState.score?.symbol !== "number" || sceneResult.finalState.score.value !== 7) {
  throw new Error("packaged Zig scene runner returned the wrong STATE");
}

const runnerResult = await publicApi
  .createRunner(sceneModel, {
    entryId: "main",
    initialState: {},
    allowUncheckedState: true,
  })
  .run();
if (runnerResult.trace.kind !== "scene") {
  throw new Error("packaged public Runner returned the wrong trace kind");
}

const hookModel = fromJson(TurnModelSchema, {
  version: 2,
  scenes: [
    {
      id: "hooks",
      entryAction: "start",
      actions: [
        {
          id: "start",
          prepare: [{ binding: "input", fromHook: "load" }],
          compute: {
            root: "input",
            prog: { bindings: [{ name: "input", type: "number", value: 0 }] },
          },
          publish: ["save"],
        },
      ],
    },
  ],
  routes: [],
});
let published = false;
const hookRunner = publicApi.createRunner(hookModel, {
  entryId: "hooks",
  initialState: {},
  allowUncheckedState: true,
});
hookRunner.usePrepareHook("load", () => ({ input: { symbol: "number", value: 3, tags: [] } }));
hookRunner.usePublishHook("save", () => {
  published = true;
});
await hookRunner.run();
if (!published) throw new Error("packaged Zig runner did not invoke hooks");

const routeResult = await serverApi.runServerHarness({
  jsonFile: new URL(
    "../packages/ts/scene-runner/tests/fixtures/two-scene-route.json",
    import.meta.url,
  ).pathname,
  entryId: "main_route",
  initialState: {},
});
if (
  routeResult.trace.kind !== "route" ||
  routeResult.trace.route.scenes.map((scene) => scene.sceneId).join(",") !== "scene_a,scene_b"
) {
  throw new Error("packaged Zig server harness returned the wrong route trace");
}

console.log("dist smoke imports and Zig execution passed");

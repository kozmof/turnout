import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

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
const { runHarnessWithEngine } =
  await import("../packages/ts/scene-runner/dist/harness/harness.js");
const { runServerHarnessWithEngine } =
  await import("../packages/ts/scene-runner/dist/server/harness.js");
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
const sceneResult = await runHarnessWithEngine(
  {
    model: sceneModel,
    entryId: "main",
    initialState: {},
    allowUncheckedState: true,
  },
  { kind: "zig", client },
);
if (sceneResult.finalState.score?.symbol !== "number" || sceneResult.finalState.score.value !== 7) {
  throw new Error("packaged Zig scene runner returned the wrong STATE");
}
const sceneReference = await runHarnessWithEngine(
  {
    model: sceneModel,
    entryId: "main",
    initialState: {},
    allowUncheckedState: true,
  },
  { kind: "typescript" },
);
if (!isDeepStrictEqual(withoutModel(sceneResult), withoutModel(sceneReference))) {
  throw new Error("packaged Zig scene runner differs from the TypeScript result");
}

const routeResult = await runServerHarnessWithEngine(
  {
    jsonFile: new URL(
      "../packages/ts/scene-runner/tests/fixtures/two-scene-route.json",
      import.meta.url,
    ).pathname,
    entryId: "main_route",
    initialState: {},
  },
  { kind: "zig", client },
);
if (
  routeResult.trace.kind !== "route" ||
  routeResult.trace.route.scenes.map((scene) => scene.sceneId).join(",") !== "scene_a,scene_b"
) {
  throw new Error("packaged Zig route runner returned the wrong trace");
}
const routeReference = await runServerHarnessWithEngine(
  {
    jsonFile: new URL(
      "../packages/ts/scene-runner/tests/fixtures/two-scene-route.json",
      import.meta.url,
    ).pathname,
    entryId: "main_route",
    initialState: {},
  },
  { kind: "typescript" },
);
if (!isDeepStrictEqual(withoutModel(routeResult), withoutModel(routeReference))) {
  throw new Error("packaged Zig route runner differs from the TypeScript result");
}

const fixtureNames = ["scene-graph.json", "workflow.json", "two-scene-route.json"];
for (const fixtureName of fixtureNames) {
  const jsonFile = new URL(
    `../packages/ts/scene-runner/tests/fixtures/${fixtureName}`,
    import.meta.url,
  ).pathname;
  const fixture = JSON.parse(await readFile(jsonFile, "utf8"));
  const entryIds = [
    ...(fixture.scenes ?? []).map((scene) => scene.id),
    ...(fixture.routes ?? []).map((route) => route.id),
  ];
  for (const entryId of entryIds) {
    const referenceLogs = [];
    const candidateLogs = [];
    const reference = await runServerHarnessWithEngine(
      { jsonFile, entryId, initialState: {}, onLog: (event) => referenceLogs.push(event) },
      { kind: "typescript" },
    );
    const candidate = await runServerHarnessWithEngine(
      { jsonFile, entryId, initialState: {}, onLog: (event) => candidateLogs.push(event) },
      { kind: "zig", client },
    );
    if (!isDeepStrictEqual(withoutModel(candidate), withoutModel(reference))) {
      throw new Error(`packaged Zig result differs for ${fixtureName} entry ${entryId}`);
    }
    if (!isDeepStrictEqual(candidateLogs, referenceLogs)) {
      throw new Error(`packaged Zig logs differ for ${fixtureName} entry ${entryId}:
TS ${JSON.stringify(referenceLogs)}
Zig ${JSON.stringify(candidateLogs)}`);
    }
  }
}

function withoutModel(result) {
  const { model: _model, ...comparable } = result;
  return comparable;
}

console.log("dist smoke imports and Zig execution passed");

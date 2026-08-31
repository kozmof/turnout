import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

const { buildNumber } = await import("../packages/ts/runtime/dist/index.js");
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

const stepModel = fromJson(TurnModelSchema, {
  version: 2,
  scenes: [
    {
      id: "steps",
      entryAction: "first",
      actions: [
        {
          id: "first",
          compute: {
            root: "value",
            prog: { bindings: [{ name: "value", type: "number", value: 1 }] },
          },
          merge: [{ binding: "value", toState: "score" }],
          next: [{ action: "second" }],
        },
        {
          id: "second",
          compute: {
            root: "value",
            prog: { bindings: [{ name: "value", type: "number", value: 2 }] },
          },
          merge: [{ binding: "value", toState: "score" }],
        },
      ],
    },
  ],
  routes: [],
});
const runnerOptions = {
  entryId: "steps",
  initialState: {},
  allowUncheckedState: true,
};
const referenceRunner = createRunnerWithEngine(stepModel, runnerOptions, { kind: "typescript" });
const candidateRunner = createRunnerWithEngine(stepModel, runnerOptions, { kind: "zig", client });
for (const runner of [referenceRunner, candidateRunner]) {
  try {
    runner.result();
    throw new Error("incomplete Runner result unexpectedly succeeded");
  } catch (error) {
    if (error?.code !== "IncompleteExecution") throw error;
  }
}
assertSame(
  candidateRunner.partialState().snapshot(),
  referenceRunner.partialState().snapshot(),
  "initial partial STATE",
);
assertSame(await candidateRunner.next(1), await referenceRunner.next(1), "first next(1) result");
assertSame(
  candidateRunner.partialState().snapshot(),
  referenceRunner.partialState().snapshot(),
  "partial STATE after first action",
);
assertSame(await candidateRunner.next(1), await referenceRunner.next(1), "second next(1) result");
assertSame(candidateRunner.isDone(), referenceRunner.isDone(), "final isDone");
assertSame(
  withoutModel(candidateRunner.result()),
  withoutModel(referenceRunner.result()),
  "final Runner result",
);

const limitedOptions = { ...runnerOptions, maxSceneSteps: 1 };
const limitedReference = createRunnerWithEngine(stepModel, limitedOptions, { kind: "typescript" });
const limitedCandidate = createRunnerWithEngine(stepModel, limitedOptions, { kind: "zig", client });
const referenceLimitError = await captureError(() => limitedReference.run());
const candidateLimitError = await captureError(() => limitedCandidate.run());
assertSame(
  errorShape(candidateLimitError),
  errorShape(referenceLimitError),
  "execution-limit error",
);

const routeLimitFile = new URL(
  "../packages/ts/scene-runner/tests/fixtures/two-scene-route.json",
  import.meta.url,
).pathname;
const routeLimitOptions = {
  jsonFile: routeLimitFile,
  entryId: "main_route",
  initialState: {},
  maxRouteTransitions: 0,
};
const referenceRouteLimitError = await captureError(() =>
  runServerHarnessWithEngine(routeLimitOptions, { kind: "typescript" }),
);
const candidateRouteLimitError = await captureError(() =>
  runServerHarnessWithEngine(routeLimitOptions, { kind: "zig", client }),
);
assertSame(
  errorShape(candidateRouteLimitError),
  errorShape(referenceRouteLimitError),
  "route execution-limit error",
);

const hookModel = fromJson(TurnModelSchema, {
  version: 2,
  scenes: [
    {
      id: "hooks",
      entryAction: "load",
      actions: [
        {
          id: "load",
          prepare: [{ binding: "input", fromHook: "load_value" }],
          compute: {
            root: "input",
            prog: { bindings: [{ name: "input", type: "number", value: 0 }] },
          },
          publish: ["save_value"],
        },
      ],
    },
  ],
  routes: [],
});
const hookOptions = { entryId: "hooks", initialState: {}, allowUncheckedState: true };
const hookReference = createRunnerWithEngine(hookModel, hookOptions, { kind: "typescript" });
const hookCandidate = createRunnerWithEngine(hookModel, hookOptions, { kind: "zig", client });
for (const runner of [hookReference, hookCandidate]) {
  runner.usePrepareHook("load_value", async () => ({ input: buildNumber(5) }));
  runner.usePublishHook("save_value", async () => {});
}
const referenceEvents = [];
for await (const event of hookReference.runAsync()) referenceEvents.push(event);
const candidateEvents = [];
for await (const event of hookCandidate.runAsync()) candidateEvents.push(event);
assertSame(candidateEvents, referenceEvents, "runAsync hook events");
assertSame(
  withoutModel(hookCandidate.result()),
  withoutModel(hookReference.result()),
  "hook Runner result",
);

const failedPublishReference = createRunnerWithEngine(hookModel, hookOptions, {
  kind: "typescript",
});
const failedPublishCandidate = createRunnerWithEngine(hookModel, hookOptions, {
  kind: "zig",
  client,
});
for (const runner of [failedPublishReference, failedPublishCandidate]) {
  runner.usePrepareHook("load_value", async () => ({ input: buildNumber(5) }));
  runner.usePublishHook("save_value", async () => ({
    hookName: "save_value",
    status: "error",
    message: "save rejected",
  }));
}
assertSame(
  withoutModel(await failedPublishCandidate.run()),
  withoutModel(await failedPublishReference.run()),
  "failed publish outcome",
);

const missingPrepareReference = createRunnerWithEngine(hookModel, hookOptions, {
  kind: "typescript",
});
const missingPrepareCandidate = createRunnerWithEngine(hookModel, hookOptions, {
  kind: "zig",
  client,
});
assertSame(
  errorShape(await captureError(() => missingPrepareCandidate.run())),
  errorShape(await captureError(() => missingPrepareReference.run())),
  "missing prepare-hook error",
);

const thrownPrepareReference = createRunnerWithEngine(hookModel, hookOptions, {
  kind: "typescript",
});
const thrownPrepareCandidate = createRunnerWithEngine(hookModel, hookOptions, {
  kind: "zig",
  client,
});
for (const runner of [thrownPrepareReference, thrownPrepareCandidate]) {
  runner.usePrepareHook("load_value", async () => {
    throw new Error("load rejected");
  });
}
assertSame(
  errorShape(await captureError(() => thrownPrepareCandidate.run())),
  errorShape(await captureError(() => thrownPrepareReference.run())),
  "thrown prepare-hook error",
);

for (const invalidResult of [{ other: buildNumber(1) }, { input: 42 }]) {
  const invalidPrepareReference = createRunnerWithEngine(hookModel, hookOptions, {
    kind: "typescript",
  });
  const invalidPrepareCandidate = createRunnerWithEngine(hookModel, hookOptions, {
    kind: "zig",
    client,
  });
  for (const runner of [invalidPrepareReference, invalidPrepareCandidate]) {
    runner.usePrepareHook("load_value", async () => invalidResult);
  }
  assertSame(
    errorShape(await captureError(() => invalidPrepareCandidate.run())),
    errorShape(await captureError(() => invalidPrepareReference.run())),
    "invalid prepare-hook error",
  );
}

const strictPublishOptions = { ...hookOptions, failOnPublishError: true };
const strictPublishReference = createRunnerWithEngine(hookModel, strictPublishOptions, {
  kind: "typescript",
});
const strictPublishCandidate = createRunnerWithEngine(hookModel, strictPublishOptions, {
  kind: "zig",
  client,
});
for (const runner of [strictPublishReference, strictPublishCandidate]) {
  runner.usePrepareHook("load_value", async () => ({ input: buildNumber(5) }));
  runner.usePublishHook("save_value", async () => ({
    hookName: "save_value",
    status: "error",
    message: "save rejected",
  }));
}
const strictPublishReferenceError = await captureError(() => strictPublishReference.run());
const strictPublishCandidateError = await captureError(() => strictPublishCandidate.run());
assertSame(
  publishErrorShape(strictPublishCandidateError),
  publishErrorShape(strictPublishReferenceError),
  "strict publish error",
);
assertSame(
  strictPublishCandidate.partialState().snapshot(),
  strictPublishReference.partialState().snapshot(),
  "strict publish partial state",
);

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

async function captureError(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error("expected operation to fail");
}

function errorShape(error) {
  return {
    name: error?.name,
    code: error?.code,
    message: error?.message,
    sceneId: error?.sceneId,
    routeId: error?.routeId,
    context: error?.context,
  };
}

function publishErrorShape(error) {
  return {
    ...errorShape(error),
    stateAfterMerge: error?.stateAfterMerge?.snapshot(),
    publishOutcomes: error?.publishOutcomes,
  };
}

function assertSame(candidate, reference, label) {
  if (!isDeepStrictEqual(candidate, reference)) {
    throw new Error(`packaged Zig ${label} differs from TypeScript:
TS ${JSON.stringify(reference)}
Zig ${JSON.stringify(candidate)}`);
  }
}

function withoutModel(result) {
  const { model: _model, ...comparable } = result;
  return comparable;
}

console.log("dist smoke imports and Zig execution passed");

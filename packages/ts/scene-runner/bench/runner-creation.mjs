// Where creating a runner spends its time.
//
// Not a gate. It exists because this repository has twice optimised the wrong
// thing — see todo/zig-architecture-redesign.md step 8 — and the defence is a
// benchmark anyone can re-run before proposing the next fix.
//
// Run it against the built package:
//
//     cd packages/ts/scene-runner && pnpm run build && node bench/runner-creation.mjs
//
// The workload matches packages/zig/docs/performance-baseline.md: 1,000 runners
// over one 20-action scene, three bindings per action, creation and decoding
// included.
import { fromJson } from "@bufbuild/protobuf";
import { buildNumber } from "runtime";
import { defaultZigRuntimeClient } from "../dist/zig-runtime/default-client.js";
import { createRunner, prepareModel } from "../dist/index.js";
import { encodeZigRuntimeModel } from "../dist/model-encoding.js";
import { migrateModel } from "../dist/migration.js";
import { snapshotModel } from "../dist/model-snapshot.js";
import { TurnModelSchema } from "../dist/types/turnout-model_pb.js";
import { validateModel } from "../dist/validate-model.js";

const ACTIONS = 20;
const ITERATIONS = 1000;
const WARMUP = 50;

function benchModel(actionCount) {
  const actions = [];
  for (let index = 0; index < actionCount; index++) {
    actions.push({
      id: `a${index}`,
      compute: {
        root: "out",
        prog: {
          name: `p${index}`,
          bindings: [
            { name: "seed", type: "number", value: 1 },
            {
              name: "mid",
              type: "number",
              expr: { combine: { fn: "add", args: [{ ref: "seed" }, { lit: 2 }] } },
            },
            {
              name: "out",
              type: "number",
              expr: { combine: { fn: "mul", args: [{ ref: "mid" }, { lit: 3 }] } },
            },
          ],
        },
      },
      merge: [{ binding: "out", toState: "bench.total" }],
      next: index + 1 < actionCount ? [{ action: `a${index + 1}` }] : [],
    });
  }
  return {
    version: 2,
    minVersion: 2,
    maxVersion: 2,
    state: {
      namespaces: [{ name: "bench", fields: [{ name: "total", type: "number", value: 0 }] }],
    },
    scenes: [{ id: "bench", entryAction: "a0", actions }],
    routes: [],
  };
}

async function time(label, fn) {
  for (let index = 0; index < WARMUP; index++) await fn();
  const start = process.hrtime.bigint();
  for (let index = 0; index < ITERATIONS; index++) await fn();
  const micros = Number(process.hrtime.bigint() - start) / 1000 / ITERATIONS;
  console.log(`${label.padEnd(42)} ${micros.toFixed(1).padStart(7)} us`);
  return micros;
}

const model = fromJson(TurnModelSchema, benchModel(ACTIONS), { ignoreUnknownFields: true });
const options = () => ({ entryId: "bench", initialState: { "bench.total": buildNumber(0) } });
const bytes = encodeZigRuntimeModel(model);
const request = { sceneId: "bench", initialState: {} };

console.log(`${ACTIONS}-action scene, ${ITERATIONS} iterations\n`);
const unprepared = await time("createRunner + run, unprepared", async () => {
  await createRunner(model, options()).run();
});
const prepared = prepareModel(model);
const withPrepared = await time("createRunner + run, prepared", async () => {
  await createRunner(prepared, options()).run();
});
prepared.release();

console.log("\ncreation, broken down");
const creation = await time("createRunner, unprepared", () => {
  createRunner(model, options());
});
await time("  snapshotModel (defensive deep clone)", () => {
  snapshotModel(model);
});
await time("  migrateModel (includes a snapshot)", () => {
  migrateModel(snapshotModel(model));
});
await time("  validateModel", () => {
  validateModel(model);
});
await time("  encodeZigRuntimeModel", () => {
  encodeZigRuntimeModel(model);
});
await time("  engine create from bytes", () => {
  const created = defaultZigRuntimeClient.create(bytes, request);
  defaultZigRuntimeClient.destroy(created.payload.handle);
});

const handle = defaultZigRuntimeClient.prepareModel(bytes).payload.handle;
await time("  engine create from prepared handle", () => {
  const created = defaultZigRuntimeClient.createWithModel(handle, request);
  defaultZigRuntimeClient.destroy(created.payload.handle);
});
defaultZigRuntimeClient.destroyModel(handle);

console.log(
  `\nruns/s: ${(1e6 / unprepared).toFixed(0)} unprepared, ` +
    `${(1e6 / withPrepared).toFixed(0)} prepared`,
);
console.log(
  `us/action: ${(unprepared / ACTIONS).toFixed(1)} unprepared, ` +
    `${(withPrepared / ACTIONS).toFixed(1)} prepared`,
);
console.log(`creation is ${((creation / unprepared) * 100).toFixed(0)}% of an unprepared run`);

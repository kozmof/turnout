import { isDeepStrictEqual } from "node:util";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { getHeapStatistics } from "node:v8";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRunnerWithEngine } from "../packages/ts/scene-runner/dist/runner.js";
import { instantiateZigRuntime } from "../packages/ts/scene-runner/dist/zig-runtime/client.js";

const scriptPath = fileURLToPath(import.meta.url);
const engineIndex = process.argv.indexOf("--engine");

if (engineIndex === -1) {
  const results = ["typescript", "zig"].map((engine) => {
    const child = spawnSync(process.execPath, ["--expose-gc", scriptPath, "--engine", engine], {
      encoding: "utf8",
      env: process.env,
    });
    if (child.status !== 0) throw new Error(child.stderr || child.stdout);
    return JSON.parse(child.stdout);
  });
  console.log(
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        warmupRuns: results[0].warmupRuns,
        measuredRuns: results[0].measuredRuns,
        actionsPerRun: results[0].actionsPerRun,
        results,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const engine = process.argv[engineIndex + 1];
if (engine !== "typescript" && engine !== "zig") throw new Error("invalid engine");
const warmupRuns = positiveInteger(process.env.BENCH_WARMUP, 100);
const measuredRuns = positiveInteger(process.env.BENCH_ITERATIONS, 1000);
const actionsPerRun = 20;
const model = benchmarkModel(actionsPerRun);
const zigClient =
  engine === "zig"
    ? await instantiateZigRuntime(
        readFileSync(
          new URL(
            "../packages/ts/scene-runner/dist/zig-runtime/turnout-runtime.wasm",
            import.meta.url,
          ),
        ),
      )
    : undefined;
const selection =
  engine === "typescript" ? { kind: "typescript" } : { kind: "zig", client: zigClient };

async function execute() {
  return createRunnerWithEngine(
    model,
    {
      entryId: "benchmark",
      initialState: {},
      allowUncheckedState: true,
      onWarning: () => {},
    },
    selection,
  ).run();
}

const reference = await execute();
for (let index = 1; index < warmupRuns; index += 1) await execute();
globalThis.gc?.();
const baseline = memorySnapshot(zigClient);
const peak = { ...baseline };
const started = performance.now();
let candidate = reference;
for (let index = 0; index < measuredRuns; index += 1) {
  candidate = await execute();
  if (index % 25 === 0) updatePeak(peak, memorySnapshot(zigClient));
}
const elapsedMs = performance.now() - started;
updatePeak(peak, memorySnapshot(zigClient));
globalThis.gc?.();
const retained = memorySnapshot(zigClient);
if (!isDeepStrictEqual(candidate, reference)) throw new Error("benchmark result drifted");

console.log(
  JSON.stringify({
    engine,
    warmupRuns,
    measuredRuns,
    actionsPerRun,
    elapsedMs,
    runsPerSecond: measuredRuns / (elapsedMs / 1000),
    microsecondsPerAction: (elapsedMs * 1000) / (measuredRuns * actionsPerRun),
    baselineBytes: baseline,
    peakBytes: peak,
    peakDeltaBytes: memoryDelta(peak, baseline),
    retainedDeltaBytes: memoryDelta(retained, baseline),
  }),
);

function positiveInteger(input, fallback) {
  if (input === undefined) return fallback;
  const value = Number(input);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error("benchmark counts must be positive integers");
  return value;
}

function memorySnapshot(client) {
  const heap = getHeapStatistics();
  return {
    usedHeap: heap.used_heap_size,
    totalPhysical: heap.total_physical_size,
    malloced: heap.malloced_memory,
    external: heap.external_memory,
    wasmLinear: client?.memoryByteLength() ?? 0,
  };
}

function updatePeak(currentPeak, current) {
  for (const key of ["usedHeap", "totalPhysical", "malloced", "external", "wasmLinear"]) {
    currentPeak[key] = Math.max(currentPeak[key], current[key]);
  }
}

function memoryDelta(current, initial) {
  return Object.fromEntries(
    ["usedHeap", "totalPhysical", "malloced", "external", "wasmLinear"].map((key) => [
      key,
      current[key] - initial[key],
    ]),
  );
}

function benchmarkModel(actionCount) {
  return {
    version: 2,
    scenes: [
      {
        id: "benchmark",
        entryAction: "action_0",
        actions: Array.from({ length: actionCount }, (_, index) => ({
          id: `action_${index}`,
          compute: {
            root: "result",
            prog: {
              bindings: [
                { name: "left", type: "number", value: index },
                { name: "right", type: "number", value: 1 },
                {
                  name: "result",
                  type: "number",
                  expr: { combine: { fn: "add", args: [{ ref: "left" }, { ref: "right" }] } },
                },
              ],
            },
          },
          next: index + 1 < actionCount ? [{ action: `action_${index + 1}` }] : [],
        })),
      },
    ],
    routes: [],
  };
}

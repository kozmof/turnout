// Runs the shared host conformance vectors against the native host.
//
// The TypeScript host runs the same files from its own test suite. Two hosts,
// one engine, one set of vectors: that is the whole claim `spec/capabilities.json`
// makes, and this is half its evidence.
//
// Requires the host binary — `zig build --build-file packages/zig/build.zig host`.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const host = resolve(root, "packages/zig/zig-out/bin/turnout-run");
const hookProgram = resolve(root, "scripts/native-hook-program.mjs");
const vectorDir = resolve(root, "spec/conformance/host");

const work = mkdtempSync(join(tmpdir(), "turnout-native-"));
let passed = 0;
const failures = [];
const skipped = [];
/** Per capability: whether every vector ran, and whether every one that ran passed. */
const coverage = new Map();

function runVector(vector) {
  const statePath = join(work, "state.json");
  const mismatchPath = join(work, "mismatches.txt");
  writeFileSync(statePath, JSON.stringify(vector.initialState ?? {}));
  writeFileSync(mismatchPath, "");

  const args = [
    "run",
    resolve(root, vector.model),
    vector.entryId === undefined ? "--scene" : entryFlag(vector),
    vector.entryId,
    "--state",
    statePath,
    "--hook-program",
    process.execPath,
    "--hook-arg",
    hookProgram,
    "--hook-arg",
    JSON.stringify(vector),
    "--hook-arg",
    mismatchPath,
  ];

  const stdout = execFileSync(host, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const mismatches = readFileSync(mismatchPath, "utf8").trim();
  if (mismatches.length > 0) throw new Error(mismatches);
  return JSON.parse(stdout);
}

/**
 * Whether the vector's entry names a route, decided by the model rather than by
 * the vector: the vectors are host-agnostic and say only `entryId`, exactly as
 * the TypeScript host's `createRunner` resolves it.
 */
function entryFlag(vector) {
  const model = JSON.parse(readFileSync(resolve(root, vector.model), "utf8"));
  const isRoute = (model.routes ?? []).some((route) => route.id === vector.entryId);
  return isRoute ? "--route" : "--scene";
}

function compare(vector, outcome) {
  const problems = [];
  if (vector.expect.finalState !== undefined) {
    const actual = JSON.stringify(sortKeys(outcome.finalState));
    const expected = JSON.stringify(sortKeys(vector.expect.finalState));
    if (actual !== expected)
      problems.push(`finalState\n  expected ${expected}\n  actual   ${actual}`);
  }
  if (vector.expect.actions !== undefined) {
    const actual = outcome.actions.map((action) => action.actionId);
    const expected = vector.expect.actions.map((action) => action.actionId);
    if (actual.join(",") !== expected.join(",")) {
      problems.push(`actions: expected ${expected.join(",")}, ran ${actual.join(",")}`);
    }
    vector.expect.actions.forEach((expectedAction, index) => {
      if (expectedAction.publishOutcomes === undefined) return;
      const seen = (outcome.actions[index]?.publishOutcomes ?? []).map((outcome_) => ({
        hookName: outcome_.hookName,
        status: outcome_.status,
        ...(outcome_.message === undefined ? {} : { message: outcome_.message }),
      }));
      const want = expectedAction.publishOutcomes;
      if (JSON.stringify(seen) !== JSON.stringify(want)) {
        problems.push(
          `publishOutcomes of ${expectedAction.actionId}\n` +
            `  expected ${JSON.stringify(want)}\n  actual   ${JSON.stringify(seen)}`,
        );
      }
    });
  }
  return problems;
}

function sortKeys(object) {
  return Object.fromEntries(Object.entries(object).toSorted(([a], [b]) => (a < b ? -1 : 1)));
}

for (const file of readdirSync(vectorDir)
  .filter((name) => name.endsWith(".json"))
  .toSorted()) {
  const suite = JSON.parse(readFileSync(join(vectorDir, file), "utf8"));
  for (const vector of suite.vectors) {
    // Error vectors name a code from the TypeScript host's taxonomy, which the
    // engine does not yet share: it raises MissingPrepareHook where the host
    // reports UnregisteredHook. Comparing them would be comparing two
    // vocabularies. Recorded in todo/aligned-runtime-hosts.md as the next gap.
    const capability = coverage.get(suite.capability) ?? { complete: true, passing: true };
    coverage.set(suite.capability, capability);
    if (vector.expect.error !== undefined) {
      skipped.push(`${vector.name} (error taxonomy is not shared yet)`);
      capability.complete = false;
      continue;
    }
    try {
      const problems = compare(vector, runVector(vector));
      if (problems.length === 0) passed += 1;
      else {
        failures.push(`${vector.name}\n  ${problems.join("\n  ")}`);
        capability.passing = false;
      }
    } catch (error) {
      failures.push(`${vector.name}\n  ${String(error.message ?? error).trim()}`);
      capability.passing = false;
    }
  }
}

rmSync(work, { recursive: true, force: true });

/** The status this run actually earned for one capability. */
function earnedStatus(seen) {
  if (seen === undefined) return "planned";
  if (seen.passing) return seen.complete ? "supported" : "partial";
  return "unsupported";
}

// What the manifest claims for this host has to be what just happened. A status
// nobody checks is the failure mode the capability file exists to avoid.
const manifest = JSON.parse(readFileSync(resolve(root, "spec/capabilities.json"), "utf8"));
for (const capability of manifest.capabilities) {
  const claimed = capability.hosts["zig-native"];
  const seen = coverage.get(capability.id);
  const earned = earnedStatus(seen);
  if (claimed !== earned) {
    failures.push(
      `spec/capabilities.json claims zig-native is "${claimed}" for ${capability.id}, ` +
        `but this run earned "${earned}"`,
    );
  }
}

for (const skip of skipped) console.log(`  skipped: ${skip}`);
if (failures.length > 0) {
  console.error(`native conformance: ${failures.length} vector(s) failed\n`);
  for (const failure of failures) console.error(failure + "\n");
  process.exit(1);
}
console.log(`native conformance: ${passed} vectors passed, ${skipped.length} skipped`);

// Ties spec/capabilities.json to the vectors that prove it.
//
// A capability manifest is worth exactly as much as the evidence behind it. On
// its own it is prose in JSON: a row claiming a host supports something, with
// nothing anywhere that fails when it does not. So the rule this enforces is
// that every declared capability owns at least one conformance vector, and
// every vector belongs to a declared capability.
//
// Running the vectors is a host's own job — each host runs them in its own
// language against its own runner. This script checks the wiring between the
// two files, and that every vector names a model that exists.
//
// It also checks the manifest against the engine itself. A row asserting that
// two hosts support something is only as good as the list of somethings, and
// that list was hand-written with nothing tying it to what the engine exposes.
// That is not a hypothetical: `turnout_model_merge` and `event:extend_model`
// were both live and claimed by no capability, so twelve vectors passed on
// both hosts while one of them could not run a documented language feature at
// all. Every export and every event now has to be claimed by someone.
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { abiExports, runnerEvents } from "./engine-surface.mjs";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("spec/capabilities.json", root), "utf8"));
const vectorDir = new URL("spec/conformance/host/", root);

const declared = new Map();
for (const capability of manifest.capabilities) {
  assert(!declared.has(capability.id), `spec/capabilities.json declares "${capability.id}" twice`);
  assert(
    ["engine", "host", "split"].includes(capability.owner),
    `capability "${capability.id}" has an unknown owner "${capability.owner}"`,
  );
  for (const [host, status] of Object.entries(capability.hosts)) {
    assert(
      manifest.hostStatuses.includes(status),
      `capability "${capability.id}" gives host "${host}" the unknown status "${status}"`,
    );
  }
  declared.set(capability.id, { capability, vectors: [] });
}

// ── The manifest against the engine ──────────────────────────────────────────
//
// Claimed by *at least* one capability rather than exactly one: `need_effect`
// genuinely carries prepare, publish and extend, and making each of those name
// it is more honest than inventing one owner.
const engine = {
  exports: await abiExports(root),
  events: await runnerEvents(root),
};

const claimed = { exports: new Set(), events: new Set() };
for (const capability of manifest.capabilities) {
  const surface = capability.engineSurface ?? {};
  for (const kind of ["exports", "events"]) {
    for (const name of surface[kind] ?? []) {
      assert(
        engine[kind].includes(name),
        `capability "${capability.id}" claims ${kind.slice(0, -1)} "${name}", which the engine does not expose`,
      );
      claimed[kind].add(name);
    }
  }
}

for (const name of engine.exports) {
  assert(
    claimed.exports.has(name),
    `export "${name}" is exposed by packages/zig/wasm/src/abi.zig but no capability claims it — ` +
      `add it to a capability's engineSurface.exports, or say which capability it belongs to`,
  );
}
for (const name of engine.events) {
  assert(
    claimed.events.has(name),
    `event "${name}" is emitted by runner.Event but no capability claims it — ` +
      `add it to a capability's engineSurface.events`,
  );
}

const files = (await readdir(vectorDir)).filter((name) => name.endsWith(".json")).toSorted();
assert(files.length > 0, "spec/conformance/host holds no vector files");

const names = new Set();
for (const file of files) {
  const suite = JSON.parse(await readFile(new URL(file, vectorDir), "utf8"));
  const entry = declared.get(suite.capability);
  assert(
    entry,
    `${file} names capability "${suite.capability}", which the manifest does not declare`,
  );
  assert(Array.isArray(suite.vectors) && suite.vectors.length > 0, `${file} declares no vectors`);
  for (const vector of suite.vectors) {
    assert(vector.name, `${file} has a vector with no name`);
    assert(!names.has(vector.name), `vector name "${vector.name}" is used more than once`);
    names.add(vector.name);
    assert(vector.why, `vector "${vector.name}" does not say what it is evidence of`);
    assert(vector.model, `vector "${vector.name}" names no model`);
    const model = new URL(vector.model, root);
    assert(
      (await stat(model).catch(() => null))?.isFile(),
      `vector "${vector.name}" names a model that does not exist: ${vector.model}`,
    );
    assert(vector.expect !== undefined, `vector "${vector.name}" asserts nothing`);
    entry.vectors.push(vector.name);
  }
}

// The rule the manifest exists for: evidence, not assertion. Host vectors are
// the usual form, but some abilities are already pinned somewhere better —
// values, presets and compute have shared vectors run natively and under WASM —
// and pointing at those beats restating them as host vectors that would drift.
for (const [id, entry] of declared) {
  const evidence = entry.capability.evidence ?? [];
  for (const path of evidence) {
    assert(
      (await stat(new URL(path, root)).catch(() => null))?.isFile(),
      `capability "${id}" names evidence that does not exist: ${path}`,
    );
  }
  assert(
    entry.vectors.length > 0 || evidence.length > 0,
    `capability "${id}" has neither a conformance vector nor named evidence; ` +
      `a capability with no evidence is a claim, not a capability`,
  );
}

const supported = manifest.capabilities.flatMap((capability) =>
  Object.entries(capability.hosts)
    .filter(([, status]) => status === "supported")
    .map(([host]) => host),
);
console.log(
  `capabilities: ${declared.size} declared, ${names.size} vectors, ` +
    `${new Set(supported).size} host(s) claiming support; ` +
    `engine surface ${engine.exports.length} exports and ${engine.events.length} events, all claimed`,
);

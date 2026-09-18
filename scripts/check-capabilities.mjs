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
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";

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

// The rule the manifest exists for.
for (const [id, entry] of declared) {
  assert(
    entry.vectors.length > 0,
    `capability "${id}" has no conformance vector; a capability with no evidence is a claim, not a capability`,
  );
}

const supported = manifest.capabilities.flatMap((capability) =>
  Object.entries(capability.hosts)
    .filter(([, status]) => status === "supported")
    .map(([host]) => host),
);
console.log(
  `capabilities: ${declared.size} declared, ${names.size} vectors, ` +
    `${new Set(supported).size} host(s) claiming support`,
);

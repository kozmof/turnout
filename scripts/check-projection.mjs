// Pins spec/runtime-projection.json to the schema it describes.
//
// The projection rule — which model fields are compiler-only and must never
// reach a runtime — is implemented three times: the Go emitter strips them
// (internal/emit/json.go), the TypeScript encoder strips them again
// (model-encoding.ts), and the Zig runtime rejects them on arrival (model.zig).
// All three are gated against this specification by tests that execute them:
// internal/emit/json_projection_spec_test.go for Go, and
// packages/ts/scene-runner/tests/runtime-projection.test.ts for the other two.
//
// What no test can check is the specification itself. A field renamed in
// schema/turnout-model.proto would silently disable a strip rule that no longer
// matches anything, and every one of those tests would still pass. This script
// is that check, and only that check.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const spec = JSON.parse(await readFile(new URL("spec/runtime-projection.json", root), "utf8"));
const proto = await readFile(new URL("schema/turnout-model.proto", root), "utf8");

/** Field names by message, parsed from the proto source. */
function parseProto(source) {
  const messages = new Map();
  let current;
  for (const raw of source.split("\n")) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    const opened = /^message\s+(\w+)\s*\{/.exec(line);
    if (opened) {
      current = new Set();
      messages.set(opened[1], current);
      // A single-line message body declares its fields on the same line.
      if (!line.endsWith("{")) for (const name of fieldNames(line)) current.add(name);
      continue;
    }
    if (current === undefined) continue;
    if (line === "}") {
      current = undefined;
      continue;
    }
    for (const name of fieldNames(line)) current.add(name);
  }
  return messages;
}

/** Field names declared on one proto line, ignoring reserved and oneof headers. */
function fieldNames(line) {
  if (/^reserved\b/.test(line) || /^oneof\s/.test(line)) return [];
  const names = [];
  const pattern =
    /(?:^|\{|;)\s*(?:optional\s+|repeated\s+)?(?:map<[^>]+>|[\w.]+)\s+(\w+)\s*=\s*\d+/g;
  for (const match of line.matchAll(pattern)) names.push(match[1]);
  return names;
}

/** The JSON name protojson emits for a proto field name. */
function jsonName(field) {
  return field.replace(/_(\w)/g, (_, char) => char.toUpperCase());
}

const messages = parseProto(proto);
assert(messages.size > 0, "parsed no messages from schema/turnout-model.proto");

// Every field named in either section must exist in the schema.
for (const entry of spec.compilerOnly) {
  const fields = messages.get(entry.message);
  assert(fields, `compilerOnly names unknown message ${entry.message}`);
  assert(
    fields.has(entry.field),
    `compilerOnly names ${entry.message}.${entry.field}, which the proto does not declare`,
  );
  assert.equal(
    entry.path.split(".").at(-1),
    jsonName(entry.field),
    `compilerOnly path ${entry.path} does not end in the JSON name of ${entry.field}`,
  );
}

for (const [message, fields] of Object.entries(spec.retained)) {
  const declared = messages.get(message);
  assert(declared, `retained names unknown message ${message}`);
  for (const field of fields) {
    assert(
      declared.has(field),
      `retained names ${message}.${field}, which the proto does not declare`,
    );
  }
  for (const entry of spec.compilerOnly) {
    if (entry.message !== message) continue;
    assert(
      !fields.includes(entry.field),
      `${message}.${entry.field} is listed as both retained and compiler-only`,
    );
  }
}

console.log(
  `runtime projection: ${spec.compilerOnly.length} compiler-only fields, ` +
    `${Object.keys(spec.retained).length} retained messages`,
);

// Ties the TypeScript preset façade to the engine's preset table.
//
// `packages/ts/runtime` computes nothing: every preset namespace is a `Proxy`
// over a hand-written list of method names, and calling one crosses into the
// engine (`state-control/preset-funcs/zig-preset.ts`). That list is the only
// part of the arrangement with no mechanism behind it. `spec/fn-aliases.json`
// generates the Zig alias map and is asserted against Go's `fnmeta`, but it
// describes the DSL spellings the compiler emits — not the transforms, and not
// the names only the authoring API reaches for — so it cannot stand in for the
// table.
//
// What that costs, concretely: a preset added in Zig is invisible to
// TypeScript, and one renamed or removed leaves a name that the `Proxy`
// happily resolves and that throws only when someone calls it. The engine
// exposes no "list the presets" operation, so no test could have noticed
// either. Parsing the table is what is available, and it is enough.
//
// Found on the first run: `combineFnRecord::get` was a row in the table with no
// method on `cfRecord`, while `cfArray` exposed its `get`. That is the whole
// class of drift this closes.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { presetNames } from "./engine-surface.mjs";

const root = new URL("../", import.meta.url);
const facadeDir = new URL("packages/ts/runtime/src/state-control/preset-funcs/", root);

/** Every `.ts` file under a directory, recursively, excluding tests. */
async function sourceFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    if (entry.isDirectory()) found.push(...(await sourceFiles(url)));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) found.push(url);
  }
  return found;
}

/**
 * Every `namespace::method` the façade declares.
 *
 * A namespace is one `createZigPresetNamespace<T>("ns", [...])` call. The type
 * argument can itself contain angle brackets (`CombineFnGeneric<AnyValue>`), so
 * the match runs to the `(` rather than to the first `>`.
 */
async function facadeNames() {
  const declared = [];
  for (const file of await sourceFiles(facadeDir)) {
    const source = await readFile(file, "utf8");
    const calls = source.matchAll(
      /createZigPresetNamespace<[\s\S]*?>\(\s*"([A-Za-z0-9_]+)",\s*\[([\s\S]*?)\]/g,
    );
    for (const [, namespace, list] of calls) {
      for (const [, method] of list.matchAll(/"([A-Za-z0-9_]+)"/g)) {
        declared.push({ name: `${namespace}::${method}`, file: file.pathname });
      }
    }
  }
  return declared;
}

const engine = await presetNames(root);
const facade = await facadeNames();

assert(facade.length > 0, "no createZigPresetNamespace declarations found — has the façade moved?");

// ── No duplicate declarations ────────────────────────────────────────────────
const seen = new Map();
for (const { name, file } of facade) {
  const first = seen.get(name);
  assert(first === undefined, `"${name}" is declared twice, in ${first} and ${file}`);
  seen.set(name, file);
}

// ── Every engine preset is reachable from TypeScript ─────────────────────────
//
// `X::pass` is the one exception. `table.lookup` treats any name ending in
// `::pass` as the identity, so the rows for it are a convenience rather than
// the set of namespaces that have one; a namespace with no `pass` method is a
// façade decision, not drift.
const missing = engine.filter((name) => !seen.has(name) && !name.endsWith("::pass"));
assert.deepEqual(
  missing,
  [],
  `preset/table.zig has presets the TypeScript façade does not expose: ${missing.join(", ")}`,
);

// ── Every TypeScript method is a real preset ──────────────────────────────────
const known = new Set(engine);
const unknown = facade
  .filter(({ name }) => !known.has(name) && !name.endsWith("::pass"))
  .map(({ name, file }) => `${name} (${file})`);
assert.deepEqual(
  unknown,
  [],
  `the TypeScript façade exposes presets the engine does not implement: ${unknown.join(", ")}`,
);

// ── A `pass` the façade claims must still resolve ─────────────────────────────
//
// Not against the rows, per above, but against the rule that makes the rows
// unnecessary: the name has to end in `::pass` for `table.lookup` to accept it.
for (const { name, file } of facade) {
  if (known.has(name)) continue;
  assert(
    name.endsWith("::pass"),
    `"${name}" in ${file} is neither a table row nor a ::pass identity`,
  );
}

console.log(
  `check-preset-names: ${engine.length} engine presets, ${facade.length} façade methods, in agreement`,
);

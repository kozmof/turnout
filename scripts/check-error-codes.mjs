// Pins spec/error-codes.json to the engine's error names and the host's unions.
//
// The WASM boundary carries `@errorName(err)` (see `runtimeError` in abi.zig), so a
// host code naming an engine error is coupled to the spelling of a Zig error with
// nothing to say so. See the `why` block in the spec file for what that costs.
//
// What this checks:
//   - every code in a gated host union is classified in the spec
//   - the spec classifies no code the host does not declare
//   - every `shared` code is an error name the engine can actually raise
//   - every `renamed` engine error exists, and its host code does not collide with
//     an engine error of the same name
//   - every `renamed` pair is actually implemented at the rename site
//   - no `hostOnly` or `vestigial` code shadows an engine error name
//
// A union is only half the surface, though. A host also names an engine error by
// comparing a bare string literal against one, and that comparison lives wherever
// it is written rather than in errors.ts. So this also scans `matchSources` for
// string literals the engine raises as errors, and checks:
//   - every such literal is classified, either above or in `matched`
//   - every `matched` code is still an engine error name
//   - every `matched` code is still compared against somewhere in `matchSources`
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const spec = JSON.parse(await readFile(new URL("spec/error-codes.json", root), "utf8"));

/** Every `error.Name` the engine sources mention, which is a superset of what can cross. */
async function engineErrorNames() {
  const names = new Set();
  for (const dir of spec.engineSources) {
    for (const file of await zigFiles(new URL(`${dir}/`, root))) {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(/\berror\.([A-Z][A-Za-z0-9_]*)/g)) names.add(match[1]);
      // A declared error set lists its members bare, without the `error.` prefix.
      for (const set of source.matchAll(/=\s*error\{([^}]*)\}/g)) {
        for (const member of set[1].split(",")) {
          const name = member.trim();
          if (/^[A-Z][A-Za-z0-9_]*$/.test(name)) names.add(name);
        }
      }
    }
  }
  return names;
}

async function sourceFiles(dir, extension) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    if (entry.isDirectory()) found.push(...(await sourceFiles(child, extension)));
    else if (entry.name.endsWith(extension)) found.push(child);
  }
  return found;
}

const zigFiles = (dir) => sourceFiles(dir, ".zig");

/**
 * Every engine error name a scanned TypeScript source compares a string literal
 * against, mapped to the files that do it.
 *
 * Tests are excluded: a test naming an error is asserting on behaviour, not
 * depending on the spelling to route one. Generated protobuf is excluded because
 * nothing in it is a hand-written comparison.
 */
async function matchedEngineNames(engine) {
  const sites = new Map();
  for (const dir of spec.matchSources) {
    for (const file of await sourceFiles(new URL(`${dir}/`, root), ".ts")) {
      const path = file.pathname.slice(root.pathname.length);
      if (path.endsWith(".test.ts") || path.endsWith("_pb.ts")) continue;
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(/"([A-Z][A-Za-z0-9_]*)"/g)) {
        if (!engine.has(match[1])) continue;
        if (!sites.has(match[1])) sites.set(match[1], new Set());
        sites.get(match[1]).add(path);
      }
    }
  }
  return sites;
}

/**
 * The codes one host union declares.
 *
 * Two shapes, because errors.ts uses both: a `const xs = [...] as const` whose
 * element type is the union, and a bare `type X = "a" | "b"`. Reading them out of
 * the source rather than importing keeps this runnable without a build step.
 */
function hostCodes(source, union) {
  const asConst = source.match(
    new RegExp(`export const \\w+ = \\[([^\\]]*)\\] as const;\\s*\\n\\nexport type ${union} =`),
  );
  const asUnion = source.match(new RegExp(`export type ${union} =([^;]*);`));
  const body = asConst?.[1] ?? asUnion?.[1];
  assert.ok(body !== undefined, `errors.ts declares no union named ${union}`);
  const codes = [...body.matchAll(/"([A-Za-z0-9_]+)"/g)].map((match) => match[1]);
  assert.ok(codes.length > 0, `${union} declares no codes`);
  return codes;
}

const engine = await engineErrorNames();
const host = await readFile(new URL(spec.host, root), "utf8");
const renameSite = await readFile(new URL(spec.renameSite, root), "utf8");

const declared = new Set();
for (const union of spec.gatedUnions) for (const code of hostCodes(host, union)) declared.add(code);

const classified = new Map();
/**
 * Records one code's classification, rejecting a code that appears under two kinds.
 *
 * `renamed` is the exception, and many-to-one on purpose: the engine's
 * ActionNotFound and SceneNotFound both read to a caller as UnknownAction, so the
 * same host code legitimately answers for two engine errors.
 */
function classify(code, kind) {
  const previous = classified.get(code);
  assert.ok(
    previous === undefined || (previous === "renamed" && kind === "renamed"),
    `${code} is classified as both ${previous} and ${kind}; each code gets one classification`,
  );
  classified.set(code, kind);
}
for (const entry of spec.shared) classify(entry.code, "shared");
for (const entry of spec.renamed) classify(entry.host, "renamed");
for (const entry of spec.hostOnly) classify(entry.code, "hostOnly");
for (const entry of spec.vestigial) classify(entry.code, "vestigial");

// `matched` is a second surface, not a fifth kind: a literal whose spelling some
// entry above already pins to the engine needs no second entry, so these are
// recorded apart from the four rather than through classify().
//
// What pins a spelling is the assertion that the engine still raises it, and only
// two kinds make it. `shared` names the engine error directly. `renamed` names it
// on the engine side, which is the side a literal is compared against — the host
// side of a rename is a host word the engine never sends. `hostOnly` and
// `vestigial` assert the opposite, that no engine error bears the name, so a
// literal of theirs could never reach this set in the first place.
const pinnedToEngine = new Set([
  ...spec.shared.map((entry) => entry.code),
  ...spec.renamed.map((entry) => entry.engine),
]);
const matched = new Set(spec.matched.map((entry) => entry.code));
for (const code of matched) {
  assert.ok(
    !pinnedToEngine.has(code),
    `${code} is listed under matched but is already pinned to the engine by a shared ` +
      `or renamed entry; that entry asserts the spelling and this one is redundant`,
  );
}

// Every declared code is classified, and nothing classified is undeclared.
for (const code of declared) {
  assert.ok(
    classified.has(code),
    `${code} is declared by a gated union in errors.ts but is not classified in spec/error-codes.json`,
  );
}
for (const code of classified.keys()) {
  assert.ok(
    declared.has(code),
    `spec/error-codes.json classifies ${code}, which no gated union in errors.ts declares`,
  );
}

// `shared` means the engine raises an error of exactly that name.
for (const entry of spec.shared) {
  assert.ok(
    engine.has(entry.code),
    `${entry.code} is listed as shared but no engine source raises error.${entry.code}`,
  );
}

// `renamed` means the engine error exists and the host maps it to a different name.
for (const entry of spec.renamed) {
  assert.ok(
    engine.has(entry.engine),
    `${entry.engine} is listed as renamed but no engine source raises error.${entry.engine}`,
  );
  assert.notEqual(
    entry.engine,
    entry.host,
    `${entry.engine} is listed as renamed but maps to itself; it belongs in shared`,
  );
  assert.ok(
    renameSite.includes(`"${entry.engine}"`) && renameSite.includes(`"${entry.host}"`),
    `${spec.renameSite} does not map ${entry.engine} to ${entry.host}`,
  );
}

// Nothing the host claims as its own may shadow an engine error name: the code would
// arrive from both sides meaning different things.
for (const entry of [...spec.hostOnly, ...spec.vestigial]) {
  assert.ok(
    !engine.has(entry.code),
    `${entry.code} is listed as ${spec.hostOnly.includes(entry) ? "hostOnly" : "vestigial"} ` +
      `but the engine raises error.${entry.code}; it belongs in shared`,
  );
}

// Every classification carries a reason. A list with no `why` is a list nobody has to think about.
for (const [kind, entries] of Object.entries({
  shared: spec.shared,
  renamed: spec.renamed,
  hostOnly: spec.hostOnly,
  vestigial: spec.vestigial,
})) {
  for (const entry of entries) {
    assert.ok(
      typeof entry.why === "string" && entry.why.length > 0,
      `${kind} entry ${entry.code ?? entry.engine} has no "why"`,
    );
  }
}

// The literal-comparison surface. A union declares a vocabulary; a comparison
// consumes one, and the spelling it consumes has to stay pinned to the engine too.
const matchSites = await matchedEngineNames(engine);

for (const [code, files] of matchSites) {
  assert.ok(
    pinnedToEngine.has(code) || matched.has(code),
    `${[...files].join(", ")} compares against "${code}", which the engine raises as ` +
      `error.${code}, but nothing in spec/error-codes.json pins that spelling. Add it to ` +
      `matched, or to shared if a gated union declares it as well.`,
  );
}

for (const entry of spec.matched) {
  assert.ok(
    engine.has(entry.code),
    `${entry.code} is listed under matched but no engine source raises error.${entry.code}`,
  );
  assert.ok(
    matchSites.has(entry.code),
    `${entry.code} is listed under matched but no source under matchSources compares ` +
      `against it; drop the entry or restore the call site`,
  );
}

for (const entry of spec.matched) {
  assert.ok(
    typeof entry.why === "string" && entry.why.length > 0,
    `matched entry ${entry.code} has no "why"`,
  );
}

console.log(
  `error codes: ${declared.size} declared across ${spec.gatedUnions.length} unions — ` +
    `${spec.shared.length} shared, ${spec.renamed.length} renamed, ` +
    `${spec.hostOnly.length} host-only, ${spec.vestigial.length} vestigial; ` +
    `${matchSites.size} engine names matched as literals across ` +
    `${spec.matchSources.length} trees, ${spec.matched.length} classified there`,
);

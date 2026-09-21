// Pins spec/structural-rules.json to the three implementations that enforce it.
//
// The structural invariants of a loaded model are checked in three places: the
// engine's structure.zig, the TypeScript host's validate-model.ts, and — earlier,
// and against source — the Go compiler. Every other shared name in this repository
// is gated: field types, function aliases, the runtime projection, the model
// versions, the shared bounds. These were not, and the wording in the engine and
// host files is identical, which is what a port looks like rather than two
// independent implementations.
//
// Both halves had already drifted when this was written.
//
// The host rejected a prog binding carrying neither `value` nor `expr` even when a
// prepare entry filled it; the engine consults the prepare schedule and runs that
// model. A host stricter than the engine by accident rather than by decision, with
// no test on either side failing.
//
// And the compiler, left out of this file on the grounds that its diagnostics are
// worded for a different audience, was missing two rules outright: `route "x"`
// twice, or a route taking a scene's name, compiled clean and produced a model the
// engine refused to load — reported against no file and no line, which is the
// failure this whole file exists to prevent.
//
// So this checks, for the engine and the host:
//   - every rule in `shared` is present in BOTH files
//   - every rule in `hostOnly` is present in the host and ABSENT from the engine
//   - neither file carries a rule the spec does not list
//
// and then, for the compiler:
//   - every shared rule names the diag code that catches it, or says why no
//     source can reach that shape
//   - every named code is both declared and actually raised
//
// The third and last bullets are the ones that catch new drift: a rule added to
// one implementation alone has to be classified against the other two — as shared,
// as a host judgement with a reason, or as unreachable by the compiler — before it
// can pass.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const spec = JSON.parse(await readFile(new URL("spec/structural-rules.json", root), "utf8"));

/**
 * Zig writes a quote inside a format string as `\"`; TypeScript writes it bare
 * inside a template literal. Unescaping the Zig source lets one fragment match
 * both, so the spec does not have to carry two spellings of every rule.
 */
function normalize(source) {
  return source.replaceAll('\\"', '"');
}

const engineSource = normalize(await readFile(new URL(spec.engine, root), "utf8"));
const hostSource = normalize(await readFile(new URL(spec.host, root), "utf8"));

/** Whether every fragment of a rule appears in `source`. */
function present(source, rule) {
  return rule.fragments.every((fragment) => source.includes(fragment));
}

/** The fragments of a rule that `source` is missing, for the failure message. */
function missing(source, rule) {
  return rule.fragments.filter((fragment) => !source.includes(fragment));
}

assert.ok(spec.shared.length > 0, "spec/structural-rules.json lists no shared rules");

for (const rule of spec.shared) {
  assert.ok(
    present(engineSource, rule),
    `shared rule "${rule.id}" is missing from the engine (${spec.engine}): ` +
      `${JSON.stringify(missing(engineSource, rule))}\n` +
      `  A shared rule the engine no longer raises is either a rule the host must ` +
      `stop raising too, or a host judgement — move it to hostOnly with a reason.`,
  );
  assert.ok(
    present(hostSource, rule),
    `shared rule "${rule.id}" is missing from the host (${spec.host}): ` +
      `${JSON.stringify(missing(hostSource, rule))}\n` +
      `  The host is the convenience copy. Restore the rule, or drop it from ` +
      `shared if the engine no longer raises it either.`,
  );
}

for (const rule of spec.hostOnly) {
  assert.ok(
    present(hostSource, rule),
    `host-only rule "${rule.id}" is missing from the host (${spec.host}): ` +
      `${JSON.stringify(missing(hostSource, rule))}\n` +
      `  Delete it from hostOnly if the host deliberately stopped raising it.`,
  );
  assert.ok(
    !present(engineSource, rule),
    `host-only rule "${rule.id}" now appears in the engine (${spec.engine}).\n` +
      `  If the engine adopted it, move it to shared. A rule listed as the host's ` +
      `own judgement while the engine also enforces it is the record going stale.`,
  );
}

// Every message the host raises has to be accounted for. Without this, a rule
// added to one side alone still passes: the spec would simply not mention it.
//
// A host message is one or more template literals concatenated inside an
// `errors.push(...)` call, so the skeleton is every backtick-quoted run in the
// call with the `${...}` holes taken out — which is exactly the fixed text a
// rule's fragments are drawn from.
function hostMessageSkeletons(source) {
  const skeletons = [];
  const call = "errors.push(";
  for (let at = source.indexOf(call); at !== -1; at = source.indexOf(call, at + 1)) {
    let depth = 0;
    let end = at + call.length - 1;
    for (; end < source.length; end++) {
      if (source[end] === "(") depth++;
      else if (source[end] === ")" && --depth === 0) break;
    }
    const argument = source.slice(at + call.length, end);
    const runs = [...argument.matchAll(/`([^`]*)`/g)].map(([, run]) => run);
    if (runs.length === 0) continue;
    skeletons.push(runs.join("").replaceAll(/\$\{[^{}]*\}/g, ""));
  }
  return skeletons;
}

const skeletons = hostMessageSkeletons(hostSource);
const classified = spec.shared.length + spec.hostOnly.length;
assert.ok(
  skeletons.length >= classified,
  `the host raises ${skeletons.length} messages but the spec classifies ${classified} rules — ` +
    `the spec cannot be describing this file`,
);

const rules = [...spec.shared, ...spec.hostOnly];
const unclassified = skeletons.filter(
  (skeleton) =>
    !rules.some((rule) => rule.fragments.every((fragment) => skeleton.includes(fragment))),
);
assert.deepEqual(
  unclassified,
  [],
  `the host raises messages no rule in spec/structural-rules.json claims:\n` +
    unclassified.map((text) => `  ${JSON.stringify(text)}`).join("\n") +
    `\n  Classify each as shared (the engine raises it too) or hostOnly (with a reason).`,
);

// And every classified rule has to match something the host actually raises,
// so a fragment that no longer resolves is caught rather than passing because
// the substring happens to appear in a comment.
for (const rule of rules) {
  assert.ok(
    skeletons.some((skeleton) => rule.fragments.every((f) => skeleton.includes(f))),
    `rule "${rule.id}" matches no message the host raises — its fragments are stale`,
  );
}

console.log(
  `structural rules OK — ${spec.shared.length} shared, ${spec.hostOnly.length} host-only`,
);

// ─────────────────────────────────────────────────────────────────────────────
// The compiler side
// ─────────────────────────────────────────────────────────────────────────────
//
// The engine and the host are matched on message text, because they are a port
// of one another and the text is the thing that drifted. The compiler is not a
// port: its diagnostics are worded for an author looking at a .tu file, and
// matching them on fragments would gate prose that is supposed to read
// differently.
//
// Its error codes are the stable vocabulary instead. Every shared rule names
// the code that catches it at compile time, or says why the compiler cannot
// reach that shape at all; a rule with neither fails here. That is what makes
// the section a gate rather than a note: a rule added to `shared` has to be
// classified against three implementations, not two.
const compiler = spec.compiler;
assert.ok(compiler, "spec/structural-rules.json has no compiler section");

const compilerCodesSource = await readFile(new URL(compiler.codes, root), "utf8");

/** Every ErrorCode constant the compiler declares, by its string value. */
const declaredCodes = new Set(
  [...compilerCodesSource.matchAll(/ErrorCode\s*=\s*"([A-Za-z]+)"/g)].map(([, code]) => code),
);

/**
 * Every diag code the compiler actually raises, across the whole pipeline.
 *
 * The stages are listed rather than just `internal/validate`, because where a
 * rule is caught is the compiler's business and not this file's: a bare
 * `name:type` binding is rejected by the parser, which is earlier and better
 * than validating a lowered model would be. Gating on one stage would have
 * pushed a check later to satisfy the gate, which is the wrong direction.
 */
const compilerSources = await Promise.all(
  compiler.source.map(async (directory) => {
    const files = (await readdir(new URL(`${directory}/`, root)))
      .filter((name) => name.endsWith(".go") && !name.endsWith("_test.go"))
      .map((name) => readFile(new URL(`${directory}/${name}`, root), "utf8"));
    return (await Promise.all(files)).join("\n");
  }),
);
const raisedCodes = new Set(
  [...compilerSources.join("\n").matchAll(/diag\.Code([A-Za-z]+)/g)].map(([, code]) => code),
);

const classifiedByCompiler = new Map(compiler.rules.map((rule) => [rule.id, rule]));

for (const rule of spec.shared) {
  const entry = classifiedByCompiler.get(rule.id);
  assert.ok(
    entry,
    `shared rule "${rule.id}" is not classified against the compiler.\n` +
      `  Add it to spec/structural-rules.json's compiler.rules with the diag code that ` +
      `catches it, or with an "unreachable" reason if no source can produce the shape.`,
  );
  assert.ok(
    entry.code || entry.unreachable,
    `compiler rule "${rule.id}" has neither a "code" nor an "unreachable" reason`,
  );
  if (!entry.code) continue;
  assert.ok(
    declaredCodes.has(entry.code),
    `compiler rule "${rule.id}" names diag code ${entry.code}, which ${compiler.codes} does not declare`,
  );
  assert.ok(
    raisedCodes.has(entry.code),
    `compiler rule "${rule.id}" names diag code ${entry.code}, which no stage in ` +
      `${compiler.source.join(", ")} raises — the classification is stale`,
  );
}

for (const rule of compiler.rules) {
  assert.ok(
    spec.shared.some((shared) => shared.id === rule.id),
    `compiler.rules classifies "${rule.id}", which is not a shared rule`,
  );
}

const unreachable = compiler.rules.filter((rule) => rule.unreachable).length;
console.log(
  `compiler coverage OK — ${compiler.rules.length - unreachable} shared rules have a diag code, ` +
    `${unreachable} recorded unreachable`,
);

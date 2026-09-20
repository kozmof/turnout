// Pins spec/structural-rules.json to the two implementations that enforce it.
//
// The structural invariants of a loaded model are checked in two places: the
// engine's structure.zig and the TypeScript host's validate-model.ts. Every
// other shared name in this repository is gated — field types, function
// aliases, the runtime projection, the model versions, the shared bounds. This
// pair was not, and the wording in the two files is identical, which is what a
// port looks like rather than two independent implementations.
//
// It had already drifted. The host rejected a prog binding carrying neither
// `value` nor `expr` even when a prepare entry filled it; the engine consults
// the prepare schedule and runs that model. A host stricter than the engine by
// accident rather than by decision, with no test on either side failing.
//
// So this checks three things:
//   - every rule in `shared` is present in BOTH files
//   - every rule in `hostOnly` is present in the host and ABSENT from the engine
//   - neither file carries a rule the spec does not list
//
// The last is the one that catches new drift: a rule added to one side alone
// has to be classified here, as shared or as a host judgement with a reason,
// before it can pass.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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

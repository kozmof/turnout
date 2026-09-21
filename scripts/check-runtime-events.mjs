// Pins spec/runtime-events.json to the two sides of the runtime event stream.
//
// The model going into the engine is protobuf-defined and generated. The events
// coming back are hand-encoded in abi.zig and hand-declared in runner-adapter.ts,
// which is the last unpinned contract between the two languages. See the `why`
// block in the spec file for what that costs.
//
// What this checks:
//   - every kind the spec lists is emitted by the engine
//   - every kind the spec lists is named by the host
//   - the engine emits no kind the spec does not list
//   - the host names no warning kind the spec does not list
//
// The third and fourth are the ones that catch drift. Adding a kind to one side
// now means adding it here, which means noticing the other side.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const spec = JSON.parse(await readFile(new URL("spec/runtime-events.json", root), "utf8"));
const engine = await readFile(new URL(spec.engine, root), "utf8");
const engineEnums = await readFile(new URL(spec.engineEnums, root), "utf8");
const host = await readFile(new URL(spec.host, root), "utf8");

/**
 * Strips Zig's `test "..." { ... }` blocks.
 *
 * abi.zig interleaves its tests with the code they cover, and those tests name
 * every event kind as an expectation string. Those are assertions about the
 * encoder rather than the encoder, so leaving them in would make the "emits no
 * unlisted kind" check unfalsifiable: a kind that only a test mentions would
 * count as emitted.
 *
 * Brace matching rather than a regular expression, because a test body contains
 * braces and the JSON fixtures inside them contain braces in strings. Strings
 * and character literals are skipped so a `{` inside one does not open a level.
 */
function stripTests(source) {
  let out = "";
  let at = 0;
  for (;;) {
    const start = source.indexOf('test "', at);
    if (start === -1 || (start !== 0 && source[start - 1] !== "\n")) {
      if (start === -1) break;
      out += source.slice(at, start + 1);
      at = start + 1;
      continue;
    }
    out += source.slice(at, start);
    let index = source.indexOf("{", start);
    if (index === -1) break;
    let depth = 0;
    for (; index < source.length; index++) {
      const character = source[index];
      if (character === '"' || character === "'") {
        const quote = character;
        for (index++; index < source.length; index++) {
          if (source[index] === "\\") index++;
          else if (source[index] === quote) break;
        }
        continue;
      }
      if (character === "{") depth++;
      else if (character === "}" && --depth === 0) break;
    }
    at = index + 1;
  }
  return out + source.slice(at);
}

const engineImpl = stripTests(engine);

/**
 * Event kinds the engine emits.
 *
 * Two spellings reach the wire. Most events are built with an anonymous struct,
 * where the kind is `.event = "name"`. `actionComplete` is streamed field by
 * field instead, because its payload is assembled from several slices, so its
 * kind is an `objectField("event")` followed by a `write("name")`.
 */
function emittedEvents(source) {
  const structForm = [...source.matchAll(/\.event\s*=\s*"([A-Za-z_]+)"/g)].map(([, kind]) => kind);
  const streamedForm = [
    ...source.matchAll(/objectField\("event"\);\s*try writer\.write\("([A-Za-z_]+)"\)/g),
  ].map(([, kind]) => kind);
  return new Set([...structForm, ...streamedForm]);
}

/**
 * Warning kinds the engine writes as literals.
 *
 * A warning object always opens with its `kind` field, so this is the
 * `objectField("kind")` / `write("name")` pair. The next-rule warnings are not
 * here: their kind is a Zig enum written through `writer.write(warning.kind)`,
 * so the tag names come from the enum declaration instead.
 */
function emittedWarningLiterals(source) {
  return new Set(
    [...source.matchAll(/objectField\("kind"\);\s*try writer\.write\("([A-Za-z_]+)"\)/g)].map(
      ([, kind]) => kind,
    ),
  );
}

/** The tag names of a Zig enum declared as `pub const Name = enum { a, b };`. */
function enumTags(source, name) {
  const declaration = new RegExp(`pub const ${name} = enum \\{([^}]*)\\}`).exec(source);
  assert.ok(declaration, `${spec.engineEnums} does not declare enum ${name}`);
  return new Set(
    declaration[1]
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  );
}

const emitted = emittedEvents(engineImpl);
const warningLiterals = emittedWarningLiterals(engineImpl);

// ── Events ───────────────────────────────────────────────────────────────────

const listedEvents = new Set(spec.events.map((event) => event.kind));

for (const event of spec.events) {
  assert.ok(
    emitted.has(event.kind),
    `event "${event.kind}" is listed in the spec but ${spec.engine} does not emit it.\n` +
      `  If the engine stopped sending it, drop it here and from the host's union.`,
  );
  assert.ok(
    host.includes(`"${event.kind}"`),
    `event "${event.kind}" is emitted by the engine but ${spec.host} never names it.\n` +
      `  An event the host does not handle falls off the end of advanceZigRuntime's switch.`,
  );
}

const unlistedEvents = [...emitted].filter((kind) => !listedEvents.has(kind));
assert.deepEqual(
  unlistedEvents,
  [],
  `${spec.engine} emits event kinds spec/runtime-events.json does not list: ` +
    `${JSON.stringify(unlistedEvents)}\n` +
    `  Add each one, and handle it in ${spec.host}.`,
);

// ── Warnings ─────────────────────────────────────────────────────────────────

const allWarnings = [...spec.actionWarnings, ...spec.sceneWarnings];
const enumSourced = new Map();

for (const warning of allWarnings) {
  if (warning.fromEnum) {
    if (!enumSourced.has(warning.fromEnum)) {
      enumSourced.set(warning.fromEnum, enumTags(engineEnums, warning.fromEnum));
    }
    assert.ok(
      enumSourced.get(warning.fromEnum).has(warning.kind),
      `warning "${warning.kind}" claims to come from enum ${warning.fromEnum}, ` +
        `which has no such tag`,
    );
  } else {
    assert.ok(
      warningLiterals.has(warning.kind),
      `warning "${warning.kind}" is listed in the spec but ${spec.engine} does not write it`,
    );
  }
  assert.ok(
    host.includes(`"${warning.kind}"`),
    `warning "${warning.kind}" is emitted by the engine but ${spec.host} never names it.\n` +
      `  A warning kind missing from the host's union is silently dropped.`,
  );
}

const listedWarnings = new Set(allWarnings.map((warning) => warning.kind));

const unlistedWarnings = [...warningLiterals].filter((kind) => !listedWarnings.has(kind));
assert.deepEqual(
  unlistedWarnings,
  [],
  `${spec.engine} writes warning kinds spec/runtime-events.json does not list: ` +
    `${JSON.stringify(unlistedWarnings)}`,
);

for (const [name, tags] of enumSourced) {
  const unlistedTags = [...tags].filter((tag) => !listedWarnings.has(tag));
  assert.deepEqual(
    unlistedTags,
    [],
    `enum ${name} in ${spec.engineEnums} has tags the spec does not list: ` +
      `${JSON.stringify(unlistedTags)}\n` +
      `  Every tag reaches the wire through writer.write(warning.kind).`,
  );
}

// And the host must not invent kinds of its own: a `kind: "..."` in either of
// its wire-mirror unions that the engine never sends is a branch nothing reaches.
//
// Only those two declarations are scanned. The host translates each wire kind
// into a public name on the way out — `merge` becomes `merge_warning`,
// `uncheckedStateWrite` becomes `unchecked_state_write`, `invalid_condition`
// becomes `invalid_next_condition` — and those names, along with the trace and
// step kinds, are the host's own vocabulary. Matching `kind:` across the whole
// file would gate all of it against a spec that describes the wire.
const mirrorDeclarations = [
  ...host.matchAll(/type (ZigWarning|ZigSceneWarning)\s*=([\s\S]*?);\s*\n\s*\n/g),
];
assert.equal(
  mirrorDeclarations.length,
  2,
  `expected ZigWarning and ZigSceneWarning declarations in ${spec.host}; found ` +
    `${mirrorDeclarations.length}. If they were renamed, rename them here too — ` +
    `this check is worthless if it silently matches nothing.`,
);
const hostWarningKinds = new Set(
  mirrorDeclarations.flatMap(([, , body]) =>
    [...body.matchAll(/\bkind:\s*"([A-Za-z_]+)"/g)].map(([, kind]) => kind),
  ),
);
const hostOnlyWarnings = [...hostWarningKinds].filter((kind) => !listedWarnings.has(kind));
assert.deepEqual(
  hostOnlyWarnings,
  [],
  `${spec.host} declares warning kinds the engine does not send: ` +
    `${JSON.stringify(hostOnlyWarnings)}\n` +
    `  Either the engine gained them and the spec is stale, or they are dead branches.`,
);

console.log(
  `runtime events OK — ${spec.events.length} events, ` +
    `${spec.actionWarnings.length} action warnings, ${spec.sceneWarnings.length} scene warnings`,
);

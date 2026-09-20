// Reads the engine's own surface out of the Zig source.
//
// The point is that nothing here is hand-maintained. `spec/capabilities.json`
// rows are written by people, and a capability nobody writes down is a
// capability nobody checks — which is how `turnout_model_merge` and
// `event:extend_model` were both live and undeclared. These two functions are
// the other half of that check: what the engine actually exposes, to compare
// the manifest against.
import { readFile } from "node:fs/promises";

/** Every `export fn` in the WASM ABI, in source order. */
export async function abiExports(root) {
  const source = await readFile(new URL("packages/zig/wasm/src/abi.zig", root), "utf8");
  return [...source.matchAll(/^export fn ([a-z_0-9]+)\s*\(/gm)].map((match) => match[1]);
}

/**
 * Every variant of the `runner.Event` union.
 *
 * Variants sit at one level of indentation inside the union; the fields of a
 * variant that is itself a struct sit deeper, which is what separates them.
 */
export async function runnerEvents(root) {
  const source = await readFile(new URL("packages/zig/scene-runner/src/runner.zig", root), "utf8");
  const start = source.indexOf("pub const Event = union(enum) {");
  if (start === -1) throw new Error("runner.zig: could not find the Event union");
  const end = source.indexOf("\n};", start);
  if (end === -1) throw new Error("runner.zig: Event union is not terminated");

  const body = source.slice(source.indexOf("\n", start) + 1, end).split("\n");
  const events = [];
  let depth = 0;
  for (const line of body) {
    // Track nesting so a struct variant's own fields are not read as variants.
    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;
    if (depth === 0) {
      const match = /^ {4}([a-z_0-9]+)\s*(?::|,)/.exec(line);
      if (match) events.push(match[1]);
    }
    depth += opens - closes;
    if (depth < 0) depth = 0;
  }
  return events;
}

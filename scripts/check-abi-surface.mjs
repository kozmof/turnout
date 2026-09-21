// Pins the WASM ABI's shape to the TypeScript declaration of it.
//
// `packages/ts/runtime/src/zig-runtime/client.ts` hand-declares two things the
// engine also spells out by hand, with nothing tying the pairs together:
//
//   - `ZigRuntimeExports`, one method per `export fn` in `abi.zig`
//   - `ZigStatus` / `STATUS_NAMES`, one name per variant of `abi.Status`
//
// Every other hand-written pair crossing this boundary is gated — the event
// kinds, the error codes, the structural rules, the runtime projection, the
// preset facade's method list, the ABI version number itself. These two were
// not, and they fail in opposite directions.
//
// An `export fn` missing from the interface is invisible: the engine grows an
// entry point no TypeScript host can call, and nothing says so. A method in the
// interface with no `export fn` behind it is worse, because it type-checks at
// every call site and is `undefined` at run time — `instantiateZigRuntime`
// casts the instance's exports to this interface, so the first host to call it
// gets "is not a function" from inside the client.
//
// `STATUS_NAMES` is indexed by the numeric status the ABI returns, so its order
// is part of the contract and not just its contents: a variant inserted in the
// middle of the Zig enum renames every status above it.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { abiExports } from "./engine-surface.mjs";

const root = new URL("../", import.meta.url);
const clientPath = "packages/ts/runtime/src/zig-runtime/client.ts";
const client = await readFile(new URL(clientPath, root), "utf8");

/**
 * The members of a braced block, given the line that opens it.
 *
 * A TypeScript `interface` closes on a bare `}` and everything else here closes
 * on `};`, so the terminator is whichever comes first at column zero.
 */
function block(source, opener, what) {
  const start = source.indexOf(opener);
  assert.notEqual(start, -1, `could not find ${what}`);
  const from = start + opener.length;
  const end = source.slice(from).search(/^\};?$/m);
  assert.notEqual(end, -1, `${what} is not terminated`);
  return source.slice(from, from + end);
}

// ── exports ──────────────────────────────────────────────────────────────────

const engine = await abiExports(root);
assert.ok(engine.length > 0, "abi.zig parsed as having no exports");

// Methods sit at one level of indentation. A multi-line signature indents its
// parameters further, so anchoring at exactly two spaces reads each one once.
const interfaceBody = block(client, "export interface ZigRuntimeExports {", "ZigRuntimeExports");
const declared = [...interfaceBody.matchAll(/^ {2}([a-z_0-9]+)\(/gm)].map((match) => match[1]);
assert.ok(declared.length > 0, "ZigRuntimeExports parsed as having no methods");

// `memory` is the one member that is not an `export fn`: WebAssembly exports the
// module's linear memory under that name, and the client reads bytes through it.
assert.ok(
  /^ {2}readonly memory: WebAssembly\.Memory;/m.test(interfaceBody),
  `${clientPath}: ZigRuntimeExports must declare \`readonly memory\``,
);

for (const name of engine) {
  assert.ok(
    declared.includes(name),
    `abi.zig exports ${name} but ${clientPath} does not declare it; ` +
      `no TypeScript host can reach that entry point`,
  );
}
for (const name of declared) {
  assert.ok(
    engine.includes(name),
    `${clientPath} declares ${name} but abi.zig exports no such function; ` +
      `calls to it type-check and are undefined at run time`,
  );
}

// ── statuses ─────────────────────────────────────────────────────────────────

const abi = await readFile(new URL("packages/zig/wasm/src/abi.zig", root), "utf8");
const statusBody = block(abi, "pub const Status = enum(u16) {", "abi.Status");
const statuses = [...statusBody.matchAll(/^ {4}([a-z_0-9]+) = (\d+),/gm)].map((match) => ({
  name: match[1],
  value: Number(match[2]),
}));
assert.ok(statuses.length > 0, "abi.Status parsed as having no variants");

// The enum is what the ABI returns as a number, so it has to be dense and
// zero-based for `STATUS_NAMES[status]` to mean anything.
statuses.forEach((status, index) => {
  assert.equal(
    status.value,
    index,
    `abi.Status.${status.name} = ${status.value}, expected ${index}; ` +
      `STATUS_NAMES is indexed by this value`,
  );
});

const namesBody = block(client, "const STATUS_NAMES: readonly ZigStatus[] = [", "STATUS_NAMES");
const names = [...namesBody.matchAll(/"([a-z_0-9]+)"/g)].map((match) => match[1]);
assert.deepEqual(
  names,
  statuses.map((status) => status.name),
  `${clientPath}: STATUS_NAMES does not match abi.Status in contents or order`,
);

// The union is not a braced block — it is `type X = | "a" | "b";` — so it runs
// to the first semicolon rather than to a closing brace.
const unionStart = client.indexOf("export type ZigStatus =");
assert.notEqual(unionStart, -1, "could not find the ZigStatus union");
const unionEnd = client.indexOf(";", unionStart);
assert.notEqual(unionEnd, -1, "the ZigStatus union is not terminated");
const union = client.slice(unionStart, unionEnd);
const members = [...union.matchAll(/"([a-z_0-9]+)"/g)].map((match) => match[1]);
assert.deepEqual(
  members.toSorted(),
  names.toSorted(),
  `${clientPath}: the ZigStatus union and STATUS_NAMES declare different sets`,
);

console.log(
  `abi surface: ${engine.length} exports and ${statuses.length} statuses pinned to ${clientPath}`,
);

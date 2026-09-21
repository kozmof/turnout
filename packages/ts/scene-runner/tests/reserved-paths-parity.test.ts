import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { reservedPaths } from "../src/state/state-validation.js";
import { stateManagerFromUnchecked } from "../src/state/state-manager.js";
import { buildNumber } from "turnout-runtime";

// The reserved-path rule is enforced twice, and has to be: the host answers it
// locally so a state read is not a WASM crossing, and the engine answers it for
// its own writes so a model cannot introduce one. Two lists mean they can
// diverge, and a name added to only one side would be rejected by only one host
// — silently, since neither would fail.
//
// So the list is read out of the Zig source and compared. This is the same
// shape as field-types-parity.test.ts, with one difference worth naming: there
// the shared vocabulary lives in spec/, and both languages assert against it.
// Here the engine is the specification, because the rule is about what a
// JavaScript host cannot safely put in a plain object and the engine's copy is
// the one a second host would read.
const __dirname = dirname(fileURLToPath(import.meta.url));
const stateZig = readFileSync(
  resolve(__dirname, "../../../zig/scene-runner/src/state.zig"),
  "utf-8",
);

function enginePaths(source: string): string[] {
  const start = source.indexOf("const reserved_paths = [_][]const u8{");
  if (start === -1) throw new Error("state.zig: could not find reserved_paths");
  const end = source.indexOf("};", start);
  if (end === -1) throw new Error("state.zig: reserved_paths is not terminated");
  return [...source.slice(start, end).matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
}

describe("reserved state path parity", () => {
  it("the engine declares a non-empty list", () => {
    expect(enginePaths(stateZig).length).toBeGreaterThan(0);
  });

  it("matches reserved_paths in state.zig exactly", () => {
    // Order is not part of the rule — both sides test membership — so compare
    // as sets and report the difference in each direction.
    const engine = new Set(enginePaths(stateZig));
    const host = new Set(reservedPaths);
    expect(
      [...engine].filter((path) => !host.has(path)),
      "state.zig reserves paths this host would accept",
    ).toEqual([]);
    expect(
      [...host].filter((path) => !engine.has(path)),
      "this host reserves paths state.zig would accept",
    ).toEqual([]);
  });

  it("rejects every reserved path at the StateManager boundary", () => {
    for (const path of enginePaths(stateZig)) {
      expect(() => stateManagerFromUnchecked({ [path]: buildNumber(1) }), path).toThrow(
        /reserved path/,
      );
    }
  });

  it("accepts an ordinary path", () => {
    expect(() => stateManagerFromUnchecked({ "player.name": buildNumber(1) })).not.toThrow();
  });
});

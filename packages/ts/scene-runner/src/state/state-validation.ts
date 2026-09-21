import type { AnyValue } from "turnout-runtime";
import { StateError } from "../errors.js";
import { matchesSchemaType } from "./schema-types.js";

/**
 * State paths this host refuses, mirroring `reserved_paths` in
 * `packages/zig/scene-runner/src/state.zig`.
 *
 * The rule is host semantics rather than engine semantics. Every name here is a
 * JavaScript prototype member: the engine keeps its paths in a Zig hash map
 * where `__proto__` is an ordinary key, and the reason it rejects one at all is
 * that a host decoding STATE into a plain object would be polluted by it. The
 * engine therefore keeps enforcing it on what it hands back — see
 * `state_runtime.validatePath` — and the list is answered here because this is
 * where the question is actually asked.
 *
 * It used to be asked through the `statePathValid` ABI operation, once per
 * `read`, `exists`, `isDeclared` and `readOrUndefined`. That is a full crossing
 * — `JSON.stringify`, `turnout_alloc`, a memcpy each way, a parse on both sides
 * — to answer a nine-element string comparison. Measured on the built dist,
 * one machine throughout: 2.0 us for the crossing against 0.004 us for the set,
 * and 100 us for a prepared 20-action scene run through bench/runner-creation.
 * So fifty state reads used to cost as much as running the flow they were
 * reading for. `todo/value-abi-batching.md` has the same finding for the value
 * builders, which still cross.
 *
 * `tests/reserved-paths-parity.test.ts` pins this list against the Zig one, so a
 * name added on either side fails there rather than diverging quietly.
 */
const RESERVED_PATHS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "hasOwnProperty",
  "toString",
  "valueOf",
  "toLocaleString",
  "isPrototypeOf",
  "propertyIsEnumerable",
]);

/** The reserved names, for the parity test that pins them against the engine. */
export const reservedPaths: readonly string[] = Object.freeze([...RESERVED_PATHS]);

export function assertSafePath(path: string): void {
  if (RESERVED_PATHS.has(path)) {
    throw new StateError("ReservedPath", `reserved path "${path}" is not allowed`, path);
  }
}

// assertKnownPath combines the safe-path guard with the schema membership check
// used by read operations. Throws on reserved or undeclared paths.
export function assertKnownPath(path: string, validPaths: ReadonlySet<string> | null): void {
  assertSafePath(path);
  if (validPaths !== null && !validPaths.has(path)) {
    throw new StateError(
      "UnknownPath",
      `unknown path "${path}". Valid paths: ${[...validPaths].join(", ")}`,
      path,
    );
  }
}

// assertValidWrite combines the known-path check with the schema type check
// used by write operations. Throws on reserved paths, undeclared paths, or
// type mismatches.
export function assertValidWrite(
  path: string,
  value: AnyValue,
  validPaths: ReadonlySet<string> | null,
  typeMap: ReadonlyMap<string, string> | null,
): void {
  assertKnownPath(path, validPaths);
  if (typeMap !== null) {
    const expectedType = typeMap.get(path);
    if (expectedType !== undefined && !matchesSchemaType(value, expectedType)) {
      throw new StateError(
        "TypeMismatch",
        `type mismatch for "${path}": expected ${expectedType}, got ${value.symbol}`,
        path,
      );
    }
  }
}

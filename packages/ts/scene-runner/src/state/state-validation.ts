import type { AnyValue } from "runtime";
import { StateError } from "../executor/errors.js";
import { matchesSchemaType } from "./schema-types.js";

export const RESERVED_KEYS = new Set([
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

export function assertSafePath(path: string): void {
  if (RESERVED_KEYS.has(path)) {
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

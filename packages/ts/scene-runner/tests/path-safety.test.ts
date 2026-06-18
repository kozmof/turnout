import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { resolveBaseDir, containPath } from "../src/server/path-safety.js";
import { HarnessError } from "../src/server/errors.js";

describe("resolveBaseDir", () => {
  it("returns the real path for an existing directory", () => {
    // The repo root resolves to itself (no symlinks in the path under test).
    const cwd = process.cwd();
    expect(resolveBaseDir(cwd)).toBe(resolve(cwd));
  });

  it("falls back to the lexical absolute path when the directory does not exist", () => {
    const missing = resolve(process.cwd(), "does", "not", "exist-xyz");
    // realpathSync throws ENOENT → resolveBaseDir returns the lexical resolve.
    expect(resolveBaseDir(missing)).toBe(missing);
  });
});

describe("containPath", () => {
  it("accepts a relative path inside the base", () => {
    const base = process.cwd();
    expect(containPath("sub/file.turn", base)).toBe(resolve(base, "sub/file.turn"));
  });

  it("rejects a parent-directory escape", () => {
    expect(() => containPath("../escape.turn", process.cwd())).toThrow(HarnessError);
  });

  it("rejects an absolute path outside the base", () => {
    expect(() => containPath("/etc/passwd", process.cwd())).toThrow(/outside allowed base/);
  });
});

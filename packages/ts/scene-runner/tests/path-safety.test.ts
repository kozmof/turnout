import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import {
  resolveBaseDir,
  containPath,
  readContainedFile,
  readContainedFileAsync,
} from "../src/server/path-safety.js";
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

  it("accepts in-base names that begin with two dots", () => {
    const base = process.cwd();
    expect(containPath("..draft.turn", base)).toBe(resolve(base, "..draft.turn"));
    expect(containPath("..draft/file.turn", base)).toBe(resolve(base, "..draft/file.turn"));
  });

  it("rejects a parent-directory escape", () => {
    expect(() => containPath("../escape.turn", process.cwd())).toThrow(HarnessError);
  });

  it("rejects an absolute path outside the base", () => {
    expect(() => containPath("/etc/passwd", process.cwd())).toThrow(/outside allowed base/);
  });
});

describe("readContainedFile", () => {
  it("reads through the verified opened descriptor", () => {
    const base = mkdtempSync(join(tmpdir(), "turnout-path-safe-"));
    const file = join(base, "model.turn");
    writeFileSync(file, "content", "utf8");
    expect(readContainedFile(file, base, 32)).toBe("content");
  });

  it("rejects non-regular files", () => {
    const base = mkdtempSync(join(tmpdir(), "turnout-path-safe-"));

    expect(() => readContainedFile(base, base, 32)).toThrow(
      expect.objectContaining({ code: "InvalidFileType" }),
    );
  });

  it("rejects a symlink that resolves outside the base", () => {
    const base = mkdtempSync(join(tmpdir(), "turnout-path-safe-"));
    const outside = join(mkdtempSync(join(tmpdir(), "turnout-path-outside-")), "secret.turn");
    writeFileSync(outside, "secret", "utf8");
    const link = join(base, "link.turn");
    symlinkSync(outside, link);
    expect(() => readContainedFile(link, base, 32)).toThrow(
      expect.objectContaining({ code: "PathOutsideBase" }),
    );
  });
});

describe("readContainedFileAsync", () => {
  it("reads through the verified descriptor asynchronously", async () => {
    const base = mkdtempSync(join(tmpdir(), "turnout-path-safe-"));
    const file = join(base, "model.turn");
    writeFileSync(file, "async content", "utf8");

    await expect(readContainedFileAsync(file, base, 32)).resolves.toBe("async content");
  });

  it("rejects non-regular files", async () => {
    const base = mkdtempSync(join(tmpdir(), "turnout-path-safe-"));

    await expect(readContainedFileAsync(base, base, 32)).rejects.toMatchObject({
      code: "InvalidFileType",
    });
  });
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isMissingFile, readWasmBytes } from "./wasm-bytes.js";

describe("readWasmBytes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads a file: URL from disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "turnout-wasm-"));
    try {
      const path = join(dir, "module.wasm");
      await writeFile(path, new Uint8Array([0, 97, 115, 109]));
      const bytes = await readWasmBytes(pathToFileURL(path));
      expect(Array.from(bytes)).toEqual([0, 97, 115, 109]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports a missing file so the caller can fall back", async () => {
    const url = pathToFileURL(join(tmpdir(), "turnout-absent-module.wasm"));
    const error = await readWasmBytes(url).catch((caught: unknown) => caught);
    expect(isMissingFile(error)).toBe(true);
  });

  // The branch that makes the package loadable without a filesystem.
  it("fetches any other protocol", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const url = new URL("https://example.test/turnout-runtime.wasm");
    expect(Array.from(await readWasmBytes(url))).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledWith(url);
  });

  it("names the URL and status when a fetch fails", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 404 }));
    await expect(readWasmBytes(new URL("https://example.test/gone.wasm"))).rejects.toThrow(
      "https://example.test/gone.wasm: HTTP 404",
    );
  });

  it("rejects a non-Error value and a plain object as not-missing", () => {
    expect(isMissingFile(undefined)).toBe(false);
    expect(isMissingFile({ code: "EACCES" })).toBe(false);
    expect(isMissingFile({ code: "ENOENT" })).toBe(true);
  });
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isMissingFile, readFirstAvailable, readWasmBytes } from "./wasm-bytes.js";

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

describe("readFirstAvailable", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const absent = (name: string) => pathToFileURL(join(tmpdir(), `turnout-absent-${name}.wasm`));

  it("returns the first candidate that exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "turnout-wasm-"));
    try {
      const path = join(dir, "module.wasm");
      await writeFile(path, new Uint8Array([0, 97, 115, 109]));
      const bytes = await readFirstAvailable([pathToFileURL(path), absent("second")]);
      expect(Array.from(bytes)).toEqual([0, 97, 115, 109]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falls past a missing candidate to a later one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "turnout-wasm-"));
    try {
      const path = join(dir, "module.wasm");
      await writeFile(path, new Uint8Array([1, 2]));
      const bytes = await readFirstAvailable([absent("first"), pathToFileURL(path)]);
      expect(Array.from(bytes)).toEqual([1, 2]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // The message is the point. A bare ENOENT names the last path tried, which in
  // an installed copy is a monorepo build directory the reader has never seen.
  it("names every candidate when the engine is nowhere", async () => {
    const first = absent("packaged");
    const second = absent("built");
    const error = await readFirstAvailable([first, second]).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain("the WASM engine is missing");
    expect(message).toContain(first.href);
    expect(message).toContain(second.href);
    expect(isMissingFile((error as Error).cause)).toBe(true);
  });

  // Only a missing file is worth trying the next candidate for. Anything else —
  // a permission error, a bad fetch — is the answer, not a reason to look on.
  it("does not fall through on a failure that is not a missing file", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 500 }));
    await expect(
      readFirstAvailable([new URL("https://example.test/broken.wasm"), absent("unused")]),
    ).rejects.toThrow("HTTP 500");
  });
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  engineCandidates,
  isMissingFile,
  readFirstAvailable,
  readWasmBytes,
} from "./wasm-bytes.js";

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

describe("engineCandidates", () => {
  const names = (base: string) =>
    engineCandidates(new URL(base)).map((url) => url.href.split("/").pop());

  // The bug this exists to prevent: the package builds, ships and smoke-tests a
  // size-optimised artifact that nothing ever asked for, so a browser paid for
  // the fast one it had to download first.
  it("prefers the small artifact when the module was downloaded", () => {
    expect(names("https://example.test/pkg/zig-runtime/default-client.js")).toEqual([
      "turnout-runtime.compact.wasm",
      "turnout-runtime.wasm",
      "turnout-runtime.wasm",
    ]);
  });

  it("prefers the fast artifact when the module came off a filesystem", () => {
    expect(names("file:///app/node_modules/runtime/dist/zig-runtime/default-client.js")).toEqual([
      "turnout-runtime.wasm",
      "turnout-runtime.compact.wasm",
      "turnout-runtime.wasm",
    ]);
  });

  // Whichever comes first, the other is still reachable, so a package that
  // ships one artifact works either way.
  it("offers both packaged artifacts in either environment", () => {
    for (const base of [
      "https://example.test/pkg/zig-runtime/default-client.js",
      "file:///app/pkg/zig-runtime/default-client.js",
    ]) {
      expect(new Set(names(base))).toEqual(
        new Set(["turnout-runtime.wasm", "turnout-runtime.compact.wasm"]),
      );
    }
  });

  it("falls back to the monorepo build directory", () => {
    const candidates = engineCandidates(
      new URL("file:///repo/packages/ts/runtime/src/zig-runtime/default-client.js"),
    );
    expect(candidates.at(-1)?.href).toBe(
      "file:///repo/packages/zig/zig-out/bin/turnout-runtime.wasm",
    );
  });
});

describe("a fetched candidate that is absent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // A 404 over the network is the same answer ENOENT gives on a filesystem.
  // Without this, an artifact order that begins with a name the server does not
  // serve failed outright instead of trying the next one.
  it("falls through to the next candidate", async () => {
    const fetchMock = vi.fn(async (url: URL) =>
      url.href.includes("compact")
        ? { ok: false, status: 404 }
        : { ok: true, arrayBuffer: async () => new Uint8Array([0, 97, 115, 109]).buffer },
    );
    vi.stubGlobal("fetch", fetchMock);

    const bytes = await readFirstAvailable(
      engineCandidates(new URL("https://example.test/pkg/zig-runtime/default-client.js")),
    );
    expect(Array.from(bytes)).toEqual([0, 97, 115, 109]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("still treats any other status as the answer", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 503 }));
    await expect(
      readFirstAvailable(
        engineCandidates(new URL("https://example.test/pkg/zig-runtime/default-client.js")),
      ),
    ).rejects.toThrow("HTTP 503");
  });
});

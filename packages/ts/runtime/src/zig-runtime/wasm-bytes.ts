/**
 * Reads the WASM module's bytes from wherever this package was loaded from.
 *
 * A `file:` URL means a filesystem, so `node:fs` is imported — dynamically,
 * inside the branch that needs it. It used to be a static import at the top of
 * `default-client.ts`, which put `node:fs/promises` in the module graph of
 * every export `turnout-scene-runner` calls universal, and so broke that
 * package on import in any environment without it. Anything else is fetched, so
 * a bundled build that serves the `.wasm` next to its JavaScript needs no
 * filesystem at all.
 *
 * It lives in its own module rather than beside its one caller because that
 * caller instantiates the runtime at import time, which leaves no way to
 * exercise this in a test.
 */
export async function readWasmBytes(url: URL): Promise<Uint8Array> {
  if (url.protocol !== "file:") {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url.href}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
  const { readFile } = await import("node:fs/promises");
  return readFile(url);
}

/** Whether a read failed because the file is not there. */
export function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

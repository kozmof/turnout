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

/**
 * Read the engine's bytes from the first of `candidates` that has them.
 *
 * Only a missing file moves on to the next candidate; anything else is the
 * answer. Running out of candidates raises one error naming all of them,
 * because the bare ENOENT that used to come back named the last place looked —
 * a monorepo build directory — which in an installed copy has nothing to do
 * with anything the reader installed. What went wrong is that the package is
 * missing its engine, and no single path says that.
 *
 * This lives here rather than beside its caller for the same reason the rest of
 * this module does: the caller instantiates the runtime at import time, so
 * nothing in it can be exercised by a test.
 */
export async function readFirstAvailable(candidates: readonly URL[]): Promise<Uint8Array> {
  let lastMissing: unknown;
  for (const candidate of candidates) {
    try {
      return await readWasmBytes(candidate);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      lastMissing = error;
    }
  }
  throw new Error(
    `turnout: the WASM engine is missing. Looked for it at ` +
      `${candidates.map((url) => url.href).join(" and at ")}. ` +
      `Run \`pnpm build\` from the repository, or reinstall the package.`,
    { cause: lastMissing },
  );
}

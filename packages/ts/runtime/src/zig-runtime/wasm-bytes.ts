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
    if (!response.ok) {
      const error = new Error(`${url.href}: HTTP ${response.status}`);
      // A 404 is the network's way of saying the candidate is not there, which
      // is what ENOENT says on a filesystem: a reason to try the next one. Any
      // other status is a server that is there and unwell, and is the answer.
      if (response.status === 404) markMissing(error);
      throw error;
    }
    return new Uint8Array(await response.arrayBuffer());
  }
  const { readFile } = await import("node:fs/promises");
  return readFile(url);
}

/**
 * Marks an error as "this candidate is not there", whatever the transport
 * carried it. A filesystem says so with ENOENT and has since long before this
 * package; a fetch says so with a status code, so it is tagged here rather than
 * given a borrowed errno that would claim a filesystem was involved.
 */
const missingArtifact = Symbol.for("turnout.missingArtifact");

function markMissing(error: Error): void {
  (error as unknown as Record<PropertyKey, unknown>)[missingArtifact] = true;
}

/** Whether a read failed because the artifact is not where it was looked for. */
export function isMissingFile(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (missingArtifact in error) return true;
  return "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

/**
 * The packaged engine artifacts, built from one source and shipped together.
 *
 * `ReleaseSafe` keeps the runtime's bounds and overflow checks; `ReleaseSmall`
 * is about a seventh of the size for about 14% less throughput. See
 * `packages/zig/build.zig`, which builds both and explains the split.
 */
const artifacts = {
  fast: "turnout-runtime.wasm",
  small: "turnout-runtime.compact.wasm",
} as const;

/**
 * Where to look for the engine, in order, for a module loaded from `base`.
 *
 * Which of the two artifacts is right depends on the deployment rather than on
 * the caller: a server or CLI has the module on local disk and pays only for
 * how fast it runs, while a browser downloads it before anything can run, so
 * its size is part of startup. Nobody was choosing — every host got the fast
 * build, because it was the only name this list held.
 *
 * The deployment is legible from `base` without anyone being asked. A `file:`
 * URL means a filesystem, so the module was never downloaded; anything else was
 * fetched over a network that a browser is on the other end of. Each order
 * falls back to the other artifact, so a package that ships only one still
 * works, and both fall back to the monorepo build directory for a checkout that
 * has not run `pnpm build`.
 *
 * A host that wants the other one regardless builds its own instance with
 * `instantiateZigRuntime` and installs it with `setDefaultZigRuntimeClient`.
 */
export function engineCandidates(base: URL): readonly URL[] {
  const downloaded = base.protocol !== "file:";
  const order = downloaded ? [artifacts.small, artifacts.fast] : [artifacts.fast, artifacts.small];
  return [
    ...order.map((name) => new URL(`./${name}`, base)),
    new URL(`../../../../zig/zig-out/bin/${artifacts.fast}`, base),
  ];
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

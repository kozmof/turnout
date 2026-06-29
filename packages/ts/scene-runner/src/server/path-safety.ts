// Node.js only — path containment for request-facing / multi-tenant usage.
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import type { BigIntStats } from "node:fs";
import { open as openAsync } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { HarnessError } from "./errors.js";

/**
 * Resolve a base directory to its real path, falling back to the lexical
 * absolute path when it does not yet exist (some callers validate paths against
 * a base that is created later). Used to normalize the base before containment
 * checks and to pass `-state-file` to the converter.
 */
export function resolveBaseDir(baseDir: string): string {
  const lexical = resolve(baseDir);
  try {
    return realpathSync(lexical);
  } catch {
    return lexical;
  }
}

function isContained(candidate: string, base: string): boolean {
  return candidate === base || candidate.startsWith(base + sep);
}

/**
 * Resolve `filePath` against `baseDir` and assert it stays inside. Relative
 * paths are interpreted relative to `baseDir`. Performs two checks:
 *
 *  1. A lexical check (`path.relative`) that rejects `..` escapes and sibling
 *     directories sharing only a name prefix. Works for not-yet-created files.
 *  2. A symlink check: if the candidate (or base) resolves to a real location,
 *     the resolved real path must still be contained.
 *
 * Returns the lexical absolute path. Throws `HarnessError("PathOutsideBase")`
 * on any escape.
 *
 * NOTE: this is a check-then-use guard. For reads, prefer `readContainedFile`,
 * which pins the opened inode against a symlink swapped in after the check. For
 * the child-process converter, feed content via stdin rather than re-passing
 * the path (see `bridge.ts`).
 */
export function containPath(filePath: string, baseDir: string): string {
  const base = resolve(baseDir);
  const candidate = isAbsolute(filePath) ? resolve(filePath) : resolve(base, filePath);

  const rel = relative(base, candidate);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new HarnessError(
      "PathOutsideBase",
      `path "${filePath}" is outside allowed base directory "${baseDir}"`,
    );
  }

  let realBase = base;
  let realCandidate = candidate;
  try {
    realBase = realpathSync(base);
  } catch {
    // base may not exist yet — the lexical check above already constrains it.
  }
  try {
    realCandidate = realpathSync(candidate);
  } catch {
    // file may not exist yet — fall back to the lexical candidate.
  }
  if (!isContained(realCandidate, realBase)) {
    throw new HarnessError(
      "PathOutsideBase",
      `path "${filePath}" resolves outside allowed base directory "${baseDir}"`,
    );
  }

  return candidate;
}

/**
 * Resolve the real path of an open file descriptor via `/proc/self/fd`. Returns
 * `undefined` when the platform has no `/proc` (non-Linux) or the link cannot be
 * resolved — callers then rely on the pre-open `containPath` check alone.
 */
function fdRealPath(fd: number): string | undefined {
  try {
    const resolved = realpathSync(`/proc/self/fd/${fd}`);
    // On real Linux, realpath follows the /proc symlink to the concrete file.
    // If we get a /proc/ path back, resolution did not happen (e.g. a test mock
    // or an unusual platform) — treat it as unverifiable.
    return resolved.startsWith(`${sep}proc${sep}`) ? undefined : resolved;
  } catch {
    return undefined;
  }
}

function isSameFile(
  opened: Pick<BigIntStats, "dev" | "ino">,
  current: Pick<BigIntStats, "dev" | "ino">,
): boolean {
  return opened.dev === current.dev && opened.ino === current.ino;
}

/**
 * Resolve and verify an opened descriptor on platforms without `/proc/self/fd`.
 * The identity comparison prevents a pathname swapped after `openSync` from
 * being used to validate a different, in-base file.
 */
function verifyOpenedPath(fd: number, safePath: string, baseDir: string): boolean {
  const realBase = resolveBaseDir(baseDir);
  const openedPath = fdRealPath(fd);
  if (openedPath !== undefined) return isContained(openedPath, realBase);

  try {
    const currentPath = realpathSync(safePath);
    if (!isContained(currentPath, realBase)) return false;
    return isSameFile(fstatSync(fd, { bigint: true }), statSync(currentPath, { bigint: true }));
  } catch {
    // An unverifiable descriptor is not safe for request-facing containment.
    return false;
  }
}

/**
 * Read a file while keeping it inside `baseDir`, hardened against the
 * check-then-use TOCTOU window. The path is validated with `containPath`, then
 * opened once (pinning the inode), then the opened descriptor is re-verified to
 * be inside the base before its contents are read. A symlink swapped in after
 * the initial check therefore cannot redirect the read.
 *
 * Throws `HarnessError("PathOutsideBase")` if the path escapes the base at
 * either stage. I/O errors propagate to the caller for wrapping.
 */
export function readContainedFile(filePath: string, baseDir: string, maxBytes?: number): string {
  const safePath = containPath(filePath, baseDir);
  const fd = openSync(safePath, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const openedInfo = fstatSync(fd);
    if (!openedInfo.isFile()) {
      throw new HarnessError("InvalidFileType", `path "${filePath}" is not a regular file`);
    }
    if (maxBytes !== undefined && openedInfo.size > maxBytes) {
      throw new HarnessError(
        "InputTooLarge",
        `path "${filePath}" exceeds the ${maxBytes}-byte input limit`,
      );
    }
    if (!verifyOpenedPath(fd, safePath, baseDir)) {
      throw new HarnessError(
        "PathOutsideBase",
        `path "${filePath}" resolved outside allowed base directory "${baseDir}" after open`,
      );
    }
    if (maxBytes === undefined) return readFileSync(fd, "utf8");

    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= maxBytes) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - total));
      const count = readSync(fd, chunk, 0, chunk.length, null);
      if (count === 0) return Buffer.concat(chunks, total).toString("utf8");
      chunks.push(chunk.subarray(0, count));
      total += count;
    }
    throw new HarnessError(
      "InputTooLarge",
      `path "${filePath}" exceeds the ${maxBytes}-byte input limit`,
    );
  } finally {
    closeSync(fd);
  }
}

/**
 * Asynchronous counterpart to `readContainedFile` for request-facing paths.
 * Opening and reading happen off the event loop while retaining the same
 * descriptor identity and containment checks as the synchronous API.
 */
export async function readContainedFileAsync(
  filePath: string,
  baseDir: string,
  maxBytes: number,
): Promise<string> {
  const safePath = containPath(filePath, baseDir);
  const handle = await openAsync(safePath, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const openedInfo = await handle.stat();
    if (!openedInfo.isFile()) {
      throw new HarnessError("InvalidFileType", `path "${filePath}" is not a regular file`);
    }
    if (openedInfo.size > maxBytes) {
      throw new HarnessError(
        "InputTooLarge",
        `path "${filePath}" exceeds the ${maxBytes}-byte input limit`,
      );
    }
    if (!verifyOpenedPath(handle.fd, safePath, baseDir)) {
      throw new HarnessError(
        "PathOutsideBase",
        `path "${filePath}" resolved outside allowed base directory "${baseDir}" after open`,
      );
    }

    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= maxBytes) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) return Buffer.concat(chunks, total).toString("utf8");
      chunks.push(chunk.subarray(0, bytesRead));
      total += bytesRead;
    }
    throw new HarnessError(
      "InputTooLarge",
      `path "${filePath}" exceeds the ${maxBytes}-byte input limit`,
    );
  } finally {
    await handle.close();
  }
}

// Node.js only — uses child_process and fs.
import { execFile } from "node:child_process";
import { accessSync, constants, readFileSync, realpathSync } from "node:fs";
import { sep } from "node:path";
import { resolve as resolvePath } from "node:path";
import { fromJson, type JsonObject } from "@bufbuild/protobuf";
import type { TurnModel } from "../types/turnout-model_pb.js";
import { TurnModelSchema } from "../types/turnout-model_pb.js";
import { BridgeError, HarnessError, LoadError } from "./errors.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Timeout for the PATH probe (`turnout --help`). */
const BIN_PROBE_TIMEOUT_MS = 10_000;

/** Timeout for a full conversion run. */
const CONVERT_TIMEOUT_MS = 60_000;

/** Maximum stdout buffer for a conversion run (64 MiB). */
const CONVERT_MAX_BUFFER = 64 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// Public options type
// ─────────────────────────────────────────────────────────────────────────────

export type BridgeOptions = {
  /**
   * Override the `turnout` binary path. When set, binary auto-discovery is
   * skipped entirely — useful for testing or when the binary is at a known path.
   */
  binPath?: string;
  /**
   * When `true`, the JSON parser rejects unknown fields in the model.
   * Defaults to `false`. Pass `true` in development/CI to catch schema-drift early.
   */
  strictParse?: boolean;
  /**
   * When set, all file paths are resolved against this base directory. Paths
   * that resolve outside the base throw `HarnessError("PathOutsideBase")`.
   * Recommended for multi-tenant or request-facing server usage.
   */
  safeBaseDir?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Path safety helper
// ─────────────────────────────────────────────────────────────────────────────

function assertPathInside(filePath: string, baseDir: string): void {
  const absolutePath = resolvePath(filePath);
  let base: string;
  try {
    base = realpathSync(resolvePath(baseDir));
  } catch {
    throw new HarnessError(
      "PathOutsideBase",
      `safeBaseDir "${baseDir}" does not exist or is not accessible`,
    );
  }
  let resolved: string;
  try {
    resolved = realpathSync(absolutePath);
  } catch {
    resolved = absolutePath;
  }
  if (resolved !== base && !resolved.startsWith(base + sep)) {
    throw new HarnessError(
      "PathOutsideBase",
      `path "${filePath}" is outside allowed base directory "${baseDir}"`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Async execFile wrapper
// ─────────────────────────────────────────────────────────────────────────────

type ExecResult = { stdout: Buffer; stderr: Buffer };

function execFileAsync(
  bin: string,
  args: string[],
  options: { timeout?: number; maxBuffer?: number },
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { ...options, encoding: "buffer" }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout: stdout as Buffer, stderr: stderr as Buffer });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// File loading
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read a `.turn` file from disk and return its raw content as a string.
 * Server-only (uses Node.js `fs`).
 *
 * Pass `options.safeBaseDir` to restrict which paths may be read.
 */
export function loadTurnFile(filePath: string, options?: BridgeOptions): string {
  if (options?.safeBaseDir) assertPathInside(filePath, options.safeBaseDir);
  try {
    return readFileSync(filePath, "utf8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new LoadError("ReadError", filePath, `Cannot read turn file "${filePath}": ${msg}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Binary resolution (memoized, async)
// ─────────────────────────────────────────────────────────────────────────────

// Cached as a Promise so concurrent callers all await the same discovery run.
let cachedBin: Promise<string> | undefined;

/**
 * Reset the memoized binary discovery cache. Intended for tests that change
 * `TURNOUT_BIN` or `options.binPath` between runs and need a fresh lookup.
 * Not needed in production — the cache is valid for the lifetime of the process.
 */
export function resetBinCache(): void {
  cachedBin = undefined;
}

async function discoverBin(): Promise<string> {
  if (process.env.TURNOUT_BIN) {
    return process.env.TURNOUT_BIN;
  }

  try {
    await execFileAsync("turnout", ["--help"], { timeout: BIN_PROBE_TIMEOUT_MS });
    return "turnout";
  } catch {
    // Fall back to the locally-built binary in the Go converter package.
    const goConverterDir = new URL("../../../../go/converter", import.meta.url).pathname;
    const binPath = `${goConverterDir}/cmd/turnout/turnout`;
    try {
      accessSync(binPath, constants.X_OK);
    } catch {
      throw new BridgeError(
        "BinaryNotFound",
        binPath,
        `turnout binary not found. Run: cd ${goConverterDir} && go build ./cmd/turnout`,
      );
    }
    return binPath;
  }
}

async function resolveTurnoutBin(): Promise<string> {
  if (cachedBin === undefined) cachedBin = discoverBin();
  return cachedBin;
}

// ─────────────────────────────────────────────────────────────────────────────
// Converter invocation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Invoke the Go converter on a .turn file and return the parsed TurnModel.
 * Requires the `turnout` binary to be on PATH, or set `TURNOUT_BIN`, or pass
 * `options.binPath` to specify the binary directly.
 *
 * Pass `options.safeBaseDir` to restrict which paths may be converted.
 */
export async function runConverter(
  turnFilePath: string,
  options?: BridgeOptions,
): Promise<TurnModel> {
  if (options?.safeBaseDir) assertPathInside(turnFilePath, options.safeBaseDir);
  const bin = options?.binPath ?? (await resolveTurnoutBin());
  let stdout: Buffer;
  try {
    ({ stdout } = await execFileAsync(
      bin,
      ["convert", "-o", "-", "-format", "json", turnFilePath],
      { timeout: CONVERT_TIMEOUT_MS, maxBuffer: CONVERT_MAX_BUFFER },
    ));
  } catch (err: unknown) {
    if (err instanceof RangeError) {
      throw new BridgeError(
        "BufferOverflow",
        turnFilePath,
        `converter output too large for "${turnFilePath}": increase CONVERT_MAX_BUFFER`,
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new BridgeError(
      "ConverterFailed",
      turnFilePath,
      `turnout converter failed for "${turnFilePath}": ${msg}`,
    );
  }
  return parseJSON(stdout.toString("utf8"), turnFilePath, options?.strictParse ?? false);
}

/**
 * Invoke the Go converter on a `.turn` file and return the canonical HCL
 * output as a string.
 * Server-only (requires the `turnout` binary and Node.js `child_process`).
 *
 * Pass `options.safeBaseDir` to restrict which paths may be converted.
 */
export async function convertToHCL(
  turnFilePath: string,
  options?: BridgeOptions,
): Promise<string> {
  if (options?.safeBaseDir) assertPathInside(turnFilePath, options.safeBaseDir);
  const bin = options?.binPath ?? (await resolveTurnoutBin());
  let stdout: Buffer;
  try {
    ({ stdout } = await execFileAsync(
      bin,
      ["convert", "-o", "-", "-format", "hcl", turnFilePath],
      { timeout: CONVERT_TIMEOUT_MS, maxBuffer: CONVERT_MAX_BUFFER },
    ));
  } catch (err: unknown) {
    if (err instanceof RangeError) {
      throw new BridgeError(
        "BufferOverflow",
        turnFilePath,
        `converter output too large for "${turnFilePath}": increase CONVERT_MAX_BUFFER`,
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new BridgeError(
      "ConverterFailed",
      turnFilePath,
      `turnout converter failed for "${turnFilePath}": ${msg}`,
    );
  }
  return stdout.toString("utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON model loading
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load a pre-converted JSON model file, skipping the Go converter.
 * Useful for faster test runs after the initial conversion.
 *
 * Pass `options.strictParse = true` to reject unknown fields.
 * Pass `options.safeBaseDir` to restrict which paths may be read.
 */
export function loadJsonModel(jsonFilePath: string, options?: BridgeOptions): TurnModel {
  if (options?.safeBaseDir) assertPathInside(jsonFilePath, options.safeBaseDir);
  let raw: string;
  try {
    raw = readFileSync(jsonFilePath, "utf8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new LoadError(
      "ReadError",
      jsonFilePath,
      `Cannot read JSON model "${jsonFilePath}": ${msg}`,
    );
  }
  return parseJSON(raw, jsonFilePath, options?.strictParse ?? false);
}

function parseJSON(raw: string, source: string, strict: boolean): TurnModel {
  try {
    const parsed = JSON.parse(raw) as JsonObject;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return fromJson(TurnModelSchema, parsed, { ignoreUnknownFields: !strict });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new BridgeError("ParseError", source, `Invalid JSON from "${source}": ${msg}`);
  }
}

// Node.js only — uses child_process and fs.
import { execFile } from "node:child_process";
import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fromJson, type JsonObject } from "@bufbuild/protobuf";
import type { TurnModel } from "../types/turnout-model_pb.js";
import { TurnModelSchema } from "../types/turnout-model_pb.js";
import { BridgeError, HarnessError, LoadError } from "./errors.js";
import { readContainedFile, resolveBaseDir } from "./path-safety.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Timeout for the PATH probe (`turnout --version`). */
const BIN_PROBE_TIMEOUT_MS = 10_000;

/** Timeout for a full conversion run. */
const CONVERT_TIMEOUT_MS = 60_000;

/** Maximum stdout buffer for a conversion run (64 MiB). */
const CONVERT_MAX_BUFFER = 64 * 1024 * 1024;

/** Default cap for source and model files read by the bridge (16 MiB). */
export const DEFAULT_MAX_INPUT_BYTES = 16 * 1024 * 1024;

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
  /** Optional cancellation signal for converter discovery and execution. */
  signal?: AbortSignal;
  /** Maximum source or JSON model size in bytes. Defaults to 16 MiB. */
  maxInputBytes?: number;
  /** Maximum external state_file size passed to the converter. Defaults to 16 MiB. */
  maxStateFileBytes?: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Async execFile wrapper
// ─────────────────────────────────────────────────────────────────────────────

type ExecResult = { stdout: Buffer; stderr: Buffer };

class ExecFileFailure extends Error {
  readonly cause: unknown;
  readonly stdout: Buffer;
  readonly stderr: Buffer;

  constructor(cause: unknown, stdout: Buffer, stderr: Buffer) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(message);
    this.name = "ExecFileFailure";
    this.cause = cause;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

const MAX_ERROR_OUTPUT_CHARS = 8_192;

function isBufferOverflow(err: unknown): boolean {
  return (
    err instanceof RangeError || (err instanceof ExecFileFailure && err.cause instanceof RangeError)
  );
}

function abortCause(err: unknown): unknown {
  const cause = err instanceof ExecFileFailure ? err.cause : err;
  return typeof cause === "object" &&
    cause !== null &&
    "name" in cause &&
    cause.name === "AbortError"
    ? cause
    : undefined;
}

function formatExecFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (!(err instanceof ExecFileFailure)) return message;

  const stderr = err.stderr.toString("utf8").trim();
  if (stderr.length === 0) return message;

  const clipped =
    stderr.length > MAX_ERROR_OUTPUT_CHARS
      ? `${stderr.slice(0, MAX_ERROR_OUTPUT_CHARS)}... [stderr truncated]`
      : stderr;
  return `${message}: ${clipped}`;
}

function execFileAsync(
  bin: string,
  args: string[],
  options: {
    timeout?: number;
    maxBuffer?: number;
    input?: Buffer | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<ExecResult> {
  const { input, ...execOptions } = options;
  return new Promise((resolve, reject) => {
    const child = execFile(
      bin,
      args,
      { ...execOptions, encoding: "buffer" },
      (err, stdout, stderr) => {
        if (err) reject(new ExecFileFailure(err, stdout as Buffer, stderr as Buffer));
        else resolve({ stdout: stdout as Buffer, stderr: stderr as Buffer });
      },
    );
    // Feed pre-read source via stdin (used when safeBaseDir hardening reads the
    // file itself and passes "-" as the converter input). `child` may be absent
    // under test mocks; guard accordingly.
    if (input !== undefined) child?.stdin?.end(input);
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
  const maxBytes = inputLimit(options?.maxInputBytes);
  try {
    const content = options?.safeBaseDir
      ? readContainedFile(filePath, options.safeBaseDir, maxBytes)
      : readRegularFileLimited(filePath, maxBytes);
    return content;
  } catch (err: unknown) {
    if (err instanceof HarnessError || err instanceof LoadError) throw err; // structured failures pass through
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

async function discoverBin(signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  if (process.env.TURNOUT_BIN) {
    return process.env.TURNOUT_BIN;
  }

  try {
    await execFileAsync("turnout", ["--version"], { timeout: BIN_PROBE_TIMEOUT_MS, signal });
    return "turnout";
  } catch (err: unknown) {
    const aborted = abortCause(err);
    if (aborted !== undefined) throw aborted;
    // Fall back to the locally-built binary in the Go converter package.
    const goConverterDir = fileURLToPath(new URL("../../../../go/converter", import.meta.url));
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

async function resolveTurnoutBin(signal?: AbortSignal): Promise<string> {
  if (signal !== undefined) return discoverBin(signal);
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
  const stdout = await invokeConverter(turnFilePath, "json", options);
  return parseJSON(stdout.toString("utf8"), turnFilePath, options?.strictParse ?? false);
}

/**
 * Invoke the Go converter on a `.turn` file and return the canonical HCL
 * output as a string.
 * Server-only (requires the `turnout` binary and Node.js `child_process`).
 *
 * Pass `options.safeBaseDir` to restrict which paths may be converted.
 */
export async function convertToHCL(turnFilePath: string, options?: BridgeOptions): Promise<string> {
  const stdout = await invokeConverter(turnFilePath, "hcl", options);
  return stdout.toString("utf8");
}

/**
 * Shared converter invocation for both JSON and HCL output.
 *
 * When `safeBaseDir` is set, the `.turn` source is read here (with TOCTOU
 * hardening via `readContainedFile`) and streamed to the converter over stdin
 * with `-state-file <realBase>` — the child process never re-resolves the
 * caller-supplied path, closing the symlink-swap window. (A `state_file`
 * directive inside the source is still read by the converter relative to the
 * base; that is the remaining, lower-severity surface.)
 *
 * Without `safeBaseDir`, the path is passed directly to the converter as
 * before — the trusted-deploy fast path.
 */
function inputLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_MAX_INPUT_BYTES;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError(`maxInputBytes must be a positive safe integer, got ${limit}`);
  }
  return limit;
}

function stateFileLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_MAX_INPUT_BYTES;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError(`maxStateFileBytes must be a positive safe integer, got ${limit}`);
  }
  return limit;
}

function readRegularFileLimited(filePath: string, maxBytes: number): string {
  if (statSync(filePath).size > maxBytes) {
    throw new LoadError(
      "InputTooLarge",
      filePath,
      `File "${filePath}" exceeds the ${maxBytes}-byte input limit`,
    );
  }
  const content = readFileSync(filePath, "utf8");
  if (Buffer.byteLength(content, "utf8") > maxBytes) {
    throw new LoadError(
      "InputTooLarge",
      filePath,
      `File "${filePath}" exceeds the ${maxBytes}-byte input limit`,
    );
  }
  return content;
}

async function invokeConverter(
  turnFilePath: string,
  format: "json" | "hcl",
  options?: BridgeOptions,
): Promise<Buffer> {
  const maxInputBytes = inputLimit(options?.maxInputBytes);
  const maxStateFileBytes = stateFileLimit(options?.maxStateFileBytes);
  let args: string[];
  let input: Buffer | undefined;
  if (options?.safeBaseDir) {
    // Reads + containment-checks before any work; throws HarnessError on escape.
    const source = readContainedFile(turnFilePath, options.safeBaseDir, maxInputBytes);
    const base = resolveBaseDir(options.safeBaseDir);
    args = [
      "convert",
      "-o",
      "-",
      "-format",
      format,
      "-max-source-bytes",
      String(maxInputBytes),
      "-max-state-file-bytes",
      String(maxStateFileBytes),
      "-state-file",
      base,
      "-",
    ];
    input = Buffer.from(source, "utf8");
  } else {
    args = [
      "convert",
      "-o",
      "-",
      "-format",
      format,
      "-max-source-bytes",
      String(maxInputBytes),
      "-max-state-file-bytes",
      String(maxStateFileBytes),
      turnFilePath,
    ];
  }

  const bin = options?.binPath ?? (await resolveTurnoutBin(options?.signal));
  try {
    const { stdout } = await execFileAsync(bin, args, {
      timeout: CONVERT_TIMEOUT_MS,
      maxBuffer: CONVERT_MAX_BUFFER,
      input,
      signal: options?.signal,
    });
    return stdout;
  } catch (err: unknown) {
    const aborted = abortCause(err);
    if (aborted !== undefined) throw aborted;
    if (isBufferOverflow(err)) {
      throw new BridgeError(
        "BufferOverflow",
        turnFilePath,
        `converter output too large for "${turnFilePath}": increase CONVERT_MAX_BUFFER`,
      );
    }
    const msg = formatExecFailure(err);
    throw new BridgeError(
      "ConverterFailed",
      turnFilePath,
      `turnout converter failed for "${turnFilePath}": ${msg}`,
    );
  }
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
  let raw: string;
  const maxBytes = inputLimit(options?.maxInputBytes);
  try {
    raw = options?.safeBaseDir
      ? readContainedFile(jsonFilePath, options.safeBaseDir, maxBytes)
      : readRegularFileLimited(jsonFilePath, maxBytes);
  } catch (err: unknown) {
    if (err instanceof HarnessError || err instanceof LoadError) throw err; // structured failures pass through
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

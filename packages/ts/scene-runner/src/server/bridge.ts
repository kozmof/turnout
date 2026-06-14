// Node.js only — uses child_process and fs.
import { execFileSync, execSync } from "node:child_process";
import { accessSync, constants, readFileSync } from "node:fs";
import { fromJson, type JsonObject } from "@bufbuild/protobuf";
import type { TurnModel } from "../types/turnout-model_pb.js";
import { TurnModelSchema } from "../types/turnout-model_pb.js";
import { LoadError, BridgeError } from "./errors.js";

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
// File loading
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read a `.turn` file from disk and return its raw content as a string.
 * Server-only (uses Node.js `fs`).
 *
 * @security Callers are responsible for validating `filePath` before passing it
 * here. In a multi-tenant server context, restrict to an allowed base directory
 * using `path.resolve` + `startsWith` before calling this function.
 */
export function loadTurnFile(filePath: string): string {
  try {
    return readFileSync(filePath, "utf8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new LoadError("ReadError", filePath, `Cannot read turn file "${filePath}": ${msg}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Binary resolution (memoized)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a pair of `[resolveTurnoutBin, resetForTesting]`.
 * The cached path lives inside the closure — no module-level mutable state.
 */
function makeBinResolver(): [() => string, () => void] {
  let cached: string | undefined;

  function resolve(): string {
    if (cached !== undefined) return cached;
    if (process.env.TURNOUT_BIN) {
      cached = process.env.TURNOUT_BIN;
      return cached;
    }

    try {
      // Check if turnout is on PATH
      execSync("turnout --help", { stdio: "ignore", timeout: BIN_PROBE_TIMEOUT_MS });
      cached = "turnout";
      return cached;
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
      cached = binPath;
      return cached;
    }
  }

  return [resolve, () => { cached = undefined; }];
}

const [resolveTurnoutBin, _resetBinCacheForTesting] = makeBinResolver();

/**
 * Reset the memoized binary path.
 * Exposed for test isolation only — do not call in production code.
 */
export { _resetBinCacheForTesting };

// ─────────────────────────────────────────────────────────────────────────────
// Converter invocation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Invoke the Go converter on a .turn file and return the parsed TurnModel.
 * Requires the `turnout` binary to be on PATH (run `go install` from the
 * converter package, or use `go build` to place it on PATH).
 *
 * @security Callers are responsible for validating `turnFilePath` before passing
 * it here. In a multi-tenant server context, restrict to an allowed base
 * directory using `path.resolve` + `startsWith` before calling this function.
 */
export function runConverter(turnFilePath: string): TurnModel {
  const bin = resolveTurnoutBin();
  let output: Buffer;
  try {
    output = execFileSync(bin, ["convert", "-o", "-", "-format", "json", turnFilePath], {
      encoding: "buffer",
      timeout: CONVERT_TIMEOUT_MS,
      maxBuffer: CONVERT_MAX_BUFFER,
    });
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
  return parseJSON(output.toString("utf8"), turnFilePath);
}

/**
 * Invoke the Go converter on a `.turn` file and return the canonical HCL
 * output as a string.
 * Server-only (requires the `turnout` binary and Node.js `child_process`).
 *
 * @security Callers are responsible for validating `turnFilePath` before passing
 * it here. In a multi-tenant server context, restrict to an allowed base
 * directory using `path.resolve` + `startsWith` before calling this function.
 */
export function convertToHCL(turnFilePath: string): string {
  const bin = resolveTurnoutBin();
  try {
    const output = execFileSync(bin, ["convert", "-o", "-", "-format", "hcl", turnFilePath], {
      encoding: "buffer",
      timeout: CONVERT_TIMEOUT_MS,
      maxBuffer: CONVERT_MAX_BUFFER,
    });
    return output.toString("utf8");
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
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON model loading
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load a pre-converted JSON model file, skipping the Go converter.
 * Useful for faster test runs after the initial conversion.
 *
 * This is the preferred entry point for environments without `child_process`
 * (browsers, edge functions, WASM hosts): convert the model ahead of time with
 * `runConverter` in a Node build step, then use `loadJsonModel` at runtime to
 * deserialize the JSON without spawning any sub-process.
 */
export function loadJsonModel(jsonFilePath: string): TurnModel {
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
  return parseJSON(raw, jsonFilePath);
}

function parseJSON(raw: string, source: string): TurnModel {
  // In non-production environments, surface unknown fields as warnings so that
  // schema-migration bugs are visible during development.
  if (process.env.NODE_ENV !== "production") {
    try {
      fromJson(TurnModelSchema, JSON.parse(raw) as JsonObject, { ignoreUnknownFields: false });
    } catch (err: unknown) {
      // Only warn — don't throw here; the strict parse is just for diagnostics.
      // The lenient re-parse below is the authoritative one.
      if (err instanceof Error && !err.message.includes("SyntaxError")) {
        console.warn(`[turnout] Unknown fields in model from "${source}": ${err.message}`);
      }
    }
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return fromJson(TurnModelSchema, JSON.parse(raw) as JsonObject, { ignoreUnknownFields: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new BridgeError("ParseError", source, `Invalid JSON from "${source}": ${msg}`);
  }
}

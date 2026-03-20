// Node.js only — uses child_process and fs.
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { TurnModel } from '../types/scene-model.js';

// ─────────────────────────────────────────────────────────────────────────────
// File loading
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read a `.turn` file from disk and return its raw content as a string.
 * Server-only (uses Node.js `fs`).
 */
export function loadTurnFile(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read turn file "${filePath}": ${msg}`);
  }
}

/**
 * Resolve the path to the `turnout` binary.
 * Looks on PATH first; falls back to the built binary in the Go converter package.
 */
function resolveTurnoutBin(): string {
  try {
    // Check if turnout is on PATH
    execSync('turnout --help', { stdio: 'ignore' });
    return 'turnout';
  } catch {
    // Fall back to building from source
    const goConverterDir = new URL(
      '../../../../go/converter',
      import.meta.url,
    ).pathname;
    return `${goConverterDir}/cmd/turnout/turnout`;
  }
}

/**
 * Invoke the Go converter on a .turn file and return the parsed TurnModel.
 * Requires the `turnout` binary to be on PATH (run `go install` from the
 * converter package, or use `go build` to place it on PATH).
 */
export function runConverter(turnFilePath: string): TurnModel {
  const bin = resolveTurnoutBin();
  let output: Buffer;
  try {
    output = execFileSync(bin, ['convert', turnFilePath, '-o', '-', '-format', 'json'], {
      encoding: 'buffer',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`turnout converter failed for "${turnFilePath}": ${msg}`);
  }
  return parseJSON(output.toString('utf8'), turnFilePath);
}

/**
 * Invoke the Go converter on a `.turn` file and return the canonical HCL
 * output as a string.
 * Server-only (requires the `turnout` binary and Node.js `child_process`).
 */
export function convertToHCL(turnFilePath: string): string {
  const bin = resolveTurnoutBin();
  try {
    const output = execFileSync(bin, ['convert', turnFilePath, '-o', '-', '-format', 'hcl'], {
      encoding: 'buffer',
    });
    return output.toString('utf8');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`turnout converter failed for "${turnFilePath}": ${msg}`);
  }
}

/**
 * Load a pre-converted JSON model file, skipping the Go converter.
 * Useful for faster test runs after the initial conversion.
 */
export function loadJsonModel(jsonFilePath: string): TurnModel {
  let raw: string;
  try {
    raw = readFileSync(jsonFilePath, 'utf8');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read JSON model "${jsonFilePath}": ${msg}`);
  }
  return parseJSON(raw, jsonFilePath);
}

function parseJSON(raw: string, source: string): TurnModel {
  try {
    return JSON.parse(raw) as TurnModel;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON from "${source}": ${msg}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Structured error classes for the server (Node.js bridge) layer.
// ─────────────────────────────────────────────────────────────────────────────

export type LoadErrorCode = "FileNotFound" | "ReadError" | "InputTooLarge";

export class LoadError extends Error {
  readonly code: LoadErrorCode;
  readonly filePath: string;

  constructor(code: LoadErrorCode, filePath: string, detail: string) {
    super(`[load] ${detail}`);
    this.name = "LoadError";
    this.code = code;
    this.filePath = filePath;
  }
}

export function isLoadError(e: unknown): e is LoadError {
  return e instanceof LoadError;
}

// ─────────────────────────────────────────────────────────────────────────────

export type BridgeErrorCode =
  | "BinaryNotFound"
  | "BufferOverflow"
  | "ConverterFailed"
  | "InputTooLarge"
  | "ParseError";

export class BridgeError extends Error {
  readonly code: BridgeErrorCode;
  /** File path or descriptor that was the subject of the failed operation. */
  readonly source: string;

  constructor(code: BridgeErrorCode, source: string, detail: string) {
    super(`[bridge] ${detail}`);
    this.name = "BridgeError";
    this.code = code;
    this.source = source;
  }
}

export function isBridgeError(e: unknown): e is BridgeError {
  return e instanceof BridgeError;
}

// ─────────────────────────────────────────────────────────────────────────────

export type HarnessErrorCode =
  | "MissingEntryPoint"
  | "AmbiguousEntryPoint"
  | "PathOutsideBase"
  | "InputTooLarge";

export class HarnessError extends Error {
  readonly code: HarnessErrorCode;

  constructor(code: HarnessErrorCode, detail: string) {
    super(`[harness] ${detail}`);
    this.name = "HarnessError";
    this.code = code;
  }
}

export function isHarnessError(e: unknown): e is HarnessError {
  return e instanceof HarnessError;
}

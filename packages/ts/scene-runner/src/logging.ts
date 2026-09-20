import type { LogEvent } from "./types/harness-types.js";

/**
 * Emit an observational log event without allowing a failing sink to alter
 * execution state or control flow.
 */
export function safeLog(onLog: ((event: LogEvent) => void) | undefined, event: LogEvent): void {
  if (!onLog) return;
  try {
    onLog(event);
  } catch {
    // Logging is observational. Sink failures must not corrupt execution.
  }
}

/**
 * Hand a warning to the caller's sink on the same terms as {@link safeLog}.
 *
 * Warnings are raised from cleanup paths that are already unwinding — an abort,
 * a failed teardown — where there is nothing left to do with a second failure.
 */
export function safeWarn(
  onWarning: ((message: string) => void) | undefined,
  message: string,
): void {
  if (!onWarning) return;
  try {
    onWarning(message);
  } catch {
    // A failing sink must not divert the path that was already unwinding.
  }
}

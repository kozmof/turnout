import type { LogEvent } from "../types/harness-types.js";

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

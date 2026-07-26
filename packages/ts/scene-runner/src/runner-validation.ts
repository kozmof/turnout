import { RunnerError } from "./executor/errors.js";
import type { RunnerOptions } from "./runner-types.js";

export function assertUncheckedStateAllowed(options: RunnerOptions, detail: string): void {
  if (options.allowUncheckedState === true) return;
  throw new RunnerError(
    "UncheckedStateNotAllowed",
    detail + ". Pass allowUncheckedState: true to run without STATE schema.",
  );
}

export function warnUncheckedState(options: RunnerOptions, detail: string): void {
  options.onWarning?.(
    "[turnout] " +
      detail +
      " - using unchecked StateManager. " +
      "All merge writes succeed regardless of path; typo'd paths silently read as null " +
      'on subsequent steps. An "unchecked_state_write" ActionWarning is emitted in the ' +
      "trace for each action that writes to state.",
  );
}

export function validateExecutionLimits(options: RunnerOptions): void {
  for (const [name, value] of [
    ["maxSceneSteps", options.maxSceneSteps],
    ["maxRouteTransitions", options.maxRouteTransitions],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new RunnerError(
        "InvalidExecutionLimit",
        `${name} requires a non-negative safe integer, got ${value}`,
      );
    }
  }
}

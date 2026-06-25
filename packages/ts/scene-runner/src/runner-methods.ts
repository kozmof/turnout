import type { StateManager } from "./state/state-manager.js";
import type { HarnessResult, HookRegistry } from "./types/harness-types.js";
import type { Runner, RunnerStepResult } from "./runner.js";
import { RunnerError } from "./executor/errors.js";

/** Build the mode-independent stepping, lifecycle, and hook-registration API. */
export function makeRunnerMethods<R extends HarnessResult>(
  hooks: HookRegistry,
  advanceFn: () => Promise<RunnerStepResult>,
  doneFn: () => boolean,
  resultFn: () => R,
  partialStateFn: () => StateManager,
  signal: AbortSignal,
): Runner<R> {
  let started = false;
  let inFlight = false;

  function checkAborted(): void {
    if (signal.aborted) throw new DOMException("Runner aborted", "AbortError");
  }

  function assertHooksOpen(): void {
    if (started) {
      throw new RunnerError(
        "LateHookRegistration",
        "hooks must be registered before next(), run(), or runAsync() starts execution",
      );
    }
  }

  function assertStepCount(steps: number): void {
    if (!Number.isSafeInteger(steps) || steps < 1) {
      throw new RunnerError(
        "InvalidStepCount",
        `next(steps) requires a positive safe integer, got ${steps}`,
      );
    }
  }

  function beginExecution(): void {
    if (inFlight) {
      throw new RunnerError(
        "ConcurrentExecution",
        "runner execution is already in progress; await the current next(), run(), or runAsync() step before starting another",
      );
    }
    inFlight = true;
  }

  return {
    usePrepareHook(name, handler) {
      assertHooksOpen();
      hooks.prepare[name] = handler;
      return this;
    },
    usePublishHook(name, handler) {
      assertHooksOpen();
      hooks.publish[name] = handler;
      return this;
    },
    isDone: doneFn,
    async next(steps = 1) {
      assertStepCount(steps);
      started = true;
      beginExecution();
      try {
        const results: Array<Exclude<RunnerStepResult, { done: true }>> = [];
        let actionCount = 0;
        while (actionCount < steps) {
          checkAborted();
          const result = await advanceFn();
          if (result.done) break;
          results.push(result);
          if (result.kind === "action") actionCount++;
        }
        return results;
      } finally {
        inFlight = false;
      }
    },
    async run() {
      started = true;
      beginExecution();
      try {
        while (!doneFn()) {
          checkAborted();
          await advanceFn();
        }
        return resultFn();
      } finally {
        inFlight = false;
      }
    },
    runAsync() {
      started = true;
      return (async function* () {
        beginExecution();
        try {
          while (!doneFn()) {
            checkAborted();
            const result = await advanceFn();
            if (result.done) break;
            yield result;
          }
        } finally {
          inFlight = false;
        }
      })();
    },
    result: resultFn,
    partialState: partialStateFn,
  };
}

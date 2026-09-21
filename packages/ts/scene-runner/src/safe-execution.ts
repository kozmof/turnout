/**
 * What `executeSceneSafe` and `executeRouteSafe` share.
 *
 * The two are the same function over different entry shapes: validate, build a
 * runner, register hooks, drain it while tracking where execution currently is,
 * then either unwrap the trace or return the failure with the state committed
 * so far. They had that body written out twice, with the cursor, the trace
 * discriminant, and the error normalisation as the only real differences — and
 * three accidental ones on top, which is what happens to duplicated code:
 * the step limit was positional in one and an option in the other, `partialState`
 * named a `StateManager` in one and a plain record in the other, and only one of
 * them normalised its errors.
 */
import type { LogEvent } from "./types/harness-types.js";
import type { RunnerStepResult } from "./runner-types.js";

type Step = Exclude<RunnerStepResult, { done: true }>;

/** The part of a Runner a safe wrapper drives. */
type Drivable = {
  isDone(): boolean;
  next(steps?: number): Promise<Step[]>;
};

/** Runs to completion, handing every step to `onStep` so the caller can track a cursor. */
export async function drainRunner(runner: Drivable, onStep: (step: Step) => void): Promise<void> {
  while (!runner.isDone()) {
    for (const step of await runner.next()) onStep(step);
  }
}

/**
 * Wraps `onLog` so the runner's own lifecycle events do not reach it.
 *
 * These wrappers predate the Runner API and report a scene or a route as one
 * call, so the per-scene and per-route bracketing events would arrive at a
 * caller that never asked to be told a run started. Each wrapper drops the
 * brackets its own return value already implies; `kinds` is that list.
 *
 * Returns `undefined` for an absent `onLog` so the result can be spread
 * straight into options under `exactOptionalPropertyTypes`.
 */
export function withoutLifecycleLogs(
  onLog: ((event: LogEvent) => void) | undefined,
  kinds: readonly LogEvent["kind"][],
): ((event: LogEvent) => void) | undefined {
  if (onLog === undefined) return undefined;
  const dropped: ReadonlySet<string> = new Set(kinds);
  return (event: LogEvent) => {
    if (!dropped.has(event.kind)) onLog(event);
  };
}

/** Reads a string field off a thrown value. */
export function errorField(caught: unknown, field: string): string | undefined {
  if (typeof caught !== "object" || caught === null) return undefined;
  const value = (caught as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

/**
 * Reads a string field off a thrown value, falling back to its `context`.
 *
 * `SceneRuntimeError` carries `actionId` under `context`; the engine's own
 * status errors carry it at the top level. Both are the same question.
 */
export function errorFieldOrContext(caught: unknown, field: string): string | undefined {
  const top = errorField(caught, field);
  if (top !== undefined) return top;
  const context = (caught as { context?: unknown } | null)?.context;
  return errorField(context, field);
}

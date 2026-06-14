import type { HarnessOptions, FullHarnessResult } from "../types/harness-types.js";
import { createRunner } from "../runner.js";

/**
 * Universal harness entry point (client + server).
 *
 * Accepts a pre-parsed TurnModel, builds STATE, then dispatches to the route
 * or scene executor based on `entryId`.
 *
 * To load a model from a .turn or .json file (Node.js only), use
 * `runServerHarness` from the server entry point instead.
 *
 * Dispatch rules:
 *  - `entryId` matches a `route.id`  → route executor
 *  - `entryId` matches a `scene.id`  → scene executor
 *  - no match                         → throws
 *
 * All `ExecutionOptions` fields (`signal`, `onWarning`, `maxSceneSteps`,
 * `maxRouteTransitions`) are forwarded to the underlying Runner.
 */
export async function runHarness(options: HarnessOptions): Promise<FullHarnessResult> {
  const runner = createRunner(options.model, options);

  for (const [name, handler] of Object.entries(options.hooks?.prepare ?? {})) {
    runner.usePrepareHook(name, handler);
  }
  for (const [name, handler] of Object.entries(options.hooks?.publish ?? {})) {
    runner.usePublishHook(name, handler);
  }

  return runner.run();
}

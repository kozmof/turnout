import type { HarnessOptions, FullHarnessResult } from "../types/harness-types.js";
import { createRunner } from "../runner.js";

/** Run a parsed model through the universal Zig-backed Runner. */
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

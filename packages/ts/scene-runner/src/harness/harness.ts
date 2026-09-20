import type { HarnessOptions, FullHarnessResult } from "../types/harness-types.js";
import { createRunner } from "../runner.js";
import { registerHooks } from "../register-hooks.js";

/** Run a parsed model through the universal Zig-backed Runner. */
export async function runHarness(options: HarnessOptions): Promise<FullHarnessResult> {
  const runner = createRunner(options.model, options);
  registerHooks(runner, options.hooks);
  return runner.run();
}

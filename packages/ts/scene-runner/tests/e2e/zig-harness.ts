import { runHarness } from "../../src/harness/harness.js";
import { runServerHarness } from "../../src/server/harness.js";
import type { ServerHarnessOptions } from "../../src/server/harness.js";
import type { FullHarnessResult, HarnessOptions } from "../../src/types/harness-types.js";

export function runZigHarness(options: HarnessOptions): Promise<FullHarnessResult> {
  return runHarness(options);
}

export function runZigServerHarness(options: ServerHarnessOptions): Promise<FullHarnessResult> {
  return runServerHarness(options);
}

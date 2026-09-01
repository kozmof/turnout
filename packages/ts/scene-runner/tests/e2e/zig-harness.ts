import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runHarnessWithEngine } from "../../src/harness/harness.js";
import { runServerHarnessWithEngine } from "../../src/server/harness.js";
import type { ServerHarnessOptions } from "../../src/server/harness.js";
import type { FullHarnessResult, HarnessOptions } from "../../src/types/harness-types.js";
import { instantiateZigRuntime, type ZigRuntimeClient } from "../../src/zig-runtime/client.js";

let clientPromise: Promise<ZigRuntimeClient> | undefined;

function zigClient(): Promise<ZigRuntimeClient> {
  clientPromise ??= instantiateZigRuntime(
    readFileSync(resolve(__dirname, "../../../../zig/zig-out/bin/turnout-runtime.wasm")),
  );
  return clientPromise;
}

export async function runZigHarness(options: HarnessOptions): Promise<FullHarnessResult> {
  return runHarnessWithEngine(options, { kind: "zig", client: await zigClient() });
}

export async function runZigServerHarness(
  options: ServerHarnessOptions,
): Promise<FullHarnessResult> {
  return runServerHarnessWithEngine(options, { kind: "zig", client: await zigClient() });
}

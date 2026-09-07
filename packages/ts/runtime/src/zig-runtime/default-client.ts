import { readFile } from "node:fs/promises";
import { instantiateZigRuntime } from "./client.js";

async function loadRuntimeBytes(): Promise<Uint8Array> {
  const packagedUrl = new URL("./turnout-runtime.wasm", import.meta.url);
  try {
    return await readFile(packagedUrl);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    return readFile(new URL("../../../../zig/zig-out/bin/turnout-runtime.wasm", import.meta.url));
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

/**
 * The process-wide runtime client, instantiated once on import.
 *
 * A trapped instance cannot be repaired, and this binding cannot be replaced,
 * so a trap here is terminal for the process: every later call throws
 * `ZigTrapError`. Check `defaultZigRuntimeClient.usable` if a caller needs to
 * distinguish that from an ordinary failure. A host that must survive a trap
 * should own its own client from {@link instantiateZigRuntime} and re-create it
 * — noting that every runtime and model handle dies with the old instance.
 *
 * Reaching that state means finding an input that still exhausts the module.
 * The known ones are bounded and return a status instead; see
 * `docs/runtime-contract.md`.
 */
export const defaultZigRuntimeClient = await instantiateZigRuntime(await loadRuntimeBytes());

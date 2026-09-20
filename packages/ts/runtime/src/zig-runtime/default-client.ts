import { instantiateZigRuntime } from "./client.js";
import { readFirstAvailable } from "./wasm-bytes.js";

/**
 * Where the engine's bytes may be: the copy a built package carries next to
 * this file, then the one `zig build` leaves in the monorepo for a checkout
 * that has not run `pnpm build` yet. Order matters — a packaged copy is the
 * one that belongs to this install.
 */
function runtimeBytesCandidates(): readonly URL[] {
  return [
    new URL("./turnout-runtime.wasm", import.meta.url),
    new URL("../../../../zig/zig-out/bin/turnout-runtime.wasm", import.meta.url),
  ];
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
export const defaultZigRuntimeClient = await instantiateZigRuntime(
  await readFirstAvailable(runtimeBytesCandidates()),
);

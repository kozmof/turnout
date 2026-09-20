import { instantiateZigRuntime, type ZigRuntimeClient } from "./client.js";
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
 * Instantiating at import time is what lets the synchronous API be synchronous:
 * `buildNumber`, `executeGraph` and the rest cross into the engine on every
 * call, and none of them can await an instance that is not ready yet.
 *
 * A trapped instance cannot be repaired. It can now be *replaced* — see
 * {@link reloadDefaultZigRuntimeClient} and {@link setDefaultZigRuntimeClient}.
 * This is a live binding, so every caller picks up the replacement on its next
 * call without re-importing. Every runtime and model handle held against the
 * old instance dies with it, so a caller holding one must discard it: a
 * `PreparedModel` from the old instance, handed to a runner on the new one, is
 * a handle that instance never issued.
 *
 * Check `defaultZigRuntimeClient.usable` to tell a trap from an ordinary
 * failure. Reaching that state means finding an input that still exhausts the
 * module; the known ones are bounded and return a status instead, per
 * `docs/runtime-contract.md`.
 */
export let defaultZigRuntimeClient: ZigRuntimeClient = await instantiateZigRuntime(
  await readFirstAvailable(runtimeBytesCandidates()),
);

/**
 * Replace the process-wide client.
 *
 * For hosts that build their own instance with `instantiateZigRuntime` and want
 * the synchronous API — value builders, `executeGraph`, the preset metadata
 * lookups — to use it too. Those reach for this binding directly and take no
 * client argument, so this is the only way to point them somewhere else.
 *
 * Replacing a working client abandons nothing on its own, but any handle taken
 * from it becomes unusable the moment the last reference to it goes.
 */
export function setDefaultZigRuntimeClient(client: ZigRuntimeClient): void {
  defaultZigRuntimeClient = client;
}

/**
 * Instantiate a fresh engine and install it as the process-wide client.
 *
 * The recovery path after a trap, which is otherwise terminal for the process:
 * every later call on a trapped instance throws `ZigTrapError`, and there is no
 * way to reset one from outside. Reads the same bytes the original was built
 * from.
 *
 * Returns the new client. Discard every runtime and model handle taken from the
 * old one first — they mean nothing to this instance.
 */
export async function reloadDefaultZigRuntimeClient(): Promise<ZigRuntimeClient> {
  const client = await instantiateZigRuntime(await readFirstAvailable(runtimeBytesCandidates()));
  defaultZigRuntimeClient = client;
  return client;
}

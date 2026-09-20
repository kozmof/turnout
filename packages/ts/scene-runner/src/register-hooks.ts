import type { HarnessResult, HookRegistry } from "./types/harness-types.js";
import type { Runner } from "./runner-types.js";

/**
 * Register every hook a caller supplied on a runner.
 *
 * There is one of these rather than one per entry point because there have been
 * three, and they disagreed: `runHarness` registered all three kinds while
 * `executeSceneSafe` and `executeRouteSafe` registered prepare and publish and
 * dropped extend on the floor. `HookRegistry` makes `extend` required, so a
 * caller was obliged to supply extend hooks and then got no error, no warning,
 * and an action that failed later with `MissingExtendHook` — pointing at the
 * model rather than at the registration that never happened.
 *
 * Adding a fourth hook kind should be a change to one function. This is it.
 */
export function registerHooks(
  runner: Runner<HarnessResult>,
  hooks: Partial<HookRegistry> | undefined,
): void {
  for (const [name, handler] of Object.entries(hooks?.prepare ?? {})) {
    runner.usePrepareHook(name, handler);
  }
  for (const [name, handler] of Object.entries(hooks?.extend ?? {})) {
    runner.useExtendHook(name, handler);
  }
  for (const [name, handler] of Object.entries(hooks?.publish ?? {})) {
    runner.usePublishHook(name, handler);
  }
}

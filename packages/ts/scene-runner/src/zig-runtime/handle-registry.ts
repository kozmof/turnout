import {
  recordLateModelHandle,
  recordLateRuntimeHandle,
  recordLeakedHandle,
  recordLeakedModelHandle,
} from "./leaked-handles.js";
import { safeWarn } from "../logging.js";

/**
 * A last resort for handles whose owner was collected without giving them back.
 *
 * Every handle has an owner that can close it deterministically — a runner
 * finishes, throws, is aborted, or is disposed; a prepared model is released or
 * disposed. Those are the paths that should run, and a handle that comes back
 * through here came back late, at a moment the garbage collector chose.
 *
 * It exists because the alternative is worse. Handles are monotonic and never
 * recycled, so one that is never destroyed is gone for the life of the process,
 * and the WASM instance is process-wide: the STATE behind it is never reclaimed
 * either. A runner constructed and then dropped — an exception between
 * `createRunner` and `run()`, a request handler that returns early — used to
 * leave exactly that, with no owner left to close it and nothing recording that
 * it had happened. A prepared model whose `release()` was forgotten left the
 * same thing, and not even the warning.
 *
 * So this is a backstop, and it is deliberately noisy: reaching it is a bug in
 * the caller, {@link lateReclaimedHandles} counts how often, and the warning
 * names the fix. It is not a substitute for closing a handle, because a
 * finalizer runs when the collector gets to it, which may be long after the
 * handle space is under pressure and may be never.
 *
 * The callback must not capture the owner, or the owner is never collected and
 * the finalizer never runs. It captures the destroy closure and the handle,
 * which the owner does not reference back.
 */

type Kind = "runtime" | "model";

export interface Registration {
  kind: Kind;
  handle: number;
  destroy: () => void;
  onWarning: ((message: string) => void) | undefined;
}

const recordLate = { runtime: recordLateRuntimeHandle, model: recordLateModelHandle };
const recordLeak = { runtime: recordLeakedHandle, model: recordLeakedModelHandle };
const owner = { runtime: "runner", model: "prepared model" };
const remedy = {
  runtime: "run it to completion, dispose it with `using`, or abort its signal",
  model: "call release(), or hold it with `using`",
};

/**
 * What the finalizer does with one registration.
 *
 * Exported because a finalizer callback cannot be driven on purpose — it runs
 * when the collector gets to it, and `globalThis.gc` is not exposed under the
 * test runner. The registry's own job is two calls to the platform; this is the
 * behaviour worth testing, so it is reachable without waiting for a collection.
 *
 * @internal
 */
export function reclaimHandle({ kind, handle, destroy, onWarning }: Registration): void {
  let failed: unknown;
  try {
    destroy();
  } catch (error) {
    failed = error;
  }
  if (failed !== undefined) {
    // The backstop itself could not give the handle back, so this one really is
    // gone. Count it where a host is already looking for leaks.
    const leaked = recordLeak[kind](handle);
    safeWarn(
      onWarning,
      `[turnout] ${kind} handle ${handle} was collected without being closed and ` +
        `could not be destroyed: ${failed instanceof Error ? failed.message : String(failed)} ` +
        `(${leaked} ${kind} handles leaked so far this process; handles are not ` +
        `recycled, so this is cumulative)`,
    );
    return;
  }
  const late = recordLate[kind](handle);
  safeWarn(
    onWarning,
    `[turnout] ${kind} handle ${handle} was reclaimed by a finalizer because its ` +
      `${owner[kind]} was collected without being closed. The handle came back, but at a ` +
      `time the garbage collector chose — ${remedy[kind]} (${late} handles reclaimed this ` +
      `way so far this process)`,
  );
}

const registry =
  typeof FinalizationRegistry === "function"
    ? new FinalizationRegistry<Registration>(reclaimHandle)
    : undefined;

/**
 * Watch `holder` and destroy `handle` if it is collected before {@link unwatchHandle}.
 *
 * Returns the token to pass back on close. A runtime without
 * `FinalizationRegistry` gets no backstop and no error: the deterministic paths
 * are unaffected, which is every path that was already correct.
 */
export function watchHandle(holder: object, registration: Registration): { unwatch: () => void } {
  if (registry === undefined) return { unwatch: () => {} };
  const token = {};
  registry.register(holder, registration, token);
  let unwatched = false;
  return {
    unwatch: () => {
      if (unwatched) return;
      unwatched = true;
      registry.unregister(token);
    },
  };
}

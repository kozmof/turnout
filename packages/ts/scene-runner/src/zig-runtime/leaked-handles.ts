/**
 * A tally of engine handles this process did not give back on time.
 *
 * Handles are monotonic and never recycled — `packages/zig/wasm/src/abi.zig`
 * explains why — so the space is finite and a handle that is never destroyed is
 * never returned to it. One leak is a curiosity. A leak on every run is a
 * countdown: the counter wraps at 2^32, the zero it wraps to is the sentinel,
 * and the instance then refuses to issue any handle at all, permanently.
 *
 * Until now the only trace of that was a `console.warn` per occurrence, which
 * says nothing about whether this is the first or the hundred-thousandth. The
 * cumulative count is the number that decides whether anything is wrong, so it
 * is kept, surfaced on the warning, and readable by a host that wants to alert
 * on it.
 *
 * Two kinds are tracked, because there are two kinds of handle and only one of
 * them was ever visible. A runtime handle is one run; a model handle is one
 * `prepareModel`, and `release()` on it is manual, so a caller who forgets
 * leaked one with nothing recording that it had happened.
 *
 * And two ways of not giving one back, which are not equally bad:
 *
 *   - **leaked** — the engine was asked and refused, or nothing ever asked. The
 *     handle is gone for the life of the process. This is the number to alert
 *     on.
 *   - **reclaimed late** — nothing asked, but the object went out of scope and
 *     {@link ../handle-registry.js} destroyed the handle from a finalizer. The
 *     handle came back, so it is not a leak; it came back at a time the garbage
 *     collector chose, which is not a resource discipline. A rising count here
 *     means callers are relying on the backstop, and the fix is `using`, or a
 *     `release()` in a `finally`.
 */

/** How many handles of each kind to remember individually. */
const retained = 32;

type Tally = { count: number; handles: number[] };

const tallies: Record<"runtime" | "model", Record<"leaked" | "reclaimedLate", Tally>> = {
  runtime: { leaked: { count: 0, handles: [] }, reclaimedLate: { count: 0, handles: [] } },
  model: { leaked: { count: 0, handles: [] }, reclaimedLate: { count: 0, handles: [] } },
};

function record(tally: Tally, handle: number): number {
  tally.count += 1;
  // The list is a debugging aid, not the tally, and a leak every run must not
  // turn it into a second leak.
  if (tally.handles.length < retained) tally.handles.push(handle);
  return tally.count;
}

function read(tally: Tally): { count: number; handles: readonly number[] } {
  return { count: tally.count, handles: [...tally.handles] };
}

/** Records a runtime handle the engine would not destroy. Returns the running total. */
export function recordLeakedHandle(handle: number): number {
  return record(tallies.runtime.leaked, handle);
}

/** Records a model handle the engine would not destroy. Returns the running total. */
export function recordLeakedModelHandle(handle: number): number {
  return record(tallies.model.leaked, handle);
}

/** Records a runtime handle a finalizer gave back. Returns the running total. */
export function recordLateRuntimeHandle(handle: number): number {
  return record(tallies.runtime.reclaimedLate, handle);
}

/** Records a model handle a finalizer gave back. Returns the running total. */
export function recordLateModelHandle(handle: number): number {
  return record(tallies.model.reclaimedLate, handle);
}

/**
 * Runtime handles this process has leaked.
 *
 * `count` is every one of them. `handles` is the first {@link retained}, kept
 * for a host that wants to name them in a report; a longer run leaks more than
 * it lists, and `count` is the one to alert on.
 */
export function leakedRuntimeHandles(): { count: number; handles: readonly number[] } {
  return read(tallies.runtime.leaked);
}

/** Model handles this process has leaked. Shaped as {@link leakedRuntimeHandles}. */
export function leakedModelHandles(): { count: number; handles: readonly number[] } {
  return read(tallies.model.leaked);
}

/**
 * Handles a finalizer gave back after the object holding them was collected.
 *
 * Not leaks — these came back. A count that climbs says callers are leaving the
 * backstop to do it, which is worth fixing before a run allocates faster than
 * the collector reclaims.
 */
export function lateReclaimedHandles(): {
  runtime: { count: number; handles: readonly number[] };
  model: { count: number; handles: readonly number[] };
} {
  return {
    runtime: read(tallies.runtime.reclaimedLate),
    model: read(tallies.model.reclaimedLate),
  };
}

/** Clears every tally. For tests, and for a host that has just reloaded the engine. */
export function resetLeakedRuntimeHandles(): void {
  for (const kind of Object.values(tallies)) {
    for (const tally of Object.values(kind)) {
      tally.count = 0;
      tally.handles.length = 0;
    }
  }
}

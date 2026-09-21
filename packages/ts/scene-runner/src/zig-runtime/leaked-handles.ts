/**
 * A tally of runtime handles the engine would not take back.
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
 */

/** How many leaked handles to remember individually. */
const retained = 32;

let count = 0;
const handles: number[] = [];

/** Records a handle the engine would not destroy. Returns the running total. */
export function recordLeakedHandle(handle: number): number {
  count += 1;
  // The list is a debugging aid, not the tally, and a leak every run must not
  // turn it into a second leak.
  if (handles.length < retained) handles.push(handle);
  return count;
}

/**
 * Runtime handles this process has leaked.
 *
 * `count` is every one of them. `handles` is the first {@link retained}, kept
 * for a host that wants to name them in a report; a longer run leaks more than
 * it lists, and `count` is the one to alert on.
 */
export function leakedRuntimeHandles(): { count: number; handles: readonly number[] } {
  return { count, handles: [...handles] };
}

/** Clears the tally. For tests, and for a host that has just reloaded the engine. */
export function resetLeakedRuntimeHandles(): void {
  count = 0;
  handles.length = 0;
}

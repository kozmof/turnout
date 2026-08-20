/**
 * Execution-owned snapshots of protobuf model fragments.
 *
 * Generated protobuf message types are mutable. The runner keeps identity-based
 * caches for immutable execution plans, so accepting caller-owned objects
 * directly would allow later mutations to make those caches stale.
 *
 * Every public entry point snapshots its input, and the composed entry points
 * layer on top of each other — `createRunner` hands an already-snapshotted scene
 * to `createSceneRunner`, which would otherwise snapshot it a second time. So
 * snapshots are tracked and re-snapshotting one is a no-op. That matters for
 * more than allocation: `structuredClone` mints fresh objects, and the executor
 * caches its built contexts in a `WeakMap` keyed on `ProgModel` identity. A
 * second clone would swap out the very keys those caches were warmed with,
 * silently reducing them to permanent misses.
 */

/**
 * Objects this module produced. A `WeakSet` keeps no strong references, so
 * membership disappears with the snapshot itself.
 */
const snapshots = new WeakSet<object>();

/** True when `value` is already an execution-owned snapshot. */
export function isSnapshot(value: unknown): boolean {
  return typeof value === "object" && value !== null && snapshots.has(value);
}

/**
 * Take an execution-owned snapshot of a protobuf model fragment.
 *
 * Returns `value` unchanged when it is already a snapshot, so composing entry
 * points costs nothing and preserves object identity for the caches downstream.
 */
export function snapshotModel<T>(value: T): T {
  if (isSnapshot(value)) return value;
  return deepFreeze(structuredClone(value));
}

/**
 * Snapshot a `Record<string, T>` whose values may already be snapshots.
 *
 * `snapshotModel` on the record itself would deep-clone every value, because the
 * record is a fresh container even when everything inside it is already owned —
 * which is exactly the shape `createRunner` builds its scene map in. This copies
 * the container and snapshots each value individually, so owned values pass
 * through by reference.
 */
export function snapshotRecord<T>(record: Readonly<Record<string, T>>): Record<string, T> {
  if (isSnapshot(record)) return record;
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = snapshotModel(value);
  }
  return deepFreeze(out);
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  // An owned subtree is already frozen and marked all the way down, so stop
  // here. This is what keeps snapshotRecord proportional to the number of keys
  // rather than to the size of the whole model hanging off them.
  if (snapshots.has(value)) return value;

  seen.add(value);
  snapshots.add(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested, seen);
  }
  return Object.freeze(value);
}

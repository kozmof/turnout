/**
 * Take an execution-owned snapshot of a protobuf model fragment.
 *
 * Generated protobuf message types are mutable. The runner keeps identity-based
 * caches for immutable execution plans, so accepting caller-owned objects
 * directly would allow later mutations to make those caches stale.
 */
export function snapshotModel<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;

  seen.add(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested, seen);
  }
  return Object.freeze(value);
}

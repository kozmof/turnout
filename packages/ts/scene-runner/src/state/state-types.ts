import type { AnyValue } from "runtime";

/**
 * Read-only view of STATE. Callers that only need to inspect state (not mutate
 * it) should accept `StateReader` rather than the full `StateManager` so the
 * data-flow contract is explicit at each call site.
 */
export interface StateReader {
  /**
   * Read a value by dotted path, throwing if the path is unknown in schema-backed managers.
   * For unchecked managers, treats all paths as valid and returns `buildNull('missing')` when absent.
   *
   * **Important:** `read()` returns `buildNull('missing')` for *both* "path not written" and
   * "path undeclared" cases. If you need to distinguish them, use `readOrUndefined()` (returns
   * `undefined` for absent/undeclared paths) or combine `isDeclared()` with `exists()`.
   */
  read(path: string): AnyValue;
  /**
   * Like read() but returns undefined when the path is undeclared (schema-backed managers)
   * or absent (unchecked managers), instead of throwing or returning buildNull('missing').
   */
  readOrUndefined(path: string): AnyValue | undefined;
  /**
   * Return true if path is declared in the schema (schema-backed managers), or
   * always true for unchecked managers (all paths are treated as valid).
   */
  isDeclared(path: string): boolean;
  /**
   * Return true if a value has been written to `path` in the current state.
   * Unlike `isDeclared()`, this reflects actual written state, not schema membership.
   */
  exists(path: string): boolean;
  /** Return a shallow copy of the current state record. */
  snapshot(): Readonly<Record<string, AnyValue>>;
  /**
   * Invoke `cb` for each path that has a written value in the current state.
   * Unlike `snapshot()`, this does not allocate a copy of the state record —
   * prefer it when you only need to iterate without retaining the entries.
   */
  forEach(cb: (path: string, value: AnyValue) => void): void;
  /**
   * Return the set of declared valid paths, or `null` for unchecked (schema-unmanaged) managers.
   *
   * `null` means the manager accepts **any** path — no schema was provided. A non-null set
   * means only the listed paths are valid; writes and reads outside the set throw.
   *
   * Prefer `isSchemaManaged()` to branch on schema presence. Use `validPaths()` only when
   * you specifically need to enumerate or look up the declared path set (e.g. to build a
   * completion list). Never rely on the `null` vs non-null distinction alone to decide
   * whether a path exists — use `isDeclared(path)` for that.
   */
  validPaths(): ReadonlySet<string> | null;
  /**
   * Return true when this manager enforces path and type validation on every write.
   */
  isSchemaManaged(): boolean;
}

/**
 * StateManager holds STATE as a flat Record keyed by dotted path
 * ("namespace.field"). All mutations return a new instance, preserving
 * immutability across action boundaries.
 */
export interface StateManager extends StateReader {
  /**
   * Return a new StateManager with the given path set to value.
   * Does not mutate the current instance.
   *
   * @performance Creates a new state object on every call. Prefer `writeBatch()`
   * when writing multiple fields at once to avoid O(n) intermediate allocations.
   */
  write(path: string, value: AnyValue): StateManager;
  /**
   * Return a new StateManager with all entries in `batch` applied atomically.
   * Validates all paths and types before writing — throws on the first violation.
   * Prefer this over repeated `write()` calls when merging multiple bindings at
   * once: it allocates a single new state object regardless of batch size.
   *
   * @example
   * // Merge all action output bindings into state in one allocation:
   * const nextState = state.writeBatch({
   *   'player.score': buildNumber(42),
   *   'player.label': buildString('winner'),
   * });
   */
  writeBatch(batch: Record<string, AnyValue>): StateManager;
}

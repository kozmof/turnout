import type { ExecutionContext, ValidatedContext, FuncId, ValueId } from "runtime";
import type { ProgModel } from "../types/turnout-model_pb.js";

// ─────────────────────────────────────────────────────────────────────────────
// Public types (defined here to break the circular import with hcl-context-builder)
// ─────────────────────────────────────────────────────────────────────────────

export type BindingResolution =
  | { kind: "func"; id: FuncId }
  | { kind: "value"; id: ValueId }
  | { kind: "missing" };

/** Sentinel returned by `resolve()` when the name is not in the context. */
export const MISSING_BINDING: BindingResolution = { kind: "missing" };

export type BuiltContext = {
  /**
   * Returns the underlying ExecutionContext for passing to `assertValidContext`
   * or `executeGraph`. This is the only supported way to access the context
   * outside of this module; direct field access is intentionally absent.
   */
  getExec(): ExecutionContext;
  /**
   * Returns a pre-validated `ValidatedContext`, avoiding the need for callers
   * to call `assertValidContext(builtCtx.getExec())` as a separate step.
   * Validation runs once at context-build time and is cached here.
   */
  getValidatedExec(): ValidatedContext;
  /** Returns the ValueId for a binding name, or `undefined` when not found. */
  resolveValueId(name: string): ValueId | undefined;
  /**
   * Returns the resolution for a binding name.
   * Returns `{ kind: 'missing' }` when the name is not in the context.
   * Use `kind === 'func'` / `'value'` / `'missing'` for exhaustive handling.
   */
  resolve(name: string): BindingResolution;
};

// ─────────────────────────────────────────────────────────────────────────────
// Pure-compute context cache
//
// When a prog has no injected values (no prepare entries), its ExecutionContext
// is fully determined by the ProgModel. We cache it keyed on ProgModel object
// identity so that repeated calls across turns (e.g. a stateless action executed
// on every turn) avoid rebuilding the context from scratch each time.
//
// Keyed by ProgModel *object identity*:
//   - Cache hits: same ProgModel object reused across calls — the typical case
//     when the TurnModel is loaded once at startup and kept in memory.
//   - Cache misses: JSON.parse on every request produces a fresh object graph;
//     the cache never hits, and each call pays the full build cost.
// Recommended pattern: parse the TurnModel once at startup and reuse the same
// reference across all runner invocations.
// ─────────────────────────────────────────────────────────────────────────────
export let pureProgCtxCache = new WeakMap<ProgModel, BuiltContext>();

// Memoises the set of function-binding names per ProgModel. ProgModels are
// immutable after construction, so the set never changes; caching avoids the
// filter+map allocation on every ContextSpecBuilder construction.
export let funcBindingNamesCache = new WeakMap<ProgModel, Set<string>>();

function clearContextCaches(): void {
  pureProgCtxCache = new WeakMap();
  funcBindingNamesCache = new WeakMap();
}

/**
 * Returns test-only hooks for this module. Import this via test-support.ts,
 * never from production code.
 */
export function _testHooks() {
  return { clearContextCaches };
}

export function getFuncBindingNames(prog: ProgModel): Set<string> {
  let s = funcBindingNamesCache.get(prog);
  if (!s) {
    s = new Set(prog.bindings.filter((b) => b.expr !== undefined).map((b) => b.name));
    funcBindingNamesCache.set(prog, s);
  }
  return s;
}

import { ctx, assertValidContext } from "runtime";
import type { AnyValue, FuncId, FuncTable, ValueId, ContextSpec } from "runtime";
import { FN_MAP } from "./fn-map.generated.js";
import type { ProgModel } from "../types/turnout-model_pb.js";
import { getFuncBindingNames, pureProgCtxCache } from "./hcl-cache.js";
import { buildSpec } from "./hcl-spec-builder.js";
import { buildNameToValueId } from "./hcl-name-resolver.js";
import { toFuncId, toValueId } from "./dynamic-boundary.js";

// FN_MAP is generated from spec/fn-aliases.json. To add a built-in, update
// spec/fn-aliases.json and run: node --experimental-strip-types scripts/gen-fn-map.ts
export { FN_MAP };

// Re-export all public types and sub-module exports so all callers continue to
// import from one place.
export type { BuiltContext, BindingResolution } from "./hcl-cache.js";
export { MISSING_BINDING } from "./hcl-cache.js";
export { buildSpec } from "./hcl-spec-builder.js";
export { buildNameToValueId } from "./hcl-name-resolver.js";
export { _testHooks } from "./hcl-cache.js";

import type { BuiltContext, BindingResolution } from "./hcl-cache.js";
import { MISSING_BINDING } from "./hcl-cache.js";

// ─────────────────────────────────────────────────────────────────────────────
// Branded-type assertion helpers
//
// The ctx() builder is generic over a statically-known ContextSpec, so its
// return type encodes every key as a branded ID. When we build a spec from a
// dynamic proto model the type system cannot infer the specific keys, making
// unsafe casts unavoidable at this boundary. Concentrating them here makes the
// escape hatch explicit and keeps the rest of the bridge type-clean.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Public builder — orchestrates the two phases
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Translate a `ProgModel` and a map of pre-resolved injected values into an
 * `ExecutionContext` ready for `assertValidContext` + `executeGraph`.
 *
 * `injectedValues` are values resolved by the prepare resolver (from_state,
 * from_action, from_hook). They override the binding's declared literal default.
 *
 * `contextId` is included in any `SceneRuntimeError` thrown during context
 * construction (e.g. unknown HCL function names). Pass the action ID so errors
 * surface the actual source rather than the generic `'(unknown)'` placeholder.
 *
 * @remarks
 * Results are cached in `pureProgCtxCache` keyed by `ProgModel` object identity
 * when `injectedValues` is empty. The cache is only effective when the same
 * `ProgModel` reference is reused across calls — deserializing from JSON on each
 * request produces a fresh object and bypasses the cache entirely.
 */
export function buildContextFromProg(
  prog: ProgModel,
  injectedValues: Record<string, AnyValue>,
  contextId = "(unknown)",
): BuiltContext {
  const hasInjected = Object.keys(injectedValues).length > 0;
  if (!hasInjected) {
    const cached = pureProgCtxCache.get(prog);
    if (cached) return cached;
  }

  const spec = buildSpec(prog, injectedValues, contextId);
  const result = ctx(spec as ContextSpec); // dynamic spec — branded keys unavailable statically
  const ids = result.ids as Record<string, FuncId | ValueId>; // see toFuncId/toValueId in dynamic-boundary
  const funcTable: FuncTable = result.exec.funcTable;
  const nameToValueId = buildNameToValueId(prog.bindings, ids, funcTable, contextId);
  const funcBindingNames = getFuncBindingNames(prog);
  function resolve(name: string): BindingResolution {
    if (!Object.prototype.hasOwnProperty.call(ids, name)) return MISSING_BINDING;
    return funcBindingNames.has(name)
      ? { kind: "func", id: toFuncId(ids[name] as string) }
      : { kind: "value", id: toValueId(ids[name] as string) };
  }
  const exec = result.exec;
  // Pre-validate once at build time so callers can use getValidatedExec() without
  // paying the assertValidContext cost on every call site.
  const validatedExec = assertValidContext(exec);
  const builtCtx: BuiltContext = {
    getExec: () => exec,
    getValidatedExec: () => validatedExec,
    resolveValueId: (name) => nameToValueId.get(name),
    resolve,
  };

  if (!hasInjected) pureProgCtxCache.set(prog, builtCtx);
  return builtCtx;
}

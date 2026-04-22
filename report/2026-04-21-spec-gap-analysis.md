# Spec Gap Analysis — 2026-04-21

> Scope: Comparison of all spec files under `/spec/` against the current codebase implementation.

---

## Summary

Four gaps identified. The core computation pipeline, state management, route routing, effect DSL sigils, and HCL lowering are all well-aligned with their respective specs. The gaps are concentrated in the hook system and the TransformFn DSL surface syntax.

| # | Gap | Spec | Severity | Status |
|---|-----|------|----------|--------|
| 1 | Publish hooks never invoked in action executor | `hook-spec.md §3`, `scene-graph.md §7` | **Critical** | ✅ Fixed 2026-04-22 |
| 2 | Hook context API doesn't match spec | `hook-spec.md §3.1` | **Medium** | ✅ Fixed 2026-04-22 |
| 3 | TransformFn DSL method-call syntax not in Go converter | `transform-fn-dsl-spec.md` | **Medium** | Open |
| 4 | `string.toNumber()` uses `parseInt` (truncates decimals) | `transform-fn-dsl-spec.md §CAN'T` | **Low** | Open |

---

## GAP 1 — Publish hooks are not invoked ✅ Fixed 2026-04-22

**Spec references**: `hook-spec.md §3`, `hook-spec.md §1.4`, `scene-graph.md §7 step 7`, `convert-runtime-spec.md Phase 2`

**What the spec requires**:
After the merge step completes, all hooks listed in `action.publish` must fire in declaration order, each receiving the complete final action state (read-only). Return values are ignored.

**What the code did**:
`packages/ts/scene-runner/src/executor/action-executor.ts` performed five steps — prepare, build context, execute graph, extract bindings, apply merge — then returned. Step 6 (publish hooks) was entirely absent. `ActionModel.publish: string[]` was populated from the protobuf model but never read by the executor.

**Fix**:
Added Step 6 to `executeAction` in `action-executor.ts`: after the merge loop, iterates `action.publish` and invokes each named hook from the registry with the final merged state snapshot via `PublishHookContext`. Unregistered hooks are silently skipped.

---

## GAP 2 — Hook context API doesn't match spec ✅ Fixed 2026-04-22

**Spec reference**: `hook-spec.md §3.1`

**What the spec requires**:
```typescript
interface PrepareHookContext {
  readonly actionId: string;
  readonly hookName: string;
  get(binding: string): unknown; // reads action-local binding by name
}

interface PublishHookContext {
  readonly actionId: string;
  readonly hookName: string;
  state(): Record<string, unknown>; // reads complete final state
}

type PrepareHookImpl = (ctx: PrepareHookContext) => Record<string, unknown> | Promise<...>;
type PublishHookImpl = (ctx: PublishHookContext) => void | Promise<void>;
```

**What the code had** (`packages/ts/scene-runner/src/types/harness-types.ts`):
```typescript
type HookContext = {
  readState: (path: string) => AnyValue | undefined;
};
type HookHandler = (ctx: HookContext) => Record<string, AnyValue>;
```

**Specific mismatches**:
- `actionId` and `hookName` were absent from the context object
- `readState(path)` read STATE dotted-paths; spec's `get(binding)` reads action-local binding values by name (not STATE paths)
- Single `HookHandler` type covered both prepare and publish; spec requires distinct `PrepareHookImpl` (returns object) and `PublishHookImpl` (returns void)

**Fix**:
Replaced `HookContext`/`HookHandler` in `harness-types.ts` with the spec-compliant `PrepareHookContext`, `PublishHookContext`, `PrepareHookImpl`, `PublishHookImpl`, and `HookImpl` union. Updated `prepare-resolver.ts` to pass `actionId` and build a correct `PrepareHookContext` where `get(binding)` reads from the bindings already resolved earlier in the same prepare pass. Updated `runner.ts` `useHook` signature and `index.ts` public exports accordingly.

---

## GAP 3 — TransformFn DSL method-call syntax not in Go converter (Medium)

**Spec reference**: `transform-fn-dsl-spec.md`

**What the spec requires**:
Turn DSL authors should write transform operations as chained method calls on receiver values:
```
income.toStr()
name.trim().toUpperCase()
score.abs().toStr()
```
The Go converter must parse this syntax and lower it to `{ transform = { ref = "...", fn = "transformFn..." } }` in canonical HCL.

**What the code has**:
- All runtime `transformFn` implementations exist in `packages/ts/runtime/src/state-control/preset-funcs/` (number: `toStr`, `abs`, `floor`, `ceil`, `round`, `negate`; string: `toNumber`, `trim`, `toLowerCase`, `toUpperCase`, `length`; boolean: `not`, `toStr`; array: `length`, `isEmpty`).
- `packages/ts/scene-runner/src/executor/hcl-context-builder.ts` handles the `{ transform = { ref, fn } }` HCL block form at runtime.
- The Go converter lexer/parser/lowerer has **no support** for dot-method-call syntax. There is no tokenisation of `.methodName()` chains and no lowering rule for them.

**Impact**: Authors cannot use the method-call DSL syntax. They must write raw `{ transform = { ref = "v" fn = "transformFnNumber::toStr" } }` block forms directly, which the spec explicitly says is the internal representation, not the authoring syntax.

---

## GAP 4 — `string.toNumber()` uses `parseInt` instead of `parseFloat` (Low)

**Spec reference**: `transform-fn-dsl-spec.md §CAN'T`

> `.toNumber()` on `string` does not guarantee a valid number. Non-numeric strings produce `NaN`.

The wording implies full numeric parsing (floats included). A string like `"3.14"` should parse to `3.14`, not `3`.

**What the code does** (`packages/ts/runtime/src/state-control/preset-funcs/string/transformFn.ts:20`):
```typescript
toNumber: (val) => buildNumber(parseInt(val.value), val.tags)
```

`parseInt("3.14")` returns `3` (truncates the decimal). `parseFloat("3.14")` returns `3.14`. The spec does not mandate integer-only results, and the STATE `number` type maps to JavaScript `number` which accepts fractions throughout the codebase.

**Required change**: Replace `parseInt` with `parseFloat` in `string/transformFn.ts`.

---

## Well-Implemented Areas (No Gaps)

| Spec | Status |
|------|--------|
| `scene-graph.md` — scene model, action compute/prepare/merge, next rules, first-match/all-match, docstring sugar | ✅ Implemented |
| `hcl-context-spec.md` — all binary/operator functions, #pipe, cond, #if, single-reference form, identity-combine | ✅ Implemented |
| `effect-dsl-spec.md` — `~>`, `<~`, `<~>` sigils, prepare/merge sections, bidirectional lowering, transition prepare | ✅ Implemented |
| `state-shape-spec.md` — STATE block, namespaces/fields, `state_file` directive, type constraints, S₀ initialization | ✅ Implemented |
| `scene-to-scene.md` — route blocks, match arms, wildcard patterns, OR expressions, priority rules, contiguous-block matching, history reset | ✅ Implemented |
| `convert-runtime-spec.md` — two-phase pipeline (Go CLI → HCL → TypeScript runtime), atomic merge, sequential all-match | ✅ Implemented |
| `hook-spec.md §1–2` — `from_hook` parsing/lowering/emission, hook deduplication for multiple bindings on same name | ✅ Implemented |

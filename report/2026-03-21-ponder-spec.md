# Ponder Spec Report — 2026-03-21

> Scope: All spec files in `spec/` cross-referenced against the current codebase.

---

## Gaps (spec defines X; implementation is missing it)

| # | Issue | Spec | Code location |
|---|-------|------|---------------|
| G1 | **Publish hooks never invoked** — `ActionModel.publish` field exists but `action-executor.ts` has no publish step | `hook-spec.md §1.3`, `scene-graph.md §7` | `action-executor.ts:81-95` |
| G2 | **Hook deduplication not done** — same hook name on multiple prepare bindings calls the hook once per binding instead of once | `hook-spec.md §1.2`, `§3.5` | `prepare-resolver.ts:23-38` |
| G3 | **`MissingHookField` not emitted** — when a hook result is missing a declared binding field, code silently returns `buildNull('missing')` instead of raising an error | `hook-spec.md §3.2`, `§6` | `prepare-resolver.ts:33` |
| G4 | **Async hooks not supported** — spec defines `PrepareHookImpl` as `(...) => Record \| Promise<Record>` but `HookHandler` is synchronous-only | `hook-spec.md §3.1` | `harness-types.ts:12` |
| G5 | **`action.text` absent from `ActionModel`** — spec allows optional narrative text on actions | `scene-graph.md §5.1` | `scene-model.ts:65-72` |
| G6 | **Per-action `nextPolicy` override absent** — spec says each action can override the scene-level next policy | `scene-graph.md §4`, `§8` | `scene-model.ts:65-72` |
| G7 | **Unregistered hook overwrites binding with null** — spec says "binding value remains unchanged (STATE or default)"; code writes `buildNull('missing')` | `hook-spec.md §3.4` | `prepare-resolver.ts:29-31` |
| G8 | **Route-driven entry launches all `entry_actions`** — spec says route-driven entry launches only the first declared entry action | `scene-to-scene.md §3.2` | `route-executor.ts:52`, `runner.ts:187` |
| G9 | **`SceneDiagnostic` / `SCN_*` error codes not implemented** — runtime throws plain JS errors; no structured diagnostic types | `scene-graph.md §10` | (none) |
| G10 | **`from_literal` empty array type** — `inferLiteralValue([])` falls through to `buildNull('unknown')` with no type; spec does not address this case | `effect-dsl-spec.md §4.2` | `prepare-resolver.ts:78-84` |

---

## Overlaps (same content in multiple specs)

| Overlap | Specs |
|---------|-------|
| `prepare`/`merge` lowering rules | `effect-dsl-spec.md` and `convert-runtime-spec.md` |
| Hook behavior and HCL shape | `hook-spec.md` and `convert-runtime-spec.md` |
| Error code catalogue | `effect-dsl-spec.md §7` and `convert-runtime-spec.md` (identical codes listed in both) |
| Runtime data model (`Scene`, `Action`, `PrepareSpec`, etc.) | `scene-graph.md §4` and `convert-runtime-spec.md §Phase 2` |
| DSL lowering rules | `hcl-context-spec.md §2` and `convert-runtime-spec.md §Phase 1` |

---

## Inconsistencies

| # | Issue | Location |
|---|-------|----------|
| I1 | **State path depth contradiction** — §9 CAN'T says "cannot declare a path with more than two segments", but §1.1 explicitly allows `session.cart.items` (3 segments) and the test plan marks it "Valid". **Resolution: allow any depth (2+); §9 CAN'T rule is wrong and should be removed.** | `state-shape-spec.md §1.1` vs `§9` |
| I2 | **`string` vs `str` type name** — `transform-fn-dsl-spec.md` uses `string` in its method table; every other spec and the codebase uses `str` | `transform-fn-dsl-spec.md:26` |
| I3 | **`fromSsot` vs `from_state` naming** — `scene-graph.md §4` runtime model uses camelCase `fromSsot`; JSON wire format and `scene-model.ts` use `from_state`. Naming convention split across specs | `scene-graph.md:104` |
| I4 | **Section 2.3 heading used twice** in `scene-to-scene.md` — first for "STATE Sharing", then again for "Trigger" | `scene-to-scene.md` |

---

## Open Questions (unresolved ambiguities)

| # | Question |
|---|----------|
| Q1 | **Publish hook context type**: `hook-spec.md` defines `PublishHookContext` (returns `void`) as distinct from `PrepareHookContext` (returns `Record`). Does `useHook()` use a single unified `HookHandler` type for both, or should separate registration APIs exist? |
| Q2 | **Unregistered hook binding default**: When a prepare hook has no registered implementation, should the binding preserve the `prog` block's declared default, or remain at whatever STATE-resolved value was set? (Currently returns `buildNull('missing')`, which is wrong per spec.) |
| Q3 | **`transform-fn-dsl-spec.md` receiver type label**: Is `string` in the method table a typo for `str`, or intentional documentation-level labelling distinct from the DSL keyword? |
| Q4 | **`PrepareHookContext.get(binding)` semantics**: The spec says it returns "the current value of a state binding". Does it accept a binding **name** (e.g. `user_id`) and return the already-resolved prepare value, or a dotted STATE **path** (e.g. `session.user_id`)? The current implementation uses a STATE-path reader. |
| Q5 | **`from_literal` with empty `[]`**: No first element exists to infer array element type. Should empty array literals require the declared binding type for coercion, or adopt a convention (e.g. always `arr<str>`)? |
| Q6 | **`all-match` re-visiting an already-executed action**: If `all-match` selects an action already in `visited`, the scene executor silently skips it. Should this be an error, a silent skip, or a re-run? Spec is silent. |

---

## Summary

- **9 confirmed implementation gaps** — most significant are G1 (publish hooks), G4 (async hooks), G7 (unregistered hook behavior), and G8 (route entry action count).
- **1 spec contradiction resolved** — state path depth: allow 2+ segments (I1).
- **5 spec overlaps** — consider consolidating error code catalogues and lowering rules into a single authoritative location.
- **6 open questions** remain for author clarification before implementation.

# Open Issues Inventory

- Date: 2026-04-27
- Scope: Current open issues gathered from the previous reports in `report/`
- Note: Older reports contained several stale findings. This file separates likely-current items from stale or already-resolved ones.

## Likely Current Issues

### ~~Missing prepare-source semantics~~ — Resolved 2026-05-06

`resolveActionPrepare` and `resolveNextPrepare` in `packages/ts/scene-runner/src/executor/prepare-resolver.ts` now throw on all four previously-silent cases:

- `from_state` path absent from STATE → `Error: [action: <id>] from_state path "<path>" is not present in state`
- `from_hook` name not in registry → `Error: [action: <id>] prepare hook "<name>" is not registered`
- Hook result missing a declared field → `Error: … (MissingHookField)`
- `from_action` binding absent from previous action result → `Error: from_action binding "<name>" was not produced by action "<id>"`

Tests updated accordingly; all 208 pass.

### ~~`action.text` is not in the JSON/runtime model~~ — Resolved 2026-05-06

`action.text` and `scene.view` are now part of the proto contract and propagated end-to-end:

- `schema/turnout-model.proto` — `ActionModel` gains `optional string text = 7`; `SceneBlock` gains `optional ViewBlock view = 5`; new `ViewBlock` message added (`name`, `flow`, `optional string enforce`). Both generated files regenerated via `pnpm generate`.
- `lower.go` — `lowerAction` sets `am.Text` from `lowerActionText(a.Text)`; `lowerSceneBlock` sets `sb.View` from the AST `ViewBlock`.
- `emit.go` — `writeAction` reads `a.Text` from the proto field; `writeSceneBlock` calls `writeViewBlock(iw, s.View)` when present; `Emit` signature no longer takes a sidecar.
- `validate.go` — `validateOverview` reads from `scene.View` (proto) instead of `sc.Scenes`.
- `sidecar.go` — removed `ViewMeta`, `ActionMeta`, `SceneMeta` types and `Actions`/`Scenes` maps; sidecar now carries only `Sigils`.

All Go and TS tests pass (208 TS, full Go suite).

### ~~`scene.view` is not in the JSON/runtime model~~ — Resolved 2026-05-06

See `action.text` entry above; both were resolved together.

### ~~Runtime diagnostics are still plain JavaScript errors~~ — Resolved 2026-05-06

Introduced `packages/ts/scene-runner/src/executor/errors.ts` with three structured error classes, each carrying a typed `code` field and relevant context:

- `PrepareError` (codes: `MissingStateBinding`, `UnregisteredHook`, `MissingHookField`, `MissingActionBinding`) — thrown by `prepare-resolver.ts`
- `SceneRuntimeError` (codes: `UnknownAction`, `IncompleteScene`) — thrown by `scene-executor.ts`
- `RouteRuntimeError` (codes: `UnknownScene`, `NoEntryAction`) — thrown by `route-executor.ts`

All three extend `Error` for catch-compatibility. Tests updated to assert `instanceof` and `code`.

### ~~`string.toNumber()` truncates decimals~~ — Resolved 2026-05-06

`parseInt` replaced with `parseFloat` in `packages/ts/runtime/src/state-control/preset-funcs/string/transformFn.ts:20`. Test added to `preset-funcs.test.ts` covering decimal, integer, and negative decimal inputs.

### ~~Route entry scene is implicit~~ — Resolved 2026-05-06

Added an explicit `entry "<scene_id>"` declaration to the route DSL block. Changes span the full stack:

- `schema/turnout-model.proto` — `RouteModel` gains `optional string entry_scene_id = 3`; both generated files regenerated via `pnpm generate`
- `lexer.go` — new `TokKwEntry` / `"entry"` keyword
- `ast.go` — `RouteBlock.EntrySceneID string`
- `parser.go` — parses `entry "<scene_id>"` inside route blocks; duplicate entry emits a parser error
- `lower.go` — emits `EntrySceneId` when set
- `validate.go` — `MissingEntryScene` if absent; `UnresolvedEntryScene` if the named scene is not defined
- `runner.ts` — uses `route.entrySceneId` instead of `model.scenes[0]`; throws if absent or unknown

All Go and TS tests pass (208 TS, full Go suite).

### CLI has only one command

The Go CLI still has command scaffolding around a single `convert` command. This is only an issue if the CLI is expected to grow; otherwise it can remain as-is.

Evidence:

- Previous report: `2026-04-26-code-analyze.md` D4
- Current code: `packages/go/converter/cmd/turnout/main.go`

## Spec Cleanup

Resolved on 2026-05-06. All items below were fixed in the spec files; no runtime code changes were required.

- `state-shape-spec.md` — stale CAN'T line prohibiting paths with more than two segments removed. Three-segment paths (`session.cart.items`) are valid per §1.1 and the Go validator already enforced no upper-bound check.
- `transform-fn-dsl-spec.md` — method table receiver type labels corrected from `string`/`boolean`/`array` to `str`/`bool`/`arr`.
- `scene-to-scene.md` — duplicate `§2.3` (Trigger) renumbered to `§2.4`.
- `effect-dsl-spec.md` / `convert-runtime-spec.md` overlap — inline Rules block in `convert-runtime-spec.md` replaced with a cross-reference to `effect-dsl-spec.md §1–6` and `hook-spec.md §2`.
- `hook-spec.md` / `convert-runtime-spec.md` overlap — 7-step Execution Order in `convert-runtime-spec.md` replaced with references to `scene-graph.md §7` and `hook-spec.md §1.4`; Phase 2 Responsibilities now points to `scene-graph.md §4` for the data model.
- `scene-graph.md` / `convert-runtime-spec.md` overlap — Phase 2 Responsibilities section now explicitly defers the runtime data model and execution semantics to `scene-graph.md §4` and `§7`.
- Error catalogues — `convert-runtime-spec.md` Convert-phase Error Catalogue trimmed to its two unique codes (`UnsupportedConstruct`, `DuplicateActionLabel`); all others cross-referenced to `effect-dsl-spec.md §7` and `hook-spec.md §6`. `UnresolvedPrepareBinding` and `UnresolvedMergeBinding` added to `effect-dsl-spec.md §7` as their canonical home. `hook-spec.md §6` now only owns `MissingHookField`.

## Open Design Questions

- What is the canonical type of an empty array literal in the spec?
- Under `all-match`, if a selected next action has already executed, should that be a skip, an error, or a re-run?

## Lower-Priority Improvement Items

These items were reported as design, typing, or maintainability improvements. They may be valid, but they are not necessarily correctness bugs.

- `subSymbol` is overloaded for array element types and null reasons.
- The `UnvalidatedContext` to `ValidatedContext` brand can be bypassed with unsafe casts.
- The VS Code extension is syntax-only and has no LSP diagnostics, hover, or go-to-definition.
- The proto schema has no explicit schema versioning or migration story.
- `HarnessResult.trace` is a union without a discriminant.
- `MatchArm.patterns` is a `string[]` with implicit pattern encoding.
- `executeGraph` rebuilds deterministic execution trees on every call.
- The Go validator keeps built-in function specs in one flat registry.
- The runner has traces but no pluggable structured logging or observability interface.

## Stale Or Already Resolved

These items appeared in older reports but should not be treated as open without new evidence.

- Multi-scene converter support: older reports listed this as open, but later reports mark it fixed and the proto already has `repeated SceneBlock scenes`.
- Publish hook execution: fixed on 2026-04-22.
- Hook context API mismatch: fixed on 2026-04-22.
- TransformFn method-call syntax in the Go converter: fixed on 2026-04-22.
- Async hook awaiting and streaming execution: fixed on 2026-04-23.
- Proto as an early Go lowering contract: fixed on 2026-04-23.
- `hcl-context-builder.ts` god function: fixed on 2026-04-23.
- State manager path validation for schema-backed state: fixed on 2026-04-23.
- April 26 code-analysis findings P1-P4, P6, D1-D3, T1-T4, and I1-I5 are marked resolved in that report.


# Open Issues Inventory

- Date: 2026-04-27
- Scope: Current open issues gathered from the previous reports in `report/`
- Note: Older reports contained several stale findings. This file separates likely-current items from stale or already-resolved ones.

## Likely Current Issues

### Missing prepare-source semantics

Missing action-level `from_state` values, unregistered prepare hooks, and missing fields in prepare hook results still become `buildNull("missing")`.

This conflicts with the specs and leaves the runtime behavior undecided: abort with a diagnostic, preserve the declared/default value, preserve the already-resolved value, or explicitly inject null.

Evidence:

- Previous report: `2026-03-21-unified-report.md` G3, G4, G5
- Current code: `packages/ts/scene-runner/src/executor/prepare-resolver.ts`

### `action.text` is not in the JSON/runtime model

Action narrative text exists in the DSL parser, lowering metadata, and HCL emission path, but it is absent from `schema/turnout-model.proto` and therefore absent from the runtime JSON contract.

Decision needed: add `action.text` to the proto and propagate it end to end, or explicitly document it as parse/HCL-only metadata.

Evidence:

- Previous report: `2026-03-21-unified-report.md` G6
- Current schema: `schema/turnout-model.proto`

### `scene.view` is not in the JSON/runtime model

Scene `view` is now validated at compile time, but the view block is still absent from `schema/turnout-model.proto` and the emitted JSON. Runtime overview enforcement in the TypeScript scene runner is therefore not implemented.

Decision needed: add `scene.view` to the proto/runtime model, or document view blocks as compile-time/HCL-only metadata.

Evidence:

- Previous reports: `2026-03-21-unified-report.md` G8, `2026-03-22-code-analysis.md`
- Current schema: `schema/turnout-model.proto`

### Runtime diagnostics are still plain JavaScript errors

Scene and route runtime failures still appear to surface as plain JS errors rather than structured `SceneDiagnostic` or `RouteDiagnostic` payloads.

Evidence:

- Previous report: `2026-03-21-unified-report.md` G9
- Runtime area: `packages/ts/scene-runner/src/executor/`

### `string.toNumber()` truncates decimals

`string.toNumber()` still uses `parseInt`, so values like `"3.14"` become `3`. The spec implies full JavaScript number parsing, so this should likely use `parseFloat`.

Evidence:

- Previous report: `2026-04-21-spec-gap-analysis.md` Gap 4
- Current code: `packages/ts/runtime/src/state-control/preset-funcs/string/transformFn.ts`

### Route entry scene is implicit

When running a route, the runner still picks `model.scenes[0]` as the entry scene. This makes route start behavior dependent on scene order rather than explicit route metadata.

Evidence:

- Previous report: `2026-03-22-code-analysis.md`
- Current code: `packages/ts/scene-runner/src/runner.ts`

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

- What should happen when a prepare source is missing: abort, preserve a declared/default value, preserve an already-resolved value, or inject a typed null?
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


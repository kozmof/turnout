# Unified Turnout Report

- Date: 2026-03-21
- Scope: Consolidates and updates the five historical reports previously stored in `report/`
- Source reports:
  - `2026-02-23-balance-spec-validateContext.md`
  - `2026-03-14-spec-overview.md`
  - `2026-03-20-code-analyze.md`
  - `2026-03-21-code-analyze.md`
  - `2026-03-21-ponder-spec.md`

## Validation Snapshot

- `go test ./...` in `packages/go/converter`: passed
- `pnpm --dir packages/ts/runtime test`: passed
  - 13 test files
  - 178 tests
- `pnpm --dir packages/ts/scene-runner test`: passed
  - 13 test files
  - 179 tests

Repository size at verification time:

- Go converter: 24 `.go` files
- TS runtime: 65 `.ts` files in `packages/ts/runtime/src`
- TS scene-runner: 16 `.ts` files in `packages/ts/scene-runner/src`
- Specs: 8 markdown specs in `spec/`

## Architecture Snapshot

Turnout is still best understood as a layered monorepo:

1. Go converter
   - lex -> parse -> resolve state -> lower -> validate -> emit
   - owns DSL parsing and canonical HCL / JSON emission
2. TS runtime
   - owns typed values, compute-graph validation, and graph execution
3. TS scene-runner
   - owns action, scene, and route orchestration on top of the runtime
4. VS Code extension
   - syntax highlighting only

The strongest design choice remains the separation between source-language concerns in Go and execution-model concerns in TypeScript. The weakest boundary is still the JSON contract between them: it is hand-maintained on both sides rather than generated from one shared schema.

## `validateContext.ts` Status

The focused `validateContext.ts` review from 2026-02-23 is still directionally correct. This module remains one of the strongest parts of the repo.

What it can do well:

- Accept unvalidated input, perform structural checks first, then semantic checks
- Return a discriminated validation result or throw via `assertValidContext(...)`
- Validate function-table linkage, forward references via collected return IDs, combine/pipe/cond shapes, type compatibility, and cycle safety
- Emit warnings without blocking execution

What it still rejects correctly:

- Missing or malformed required tables
- Malformed function entries or wrong definition-table linkage
- Invalid argument references or malformed pipe bindings
- Non-boolean cond conditions when the type is inferable
- Function-graph or pipe-definition cycles

## Current Verified Gaps

These are the gaps that still reproduce against the current codebase.

| ID | Finding | Current evidence |
|---|---|---|
| G1 | Publish hooks are lowered and emitted into JSON, but the TS scene-runner never executes a publish phase. | `packages/go/converter/internal/lower/lower.go`, `packages/go/converter/internal/emit/json.go`, `packages/ts/scene-runner/src/executor/action-executor.ts` |
| G2 | Hook typing still models only synchronous prepare-hook behavior. There is no publish-hook context and no async hook support in the runtime API. | `packages/ts/scene-runner/src/types/harness-types.ts` |
| G3 | Missing `from_state` values still become `buildNull("missing")` instead of producing the spec-described missing-path failure. | `packages/ts/scene-runner/src/executor/prepare-resolver.ts` |
| G4 | An unregistered prepare hook still overwrites the binding with `buildNull("missing")` instead of silently skipping while preserving the prior/default value. | `packages/ts/scene-runner/src/executor/prepare-resolver.ts`, `spec/hook-spec.md` |
| G5 | Missing fields in a prepare hook result still become `buildNull("missing")`; `MissingHookField` is not emitted. | `packages/ts/scene-runner/src/executor/prepare-resolver.ts`, `spec/hook-spec.md` |
| G6 | Action narrative text exists in AST, lowering, and HCL emission, but the JSON boundary and runtime model drop it. | `packages/go/converter/internal/ast/ast.go`, `packages/go/converter/internal/lower/lower.go`, `packages/go/converter/internal/emit/emit.go`, `packages/go/converter/internal/emit/json.go`, `packages/ts/scene-runner/src/types/scene-model.ts` |
| G7 | Per-action `nextPolicy` override from the scene spec is still not represented in the converter JSON or runtime model. | `spec/scene-graph.md`, `packages/ts/scene-runner/src/types/scene-model.ts` |
| G8 | Scene `view` metadata is parsed, but dropped before JSON/runtime, so overview enforcement is still not implemented end to end. | `packages/go/converter/internal/ast/ast.go`, `packages/go/converter/internal/lower/lower.go`, `packages/go/converter/internal/emit/json.go`, `packages/ts/scene-runner/src/types/scene-model.ts` |
| G9 | Scene/route runtime failures still surface as plain JS errors; `SceneDiagnostic` and `RouteDiagnostic` payloads are not implemented on the TS side. | `spec/scene-graph.md`, `spec/scene-to-scene.md`, no matching runtime types in `packages/ts/scene-runner` |
| G10 | The compiler still lowers and emits a single scene (`lower.Model.Scene`), while the runtime contract and route executor already assume `TurnModel.scenes[]`. | `packages/go/converter/internal/lower/lower.go`, `packages/go/converter/internal/emit/json.go`, `packages/ts/scene-runner/src/types/scene-model.ts`, `packages/ts/scene-runner/src/executor/route-executor.ts` |

## Historical Findings Now Resolved

These items appeared in older reports but are no longer current.

| Historical finding | Current status |
|---|---|
| `resolveTurnoutBin()` returned the wrong binary name when `turnout` existed on PATH. | Fixed. `packages/ts/scene-runner/src/server/bridge.ts` now returns `"turnout"` in the PATH success case. |
| Route-driven scene entry launched all `entry_actions`. | Fixed. Route execution now starts only the first declared entry action. |
| Prepare hooks were invoked once per binding instead of once per hook name. | Fixed. `resolveActionPrepare(...)` now caches hook results per action invocation. |
| Empty-array literal inference fell through to a null-ish fallback. | Fixed in `prepare-resolver.ts` and `hcl-context-builder.ts`; empty arrays now stay arrays. |
| `StateManager.from(...)` and `StateManager.fromSchema(...)` compatibility gaps were breaking scene-runner tests. | Fixed. Namespace aliases are present and the scene-runner suite is green. |
| The 2026-03-20 cycle-guard note said the executor used a count-based guard. | No longer current. `scene-executor.ts` now uses a `visited` set and skips already-executed actions. |

## Spec Document Issues Still Worth Cleaning Up

### Inconsistencies

- `state-shape-spec.md` both allows deeper paths like `session.cart.items` and later says paths with more than two segments are invalid. The current validator allows 2+ segments, so the "more than two segments" prohibition is the stale line.
- `transform-fn-dsl-spec.md` uses `string` in its method table, while the rest of the specs and the codebase use `str`.
- `scene-graph.md` and `convert-runtime-spec.md` use camelCase / SSOT naming such as `nextPolicy`, `fromSsot`, and `toSsot`, while the JSON model and runtime use `next_policy`, `from_state`, and `to_state`.
- `scene-to-scene.md` still has two different sections both labeled `2.3`.

### Overlaps

- `effect-dsl-spec.md` and `convert-runtime-spec.md` both describe prepare/merge lowering rules
- `hook-spec.md` and `convert-runtime-spec.md` both describe hook lifecycle and emitted shape
- `scene-graph.md` and `convert-runtime-spec.md` both describe the runtime data model
- Error catalogues are repeated across multiple specs without one clear source of truth

### Open Questions

- Should prepare hooks and publish hooks share one `runtime.hook(...)` API, or should they be separate registration surfaces with distinct types?
- When a prepare source is missing, should the runtime abort, preserve the declared default, or preserve the already-resolved value? Current behavior is null injection, which conflicts with the specs.
- Should `PrepareHookContext.get(...)` accept binding names or dotted state paths?
- What is the canonical type of an empty array literal in the spec? The code now preserves `[]` as an array value, but the docs still do not define its element typing clearly.
- Under `all-match`, if a selected next action has already executed, should that be a skip, an error, or a re-run? The current executor skips it through the `visited` guard.

## Highest-Leverage Next Steps

1. Establish one shared schema for the Go-to-TS JSON boundary.
2. Implement a real publish phase and split prepare/publish hook types at the API level.
3. Decide and codify missing-source semantics, then align runtime behavior and diagnostics with that decision.
4. Preserve `action.text` and `scene.view` end to end, or explicitly downgrade them to parse-only metadata.
5. Extend the compiler model from singular-scene lowering to first-class multi-scene authoring.

## Learning Paths

### Path A: Compiler

Start with:

- `packages/go/converter/cmd/turnout/main.go`
- `packages/go/converter/internal/parser/parser.go`
- `packages/go/converter/internal/lower/lower.go`
- `packages/go/converter/internal/validate/validate.go`

Goal:

- Understand how Turn DSL syntax becomes canonical HCL and JSON.

### Path B: Runtime Engine

Start with:

- `packages/ts/runtime/src/state-control/value.ts`
- `packages/ts/runtime/src/compute-graph/types.ts`
- `packages/ts/runtime/src/compute-graph/runtime/validateContext.ts`
- `packages/ts/runtime/src/compute-graph/runtime/exec/executeGraph.ts`

Goal:

- Understand how validated typed values flow through combine, pipe, and cond execution.

### Path C: Product Behavior

Start with:

- `packages/ts/scene-runner/src/types/scene-model.ts`
- `packages/ts/scene-runner/src/executor/action-executor.ts`
- `packages/ts/scene-runner/src/executor/scene-executor.ts`
- `packages/ts/scene-runner/src/executor/route-executor.ts`

Goal:

- Understand how state, hooks, actions, scenes, and routes compose into workflow behavior.

## Bottom Line

Turnout still has a solid layered architecture and a strong compute-graph validation core. The main risk today is no longer basic correctness inside the runtime engine; it is contract drift at the product boundary: hooks, action metadata, overview metadata, diagnostics, and multi-scene authoring are still only partially aligned across spec, converter, and runtime.

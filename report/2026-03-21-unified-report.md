# Unified Turnout Report

- Date: 2026-03-21 (last updated: 2026-03-22)
- Scope: Consolidates and updates the five historical reports previously stored in `report/`
- Source reports:
  - `2026-02-23-balance-spec-validateContext.md`
  - `2026-03-14-spec-overview.md`
  - `2026-03-20-code-analyze.md`
  - `2026-03-21-code-analyze.md`
  - `2026-03-21-ponder-spec.md`

## Implementation Log

### 2026-03-22 — Step 2: Protobuf schema as single source of truth

Replaced the hand-written JSON Schema and all hand-maintained Go/TS type definitions with generated code from a single `.proto` file.

**Motivation:**
The previous approach (Step 1) introduced `schema/turnout-model.json` as a canonical JSON Schema and required both Go (`emit/json.go`, 25 hand-written structs) and TypeScript (`src/types/scene-model.ts`, 193 lines) to stay in sync with it manually. This still left two independent type surfaces that could drift.

**Deliverables:**

- `schema/turnout-model.proto` — single source of truth defining all 18+ message types (`TurnModel`, `SceneBlock`, `ActionModel`, `ComputeModel`, `ProgModel`, `BindingModel`, `ExprModel`, `ArgModel`, `CondExpr`, `CombineExpr`, `PipeExpr`, `PipeParam`, `PipeStep`, `PrepareEntry`, `MergeEntry`, `NextRuleModel`, `NextPrepareEntry`, `RouteModel`, `MatchArm`, `FieldModel`, `NamespaceModel`, `StateModel`, `TransformArg`). Uses `google.protobuf.Value` for `Literal`, `optional` scalars for presence-tracked fields, `else_branch` to avoid keyword conflict in generated Go.
- `schema/buf.yaml` — buf v2 module descriptor.
- `buf.gen.yaml` — code generation config: `protoc-gen-go` → `packages/go/converter/internal/emit/turnoutpb/`, `protoc-gen-es` → `packages/ts/scene-runner/src/types/`.
- `packages/go/converter/internal/emit/turnoutpb/turnout-model.pb.go` — generated Go structs (replaces 25 hand-written structs in `json.go`).
- `packages/ts/scene-runner/src/types/turnout-model_pb.ts` — generated TypeScript types (replaces `scene-model.ts`).
- `packages/go/converter/internal/emit/json.go` — rewrote to use `turnoutpb.*` types and `protojson.Marshal` for output. All 25 hand-written `json*` structs removed.
- `packages/go/converter/internal/emit/json_schema_test.go` — rewrote to use `protojson.Unmarshal` for round-trip validation instead of JSON Schema validation.
- `packages/ts/scene-runner/src/state/state-manager.ts` — added `protoValueToJs()` helper (uses `toJson(ValueSchema, v)` from `@bufbuild/protobuf`) to unwrap `google.protobuf.Value` proto messages into plain JS primitives. Required because `field.value` and `binding.value` in the generated types are `Value` messages, not native JS values.
- `packages/ts/scene-runner/src/executor/hcl-context-builder.ts` and `prepare-resolver.ts` — updated `inferLiteralAnyValue` / `inferLiteralValue` to call `protoValueToJs()` before type-checking.
- All TS test files and JSON fixtures updated from snake_case field names (`entry_actions`, `from_state`, `to_state`, etc.) to camelCase (`entryActions`, `fromState`, `toState`, etc.) — the protobuf JSON encoding convention.

**Removed:**

- `schema/turnout-model.json` — superseded by `schema/turnout-model.proto`.
- `packages/ts/scene-runner/src/types/scene-model.ts` — superseded by `turnout-model_pb.ts`.
- `ajv` devDependency — JSON Schema validation library no longer needed.
- `github.com/google/jsonschema-go` Go dependency — removed via `go mod tidy`.

**Post-implementation test counts:**

- `go test ./...` in `packages/go/converter`: passed (all 9 packages)
- `pnpm --dir packages/ts/scene-runner test`: passed (14 test files, 184 tests)

---

### 2026-03-21 — Step 1: Shared JSON boundary schema

Completed "Highest-Leverage Next Step 1: Establish one shared schema for the Go-to-TS JSON boundary."

**Deliverables:**

- `schema/turnout-model.json` — canonical JSON Schema (draft-07) covering every type in the Go→TS boundary. *(Superseded by Step 2 — file removed.)*
- `packages/go/converter/internal/emit/json_schema_test.go` — Go conformance tests. *(Superseded by Step 2 — now uses protojson round-trip.)*
- `packages/ts/scene-runner/tests/schema-conformance.test.ts` — TS conformance tests. *(Updated in Step 2 to use `fromJson(TurnModelSchema, ...)`  instead of AJV.)*

**Post-implementation test counts:**

- `go test ./...` in `packages/go/converter`: passed (all 8 packages, +3 new tests)
- `pnpm --dir packages/ts/scene-runner test`: passed (14 test files, 188 tests, +10 new tests)

---

## Validation Snapshot

- `go test ./...` in `packages/go/converter`: passed
- `pnpm --dir packages/ts/runtime test`: passed
  - 13 test files
  - 178 tests
- `pnpm --dir packages/ts/scene-runner test`: passed
  - 14 test files
  - 184 tests

Repository size at verification time:

- Go converter: 24 `.go` files
- TS runtime: 65 `.ts` files in `packages/ts/runtime/src`
- TS scene-runner: 15 `.ts` files in `packages/ts/scene-runner/src`
- Specs: 8 markdown specs in `spec/`

## Architecture Snapshot

Turnout is still best understood as a layered monorepo:

1. Go converter
   - lex -> parse -> resolve state -> lower -> validate -> emit
   - owns DSL parsing and canonical HCL / JSON emission
   - JSON output now uses `protojson.Marshal` against `turnoutpb.*` generated types
2. TS runtime
   - owns typed values, compute-graph validation, and graph execution
3. TS scene-runner
   - owns action, scene, and route orchestration on top of the runtime
   - types now generated from `schema/turnout-model.proto` via `buf generate`
4. VS Code extension
   - syntax highlighting only

**Contract boundary:**
The Go→TS JSON contract is now defined entirely in `schema/turnout-model.proto`. Running `buf generate` from the repo root regenerates both `turnoutpb/turnout-model.pb.go` (Go) and `src/types/turnout-model_pb.ts` (TypeScript). Structural drift between the two sides is caught at compile time.

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
| G3 | Missing `fromState` values still become `buildNull("missing")` instead of producing the spec-described missing-path failure. | `packages/ts/scene-runner/src/executor/prepare-resolver.ts` |
| G4 | An unregistered prepare hook still overwrites the binding with `buildNull("missing")` instead of silently skipping while preserving the prior/default value. | `packages/ts/scene-runner/src/executor/prepare-resolver.ts`, `spec/hook-spec.md` |
| G5 | Missing fields in a prepare hook result still become `buildNull("missing")`; `MissingHookField` is not emitted. | `packages/ts/scene-runner/src/executor/prepare-resolver.ts`, `spec/hook-spec.md` |
| G6 | Action narrative text exists in AST, lowering, and HCL emission, but is not present in the proto schema or runtime model. | `packages/go/converter/internal/ast/ast.go`, `packages/go/converter/internal/lower/lower.go`, `packages/go/converter/internal/emit/emit.go`, `schema/turnout-model.proto` |
| G7 | Per-action `nextPolicy` override from the scene spec is still not represented in the converter JSON or runtime model. | `spec/scene-graph.md`, `schema/turnout-model.proto` |
| G8 | Scene `view` metadata is parsed, but dropped before JSON/runtime, so overview enforcement is still not implemented end to end. | `packages/go/converter/internal/ast/ast.go`, `packages/go/converter/internal/lower/lower.go`, `schema/turnout-model.proto` |
| G9 | Scene/route runtime failures still surface as plain JS errors; `SceneDiagnostic` and `RouteDiagnostic` payloads are not implemented on the TS side. | `spec/scene-graph.md`, `spec/scene-to-scene.md`, no matching runtime types in `packages/ts/scene-runner` |
| G10 | The compiler still lowers and emits a single scene (`lower.Model.Scene`), while the runtime contract and route executor already assume `TurnModel.scenes[]`. | `packages/go/converter/internal/lower/lower.go`, `packages/go/converter/internal/emit/json.go`, `packages/ts/scene-runner/src/executor/route-executor.ts` |

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
| Go and TS type definitions for the JSON boundary were hand-maintained independently, creating a drift risk. | Fixed (2026-03-22). `schema/turnout-model.proto` is the single source of truth; both Go (`turnoutpb/`) and TS (`turnout-model_pb.ts`) types are generated by `buf generate`. |

## Spec Document Issues Still Worth Cleaning Up

### Inconsistencies

- `state-shape-spec.md` both allows deeper paths like `session.cart.items` and later says paths with more than two segments are invalid. The current validator allows 2+ segments, so the "more than two segments" prohibition is the stale line.
- `transform-fn-dsl-spec.md` uses `string` in its method table, while the rest of the specs and the codebase use `str`.
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

1. ~~Establish one shared schema for the Go-to-TS JSON boundary.~~ **Done 2026-03-22** — `schema/turnout-model.proto` is the canonical source of truth; both Go and TypeScript types are generated by `buf generate`. Conformance verified by `protojson` round-trip tests (Go) and `fromJson(TurnModelSchema, ...)` fixture tests (TS).
2. Implement a real publish phase and split prepare/publish hook types at the API level.
3. Decide and codify missing-source semantics, then align runtime behavior and diagnostics with that decision.
4. Add `action.text` and `scene.view` to `turnout-model.proto` and propagate them end to end, or explicitly downgrade them to parse-only metadata in the spec.
5. Extend the compiler model from singular-scene lowering (`lower.Model.Scene`) to first-class multi-scene authoring (`lower.Model.Scenes`).

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

- `schema/turnout-model.proto`
- `packages/ts/scene-runner/src/types/turnout-model_pb.ts`
- `packages/ts/scene-runner/src/executor/action-executor.ts`
- `packages/ts/scene-runner/src/executor/scene-executor.ts`
- `packages/ts/scene-runner/src/executor/route-executor.ts`

Goal:

- Understand how state, hooks, actions, scenes, and routes compose into workflow behavior.

## Bottom Line

Turnout has a solid layered architecture and a strong compute-graph validation core. The Go→TS JSON contract is now generated from a single proto schema (`schema/turnout-model.proto`), eliminating the main drift risk identified in the previous report.

The remaining risks are at the product boundary: publish hooks are still unimplemented in the runtime, missing-source semantics conflict with the specs, and the compiler still emits a single-scene model while the runtime already assumes multi-scene. Those are the next meaningful targets.

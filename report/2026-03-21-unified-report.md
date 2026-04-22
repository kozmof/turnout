# Unified Turnout Report

- Date: 2026-03-21 (last updated: 2026-03-24)
- Scope: Consolidates and updates the five historical reports previously stored in `report/`
- Source reports:
  - `2026-02-23-balance-spec-validateContext.md`
  - `2026-03-14-spec-overview.md`
  - `2026-03-20-code-analyze.md`
  - `2026-03-21-code-analyze.md`
  - `2026-03-21-ponder-spec.md`

## Implementation Log

### 2026-03-24 — Flow overview validation in the compiler

Added compile-time enforcement of the `view { flow = ... enforce = "..." }` block against the actual action graph (scene-graph.md §9).

**Motivation:**
`view` blocks were parsed into the AST and carried through lowering but were silently dropped — no checks were performed. The `flow` text existed purely as documentation. This change makes the three enforcement modes mechanically verified during the DSL → HCL conversion phase.

**Deliverables:**

- `packages/go/converter/internal/lower/lower.go` — added `HCLView` struct (`Name`, `Flow`, `Enforce`) and `View *HCLView` field to `HCLSceneBlock`; `lowerSceneBlock` now populates it from the AST `ViewBlock`.
- `packages/go/converter/internal/diag/diag.go` — added six new error codes: `SCN_OVERVIEW_PARSE_ERROR`, `SCN_OVERVIEW_INVALID_MODE`, `SCN_OVERVIEW_UNKNOWN_NODE`, `SCN_OVERVIEW_MISSING_EDGE`, `SCN_OVERVIEW_EXTRA_NODE`, `SCN_OVERVIEW_EXTRA_EDGE`.
- `packages/go/converter/internal/validate/validate.go` — added `validateOverview` (called from `validateScene` after the action index is built). Parses the flow text into nodes and directed edges; both source nodes and edge targets count as overview nodes. Enforces the selected mode:
  - `nodes_only` — every flow node must resolve to a known action (`SCN_OVERVIEW_UNKNOWN_NODE` on violation).
  - `at_least` — same, plus every flow edge must have a matching `next` rule (`SCN_OVERVIEW_MISSING_EDGE` on violation).
  - `strict` — exact equality: no extra actions (`SCN_OVERVIEW_EXTRA_NODE`) and no extra next rules (`SCN_OVERVIEW_EXTRA_EDGE`).
- `packages/go/converter/internal/validate/validate_overview_test.go` — 13 new tests covering all three modes, parse errors, and the invalid-mode guard.

**Scope note:**
This resolves the compile-time half of G8. The `view` block is still not part of `turnout-model.proto` or the JSON output, so runtime enforcement (passing the view to the TS scene-runner) remains open.

**Post-implementation test counts:**

- `go test ./...` in `packages/go/converter`: all 9 packages pass

---

### 2026-03-22 — Step 3: HCL as the validated intermediate for JSON output

Changed the JSON emission path from `DSL → lower.Model → protobuf → JSON` to `DSL → lower.Model → HCL text → hcl-lang validate → decode → JSON`. HCL is now both the canonical output format and the mandatory validation gate: JSON can only be produced if the emitted HCL passes schema validation.

**Motivation:**
The previous Step 2 path emitted JSON directly from `lower.Model` via `modelToProto()`. This meant the HCL and JSON paths diverged after the `lower.Model` stage — a bug in the HCL emitter would not be caught on the JSON path, and conversely. Making HCL the single source for JSON ensures both outputs are always coherent and that the emitter's HCL is mechanically verified on every JSON conversion.

**Deliverables:**

- `packages/go/converter/internal/emit/hcl_schema.go` — `turnoutBodySchema()` returning a `schema.BodySchema` for the full canonical HCL format: `state/namespace/field`, `scene/action/compute/prog/binding/expr`, `prepare/merge/publish/next`, `route/match/arm`. Uses hcl-lang constraint types (`LiteralType`, `AnyExpression`) for attribute value constraints.
- `packages/go/converter/internal/emit/hcl_decode.go` — two responsibilities:
  - `validateHCL(src)`: parses the HCL buffer with `hclsyntax.ParseConfig`, then runs hcl-lang validators (`UnexpectedAttribute`, `UnexpectedBlock`, `MissingRequiredAttribute`, `BlockLabelsLength`, `MaxBlocks`) via `PathDecoder.ValidateFile`.
  - `decodeHCLBody(body)` + ~20 supporting functions: walks the validated `hcl.Body` → `*turnoutpb.TurnModel` using `hcl.Body.Content(*hcl.BodySchema)` for structural access and `expr.Value(nil)` → `cty.Value` for attribute evaluation. Handles all expr types (combine/pipe/cond), all arg variants (ref/lit/func_ref/step_ref/transform), and all source variants (from_state/from_hook/from_action/from_literal).
- `packages/go/converter/internal/emit/json.go` — `EmitJSON` rewritten as the 4-step chain: `Emit()` (HCL buffer) → `validateHCL()` → `decodeHCLBody()` → `protojson.Marshal()`. All old `modelToProto*` conversion functions removed (~130 lines).
- `packages/go/converter/internal/emit/emit.go` — three fixes exposed by the new round-trip parse:
  - `writePublish`: changed from `publish { hook = "name" \n hook = "name" }` (repeated attributes = invalid HCL duplicate-key error) to `publish = ["name", "name"]`.
  - Pipe step format: `{ fn = %q  args = %s }` → `{ fn = %q, args = %s }` (comma required as separator in inline HCL object literals).
  - Transform arg format: `{ transform = { ref = %q  fn = %q } }` → `{ transform = { ref = %q, fn = %q } }` (same issue).
- `go.mod` / `go.sum` — added `github.com/hashicorp/hcl/v2 v2.24.0`, `github.com/hashicorp/hcl-lang v0.0.0-20260227034452-913389926489`, `github.com/zclconf/go-cty v1.16.3`, and transitive dependencies.

**Test fixes:**

- `emit_test.go` `TestEmitPublishBlock`: updated expected string from `publish { hook = "..." }` block format to `publish = ["audit", "notify"]` attribute format.

**Post-implementation test counts:**

- `go test ./...` in `packages/go/converter`: all 9 packages pass

---

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

- Go converter: 35 `.go` files (12 non-test, non-generated source files; +2 new: `hcl_schema.go`, `hcl_decode.go`)
- TS runtime: 65 `.ts` files in `packages/ts/runtime/src`
- TS scene-runner: 15 `.ts` files in `packages/ts/scene-runner/src`
- Specs: 8 markdown specs in `spec/`

## Architecture Snapshot

Turnout is still best understood as a layered monorepo:

1. Go converter
   - lex → parse → resolve state → lower → validate → emit
   - owns DSL parsing and canonical HCL / JSON emission
   - JSON path (Step 3): `lower.Model → HCL text (Emit) → hcl-lang validate → decode → protojson.Marshal`
   - HCL is both the canonical human output and the required gate for JSON; structural drift between the two is now mechanically impossible
2. TS runtime
   - owns typed values, compute-graph validation, and graph execution
3. TS scene-runner
   - owns action, scene, and route orchestration on top of the runtime
   - types now generated from `schema/turnout-model.proto` via `buf generate`
4. VS Code extension
   - syntax highlighting only

**Contract boundary:**
The Go→TS JSON contract is defined entirely in `schema/turnout-model.proto`. Running `buf generate` from the repo root regenerates both `turnoutpb/turnout-model.pb.go` (Go) and `src/types/turnout-model_pb.ts` (TypeScript). Structural drift between the two sides is caught at compile time.

**HCL validation gate:**
JSON can only be produced if the emitted HCL parses successfully and passes schema validation (`hcl-lang` structural validators). Any regression in the HCL emitter that produces malformed or structurally incorrect HCL is now surfaced immediately on the JSON path.

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
| ~~G1~~ | ~~Publish hooks are lowered and emitted into JSON, but the TS scene-runner never executes a publish phase.~~ | ✅ Fixed 2026-04-22 |
| ~~G2~~ | ~~Hook typing still models only synchronous prepare-hook behavior. There is no publish-hook context and no async hook support in the runtime API.~~ | ✅ Fixed 2026-04-22 |
| G3 | Missing `fromState` values still become `buildNull("missing")` instead of producing the spec-described missing-path failure. | `packages/ts/scene-runner/src/executor/prepare-resolver.ts` |
| G4 | An unregistered prepare hook still overwrites the binding with `buildNull("missing")` instead of silently skipping while preserving the prior/default value. | `packages/ts/scene-runner/src/executor/prepare-resolver.ts`, `spec/hook-spec.md` |
| G5 | Missing fields in a prepare hook result still become `buildNull("missing")`; `MissingHookField` is not emitted. | `packages/ts/scene-runner/src/executor/prepare-resolver.ts`, `spec/hook-spec.md` |
| G6 | Action narrative text exists in AST, lowering, and HCL emission, but is not present in the proto schema or runtime model. | `packages/go/converter/internal/ast/ast.go`, `packages/go/converter/internal/lower/lower.go`, `packages/go/converter/internal/emit/emit.go`, `schema/turnout-model.proto` |
| G7 | Per-action `nextPolicy` override from the scene spec is still not represented in the converter JSON or runtime model. | `spec/scene-graph.md`, `schema/turnout-model.proto` |
| G8 | Scene `view` is now lowered and overview enforcement is validated at compile time (all three modes). The `view` block is still absent from `turnout-model.proto` and the JSON output, so runtime enforcement in the TS scene-runner is still not implemented. | `schema/turnout-model.proto`, `packages/ts/scene-runner/src/executor/scene-executor.ts` |
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
| HCL and JSON emission paths diverged after `lower.Model`, meaning HCL emitter bugs were invisible on the JSON path. | Fixed (2026-03-22). JSON now goes through `Emit → validateHCL → decodeHCLBody`. Three latent emitter bugs (duplicate `publish` block attrs, two missing comma separators in inline object literals) were caught and fixed by the new round-trip. |

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

- ~~Should prepare hooks and publish hooks share one `runtime.hook(...)` API, or should they be separate registration surfaces with distinct types?~~ Resolved 2026-04-22 — single `runtime.hook()` registration surface, distinguished by `PrepareHookImpl` / `PublishHookImpl` types.
- When a prepare source is missing, should the runtime abort, preserve the declared default, or preserve the already-resolved value? Current behavior is null injection, which conflicts with the specs.
- ~~Should `PrepareHookContext.get(...)` accept binding names or dotted state paths?~~ Resolved 2026-04-22 — binding names (reads from already-resolved prepare bindings, not STATE paths).
- What is the canonical type of an empty array literal in the spec? The code now preserves `[]` as an array value, but the docs still do not define its element typing clearly.
- Under `all-match`, if a selected next action has already executed, should that be a skip, an error, or a re-run? The current executor skips it through the `visited` guard.

## Highest-Leverage Next Steps

1. ~~Establish one shared schema for the Go-to-TS JSON boundary.~~ **Done 2026-03-22** — `schema/turnout-model.proto` is the canonical source of truth; both Go and TypeScript types are generated by `buf generate`. Conformance verified by `protojson` round-trip tests (Go) and `fromJson(TurnModelSchema, ...)` fixture tests (TS).
2. ~~Tighten the DSL → JSON path through HCL validation.~~ **Done 2026-03-22** — JSON is now produced from validated HCL (`hcl-lang` schema + structural validators). The HCL emitter bugs (duplicate `publish` attrs, missing comma separators in inline objects) were caught and fixed by the new round-trip parse.
3. ~~Implement a real publish phase and split prepare/publish hook types at the API level.~~ **Done 2026-04-22** — `executeAction` now runs Step 6 (publish hook invocation); `harness-types.ts` defines `PrepareHookContext`, `PublishHookContext`, `PrepareHookImpl`, `PublishHookImpl`.
4. Decide and codify missing-source semantics, then align runtime behavior and diagnostics with that decision.
5. Add `action.text` and `scene.view` to `turnout-model.proto` and propagate them end to end, or explicitly downgrade them to parse-only metadata in the spec. (`scene.view` compile-time enforcement done 2026-03-24; JSON/runtime propagation still open.)
6. Extend the compiler model from singular-scene lowering (`lower.Model.Scene`) to first-class multi-scene authoring (`lower.Model.Scenes`).

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

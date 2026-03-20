# Turnout Codebase Analysis

**Date**: 2026-03-21

## Scope

This pass covers the current repository state across:

- `packages/go/converter`
- `packages/ts/runtime`
- `packages/ts/scene-runner`
- `apps/vscode/turn-language`
- `spec/`

## Validation Snapshot

- `go test ./...` in `packages/go/converter`: passed
- `pnpm --dir packages/ts/runtime test`: passed
  - 13 test files
  - 178 tests
- `pnpm --dir packages/ts/scene-runner test`: passed ✓ (fixed 2026-03-21)
  - 10 test files
  - 130 tests

## 1. Code Organization And Structure

The repository is a layered monorepo with a clear compiler-to-runtime split:

1. `packages/go/converter`
   - Turn DSL frontend and canonical emitter
   - Pipeline: lex -> parse -> resolve state -> lower -> validate -> emit
2. `packages/ts/runtime`
   - Typed value system and compute-graph engine
   - Owns graph validation, execution, builder APIs, and value semantics
3. `packages/ts/scene-runner`
   - Action, scene, and route orchestration on top of the runtime
   - Bridges JSON `TurnModel` into runtime `ExecutionContext`
4. `apps/vscode/turn-language`
   - Syntax highlighting only, no semantic tooling
5. `spec/`
   - The repo’s actual product contract; implementation quality depends heavily on staying aligned with these docs

Current size at a glance:

- Go converter: 24 `.go` files
- TS runtime: 65 `.ts` files in `src`
- TS scene-runner: 16 `.ts` files in `src`
- Specs: 8 markdown docs

The strongest architectural decision in the codebase is the separation between:

- source-language concerns in Go
- execution-model concerns in TypeScript

That boundary is real and mostly understandable, but it is still maintained by convention rather than a single shared schema artifact.

## 2. Relations Of Implementations (Types And Interfaces)

### Go compiler-side model

The Go side uses three progressively more concrete representations:

1. AST in `packages/go/converter/internal/ast/ast.go`
   - Source-faithful nodes with positions
   - Includes `SceneBlock`, `ActionBlock`, `PrepareEntry`, `PublishBlock`, `RouteBlock`, and `ViewBlock`
2. Lowered canonical HCL model in `packages/go/converter/internal/lower/lower.go`
   - Normalized, emission-oriented structures such as `HCLAction`, `HCLProg`, `HCLExpr`, `HCLPrepare`, `HCLNextRule`
3. JSON wire model in `packages/go/converter/internal/emit/json.go`
   - Consumed by `packages/ts/scene-runner`

The converter is disciplined about using typed nodes rather than loose maps. That makes validation easier and reduces parser ambiguity.

### Runtime-side value model

`packages/ts/runtime/src/state-control/value.ts` defines the core runtime contract:

- `Value<T, BaseType, SubType, Tags>`
- base symbols: `number | string | boolean | array | null`
- array sub-symbols encode element type
- null sub-symbols encode null reason
- tags encode provenance or effect metadata

This is a solid centerpiece for the TS side. It gives the runtime one consistent representation for values, transformation results, and state entries.

### Execution model

`packages/ts/runtime/src/compute-graph/types.ts` defines the graph contract:

- `ValueTable`
- `FuncTable`
- `CombineFuncDefTable`
- `PipeFuncDefTable`
- `CondFuncDefTable`
- `ExecutionContext`

Notable strengths:

- branded IDs reduce accidental mixing of value IDs, function IDs, and definition IDs
- `FuncTableEntry` is a discriminated union on `kind`
- `ExecutionContext` is read-only at the type level

### Scene-runner model

`packages/ts/scene-runner/src/types/scene-model.ts` mirrors the JSON schema emitted by Go:

- `TurnModel`
- `SceneBlock`
- `ActionModel`
- `ProgModel`
- `ExprModel`
- `PrepareEntry`, `NextPrepareEntry`, `RouteModel`

This mirror is easy to read, but it is hand-maintained. There is no single generated or shared schema proving Go and TS are still in sync.

## 3. Relations Of Implementations (Functions)

### Compiler flow

The Go CLI in `packages/go/converter/cmd/turnout/main.go` is straightforward:

1. Read source file
2. `parser.ParseFile(...)`
3. `state.Resolve(...)`
4. `lower.Lower(...)`
5. `validate.Validate(...)`
6. `emit.Emit(...)` or `emit.EmitJSON(...)`

This flow is easy to reason about, and each phase owns a distinct concern.

### Runtime compute flow

The TS runtime execution path is similarly clear:

1. Build or receive an `ExecutionContext`
2. `validateContext(...)` or `assertValidContext(...)`
3. `executeGraph(rootFuncId, validatedContext)`
4. Build execution tree
5. Execute combine / pipe / cond nodes
6. Return `{ value, updatedValueTable }`

`validateContext.ts` is the most reliability-critical runtime module. It does the heavy lifting needed to make `executeGraph` safe and mostly trust its input.

### Scene execution flow

The scene-runner layers on top of that:

1. `resolveActionPrepare(...)`
2. `buildContextFromProg(...)`
3. `assertValidContext(...)`
4. `executeGraph(...)` or direct root value read
5. collect binding values
6. merge state
7. evaluate `next`

Routes then add:

1. execute current scene
2. append `"scene.action"` history
3. `selectNextScene(...)`
4. continue or terminate

This makes the codebase easy to follow from top-level DSL down to low-level graph execution.

## 4. Specific Contexts And Usages

### Go converter

Best entry files:

- `packages/go/converter/cmd/turnout/main.go`
- `packages/go/converter/internal/parser/parser.go`
- `packages/go/converter/internal/lower/lower.go`
- `packages/go/converter/internal/validate/validate.go`
- `packages/go/converter/internal/emit/json.go`

The Go implementation is strongest where it uses:

- explicit AST node types
- phase separation
- broad test coverage on parser, lexer, lowering, emit, and validate

### TS runtime

Best entry files:

- `packages/ts/runtime/src/state-control/value.ts`
- `packages/ts/runtime/src/state-control/value-builders.ts`
- `packages/ts/runtime/src/compute-graph/runtime/validateContext.ts`
- `packages/ts/runtime/src/compute-graph/runtime/exec/executeGraph.ts`
- `packages/ts/runtime/src/compute-graph/builder/context.ts`

The runtime is the most mature subsystem in the repo today. It has the cleanest internal contracts and the strongest green test signal.

### TS scene-runner

Best entry files:

- `packages/ts/scene-runner/src/types/scene-model.ts`
- `packages/ts/scene-runner/src/executor/hcl-context-builder.ts`
- `packages/ts/scene-runner/src/executor/action-executor.ts`
- `packages/ts/scene-runner/src/executor/scene-executor.ts`
- `packages/ts/scene-runner/src/executor/route-executor.ts`
- `packages/ts/scene-runner/src/server/bridge.ts`

This package is where most product-level behavior lives, and it is also where most spec drift currently appears.

### VS Code extension

`apps/vscode/turn-language` currently contributes:

- language registration
- grammar
- editor configuration

It is intentionally thin. That is fine for syntax highlighting, but it does not help enforce the compiler/runtime contract.

## 5. Pitfalls

### 5.1 `runConverter` is broken when `turnout` exists on PATH — **FIXED**

`packages/ts/scene-runner/src/server/bridge.ts` checked whether `turnout --help` works but returned `'runtime'` instead of `'turnout'` from `resolveTurnoutBin()`.

Fix: changed `return 'runtime'` to `return 'turnout'`.

Impact:

- ~~`runConverter(...)` and `convertToHCL(...)` will try to execute the wrong binary in the common happy-path deployment case~~
- current JSON-based E2E tests do not catch this because they bypass converter execution

### 5.2 Publish hooks are specified but not executed

The Go converter preserves `publish` metadata and emits it into JSON, but the TS runner never invokes publish hooks during action execution.

Observed shape:

- converter supports `publish` in parser/lower/emit
- `scene-model.ts` includes `publish?: string[]`
- `action-executor.ts`, `scene-executor.ts`, and `harness.ts` do not execute any publish phase

Impact:

- runtime behavior is behind the documented `prepare -> compute -> merge -> publish` lifecycle
- hook-related features are only partially implemented

### 5.3 Route transitions launch all target entry actions, not only the first — FIXED

The route spec says route-driven entry should start from the first declared `entry_actions` element of the target scene. `createSceneExecutor` now accepts an optional `entryActions` override. Both `executeRoute` and the `Runner` pass `[scene.entry_actions[0]]` for route-driven transitions; direct scene execution is unchanged.

Relevant code:

- `packages/ts/scene-runner/src/executor/route-executor.ts`
- `packages/ts/scene-runner/src/runner.ts`
- `packages/ts/scene-runner/src/executor/scene-executor.ts`

### 5.4 Missing prepare sources do not fail the action

`resolveActionPrepare(...)` returns `buildNull('missing')` when:

- a `from_state` path is absent
- a `from_hook` handler is missing
- a hook response omits the binding

The scene spec describes these as action failures before graph execution, not silent null injection.

Impact:

- workflows can continue with sentinel nulls instead of failing loudly
- debugging becomes harder because the source of failure is erased into data

### 5.5 Prepare hooks are not deduplicated — FIXED

`resolveActionPrepare(...)` now maintains a per-invocation `hookCache` keyed by hook name. Each hook is called at most once per `resolveActionPrepare` call; subsequent bindings that reference the same hook read from the cache.

### 5.6 Overview / `view` data is parsed, then dropped

The parser and AST support `view`, `flow`, and `enforce`, but the lowered HCL model and emitted JSON do not preserve that structure.

Observed shape:

- AST has `ViewBlock`
- `lower.HCLSceneBlock` has no `View`
- `scene-model.ts` has no view model
- runtime has no overview enforcement path

Impact:

- one part of the DSL is effectively non-executable metadata today
- spec coverage for overview enforcement is not reflected in the implementation

### 5.7 Scene-runner unit tests are out of sync with the current API — FIXED

The tests use `StateManager.from(...)` and `StateManager.fromSchema(...)`. The `StateManager` type has been converted to an `interface` and a merged `namespace StateManager` now exports `from` and `fromSchema` as aliases for `stateManagerFrom` and `stateManagerFromSchema`. All 130 scene-runner tests pass.

### 5.8 Empty array literal inference is fragile in the scene-runner — FIXED

Both `inferLiteralAnyValue` (hcl-context-builder) and `inferLiteralValue` (prepare-resolver) now detect an empty array and return `buildArray([])` instead of falling through to a null or wrong-type fallback. Non-empty arrays continue to use element-type inference as before.

### 5.9 Multi-scene routing is stronger in the runtime than in the compiler

The runtime works with `TurnModel.scenes: SceneBlock[]`, but the Go converter still centers on a singular `Scene` in `lower.Model` and wraps that into a one-element JSON array.

Impact:

- route orchestration can be demonstrated with hand-built JSON fixtures
- end-to-end authoring of multi-scene route systems through the compiler is not yet first-class

## 6. Improvement Points 1 (Design Overview)

### Establish one shared contract for Go and TS

The highest-leverage design improvement is a single schema contract for the JSON boundary:

- JSON Schema
- generated TS types
- generated Go structs, or schema validation in tests

That would reduce silent drift between:

- `emit/json.go`
- `scene-model.ts`
- spec documents

### Separate implemented features from aspirational spec surface

Right now the spec documents more than the runtime fully executes, especially around:

- publish hooks
- overview enforcement
- route-driven entry semantics

A short implementation-status matrix in the repo would make planning and review easier.

## 7. Improvement Points 2 (Types And Interfaces)

### Split prepare hooks from publish hooks at the type level

The current `HookRegistry` models only one hook shape:

- input: `readState`
- output: `Record<string, AnyValue>`

That fits prepare hooks, but not publish hooks. Publish hooks want:

- read-only final state snapshot
- ignored return value

Separate interfaces would prevent lifecycle confusion.

### Preserve view metadata explicitly, or remove it intentionally

If `view` is part of the product, it should exist end to end:

- AST
- lowered model
- JSON model
- runtime validation or enforcement

If not, it should be called out as parse-only or draft-only.

### Strengthen literal typing at the scene boundary

`Literal` currently relies on runtime inference from JS values. Empty arrays show the weakness of that approach. The runtime would be safer if array element type always arrived explicitly from the binding declaration or schema.

## 8. Improvement Points 3 (Implementations)

1. ~~Fix `resolveTurnoutBin()` to return `'turnout'` when PATH lookup succeeds.~~ **Done.**
2. Add a real publish phase to action execution and cover it with tests.
3. ~~Introduce a route-entry helper that launches only the first target scene entry action.~~ **Done.**
4. Decide on missing-source semantics:
   - fail fast per spec, or
   - document the current null-injection behavior as intentional
5. ~~Cache prepare hook results per action invocation by hook name.~~ **Done.**
6. ~~Either restore `StateManager.from*` compatibility wrappers or update the failing tests to the current API.~~ **Done** — restored via interface/namespace merging.
7. Preserve `view`/overview data through lowering if the spec remains active.
8. ~~Add typed empty-array handling in `hcl-context-builder.ts` and `prepare-resolver.ts`.~~ **Done.**
9. Add integration tests for the `turnFile` path, not just prebuilt JSON fixtures.

## 9. Learning Paths On Implementations (Entries And Goals)

### Path A: Understand the compiler

Start with:

- `packages/go/converter/cmd/turnout/main.go`
- `packages/go/converter/internal/parser/parser.go`
- `packages/go/converter/internal/lower/lower.go`
- `packages/go/converter/internal/validate/validate.go`

Goal:

- understand how Turn DSL syntax becomes canonical HCL and JSON

### Path B: Understand the runtime engine

Start with:

- `packages/ts/runtime/src/state-control/value.ts`
- `packages/ts/runtime/src/compute-graph/types.ts`
- `packages/ts/runtime/src/compute-graph/runtime/validateContext.ts`
- `packages/ts/runtime/src/compute-graph/runtime/exec/executeGraph.ts`

Goal:

- understand how validated typed values flow through combine, pipe, and cond execution

### Path C: Understand product behavior

Start with:

- `packages/ts/scene-runner/src/types/scene-model.ts`
- `packages/ts/scene-runner/src/executor/hcl-context-builder.ts`
- `packages/ts/scene-runner/src/executor/action-executor.ts`
- `packages/ts/scene-runner/src/executor/scene-executor.ts`
- `packages/ts/scene-runner/src/executor/route-executor.ts`

Goal:

- understand how state, hooks, actions, scenes, and routes compose into actual workflow execution

### Path D: Understand intended behavior

Read in this order:

- `spec/state-shape-spec.md`
- `spec/hcl-context-spec.md`
- `spec/scene-graph.md`
- `spec/scene-to-scene.md`
- `spec/convert-runtime-spec.md`

Goal:

- compare the implementation against the contract and quickly spot spec drift

## Summary

The repository has a strong core: the Go converter pipeline is well-structured, and the TypeScript runtime is the most mature and reliable subsystem today. The weakest point is the scene-runner layer, not because its architecture is poor, but because it is currently where most behavior-level drift accumulates.

**Fixed 2026-03-21** (5 of 9 implementation items resolved, all 130 scene-runner tests now pass):

- 5.1 server bridge binary lookup (`'runtime'` → `'turnout'`)
- 5.3 route-driven entry now uses only the first `entry_actions` element
- 5.5 prepare hooks deduplicated per action invocation via `hookCache`
- 5.7 `StateManager` interface + namespace merging restores `.from` / `.fromSchema`
- 5.8 empty array literals now produce `buildArray([])` instead of a null fallback

Remaining open items:

- 5.2 implement the publish lifecycle phase
- 5.4 decide on missing-source semantics (fail-fast vs. documented null injection)
- 5.6 preserve or explicitly drop `view`/overview data through lowering
- 5.9 multi-scene authoring end-to-end through the compiler
- item 9: integration tests for the `turnFile` path

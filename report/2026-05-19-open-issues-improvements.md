# Open Issues and Improvements
**Date:** 2026-05-19
**Updated:** 2026-05-19 (all issues and improvements resolved except where noted)

This file consolidates only still-open items from `report/2026-05-08-code-analysis.md`, `report/2026-05-16-code-analysis.md`, and `report/2026-05-18-code-analysis.md`, after cross-checking the current codebase.

---

## Open Issues

### 4. Go converter is still a subprocess dependency for server-side loading

**Location:** `packages/ts/scene-runner/src/server/bridge.ts:26-68`

The scene-runner server bridge resolves a `turnout` binary from `TURNOUT_BIN`, `PATH`, or a locally built Go binary, then invokes it with `execFileSync`.

**Impact:** TypeScript consumers that load `.turn` files need Node `child_process` access and a built Go converter binary. This limits browser/serverless portability.

**Status:** Partially mitigated. `loadJsonModel` now carries a JSDoc comment explicitly marking it as the preferred entry point for environments without `child_process` (browsers, edge functions, WASM hosts). A full WASM converter remains out of scope.

---

## Open Improvements

### 4. `#case` wildcard-only lowering emits an extra identity binding

**Location:** `packages/go/converter/internal/lower/lower_local.go` (formerly `lower.go:858-860`)

When a `#case` has no conditional arms, the lowerer emits an identity binding from the fallback function into the user binding.

**Impact:** This is correct but slightly wasteful, similar to bare-reference identity lowering.

**Potential improvement:** If the runtime gains direct alias support, assign the fallback result directly to the user binding name. Blocked on first-class alias/value-reference support in the runtime.

### 9. Source positions are not embedded in emitted JSON

**Location:** `schema/turnout-model.proto:18-27`, `packages/ts/scene-runner/src/types/turnout-model_pb.ts`

The proto model carries schema data, scenes, routes, version, and sigil annotations, but no general source-position map for bindings/actions/routes in emitted JSON.

**Impact:** TypeScript runtime errors cannot reliably point back to the originating `.turn` line/column.

**Potential improvement:** Add optional source-position metadata to the model, likely gated so normal JSON output can stay compact. Requires coordinated proto schema, Go emitter, and TS parser changes — out of scope for this pass.

---

## Resolved

### Issue 1 — Publish hooks are effectively fire-and-forget ✓

**Location:** `packages/ts/scene-runner/src/executor/action-executor.ts`

**Resolution:** Added `PublishHookOutcome` type (`{ hookName, status: 'ok' | 'error'; message? }`). Publish hook calls are now wrapped in try/catch; both successes and thrown errors are collected into `ActionExecutionResult.publishOutcomes`. Hooks remain best-effort — a thrown error no longer fails action execution. `PublishHookImpl` return type widened to `PublishHookOutcome | void | Promise<...>` so existing void-returning hooks stay valid.

### Issue 2 — `StateManager.read` silently returns `undefined` for unknown paths ✓

**Location:** `packages/ts/scene-runner/src/state/state-manager.ts`

**Resolution:** Added `readStrict(path: string): AnyValue` to the `StateManager` interface and `make()` factory. Schema-backed managers throw on unknown paths; unchecked managers return `buildNull('missing')` without throwing, making all paths valid.

### Issue 3 — Hook registry typing requires unsafe publish-hook casting ✓

**Location:** `packages/ts/scene-runner/src/types/harness-types.ts`, `packages/ts/scene-runner/src/executor/action-executor.ts`, `packages/ts/scene-runner/src/executor/prepare-resolver.ts`

**Resolution:** `HookRegistry` split into `{ prepare: Record<string, PrepareHookImpl>; publish: Record<string, PublishHookImpl> }`. `action-executor.ts` now reads from `hooks.publish[hookName]` and `prepare-resolver.ts` from `hooks.prepare[hookName]` — both without casts or ESLint suppressions. `Runner` gained typed `usePrepareHook` / `usePublishHook` methods; the old `useHook` is kept as a deprecated shim routing to `prepare`.

### Improvement 1 — Split `lower.go` into focused files ✓

**Location:** `packages/go/converter/internal/lower/`

**Resolution:** The 1343-line `lower.go` was split into five files, all in package `lower`:
- `lower.go` — entry point, conversion helpers, route/state/scene/action/prepare/merge/publish/next/prog/binding lowering
- `lower_rhs.go` — RHS-specific lowering functions
- `lower_local.go` — `localLowerer` struct and all local-expression lowering methods
- `lower_proto.go` — AST→proto `LocalExprModel` converters and arg lowering
- `lower_prepare.go` — `prepareResolver` interface, both implementations, `zeroLiteralFor`

### Improvement 2 — Legacy `BindingRHS` variants undocumented ✓

**Location:** `packages/go/converter/internal/lower/lower.go` (`lowerBinding` switch)

**Resolution:** Added `// legacy: emitted by the pre-v1 parser; kept until confirmed no input produces these forms.` comments above the `PipeRHS`, `CondRHS`, and `IfRHS` cases. Removal is a follow-up once the parser is audited.

### Improvement 3 — No shared `identityFnFor` helper ✓

**Location:** `packages/go/converter/internal/lower/lower_rhs.go`

**Resolution:** Extracted `identityFnFor(ft ast.FieldType) (fn string, identityArg *turnoutpb.ArgModel)` helper. `lowerSingleRefRHS` now calls it instead of duplicating the type switch.

### Improvement 5 — `#pipe` context saved/restored as three separate fields ✓

**Location:** `packages/go/converter/internal/lower/lower_local.go`

**Resolution:** Added `pipeContext` struct (`itRef`, `itType`, `itAllowed`) and `savePipeCtx()` / `restorePipeCtx()` methods on `localLowerer`. `lowerPipeInto` now uses `prev := c.savePipeCtx()` and `c.restorePipeCtx(prev)`.

### Improvement 6 — `MethodCallArg` is part of the post-lowering `Arg` hierarchy ✓

**Location:** `packages/go/converter/internal/ast/ast.go`

**Resolution:** Added `PreLowerArg interface{ preLowerArg() }`. `MethodCallArg` now implements both `Arg` (required for parser `[]Arg` slices) and `PreLowerArg`, with an updated doc comment clarifying it is a source-syntax form resolved to `TransformArg` by the lowerer.

### Improvement 7 — Runtime argument-map keys are unbranded strings ✓

**Location:** `packages/ts/runtime/src/compute-graph/types.ts`, `packages/ts/runtime/src/compute-graph/idValidation.ts`

**Resolution:** Added `ArgName = Brand<string, 'argName'>` brand type and `createArgName(name: string): ArgName` constructor. `FuncArgMap` updated to `{ [argName in ArgName]: ValueId }`. All construction sites use `createArgName`; read sites use `as ArgName` or `as unknown as ArgName` casts where brand types differ.

### Improvement 8 — `ConditionId` source checks are manual discriminant strings ✓

**Location:** `packages/ts/runtime/src/compute-graph/types.ts`

**Resolution:** Added `isValueCondition` and `isFuncCondition` type-guard helpers exported from `types.ts` (and re-exported through `compute-graph/index.ts` and `runtime/src/index.ts`). The typed call site in `validateContext.ts` now uses these guards; the untyped structural validation path retains the raw string comparison since `conditionId` is `Record<string, unknown>` there.

### Improvement 10 — Version handling has no migration table ✓

**Location:** `packages/ts/scene-runner/src/migration.ts`, `packages/ts/scene-runner/src/runner.ts`

**Resolution:** Created `migration.ts` with a `migrations: Record<number, MigrationFn>` table and `migrateModel(model): TurnModel` that applies sequential migrations up to `CURRENT_VERSION = 1`. Version 0 → 1 is a no-op (semantically identical). `createRunner` now calls `migrateModel` instead of doing an inline version check. Future schema versions can be added as entries in the migrations table without touching `runner.ts`.

# Open Issues and Improvements
**Date:** 2026-05-19

This file consolidates only still-open items from `report/2026-05-08-code-analysis.md`, `report/2026-05-16-code-analysis.md`, and `report/2026-05-18-code-analysis.md`, after cross-checking the current codebase.

---

## Open Issues

### 1. Publish hooks are effectively fire-and-forget

**Location:** `packages/ts/scene-runner/src/executor/action-executor.ts:97-108`

`executeAction` invokes publish hooks after merge and awaits each hook, but there is still no typed publish result, retry policy, failure classification, or recovery path. A thrown hook error can fail action execution, while successful hook return values are ignored by design.

**Impact:** Safety-critical publish workflows cannot express acknowledgement, retry, compensation, or partial external failure semantics.

**Potential improvement:** Define an explicit publish hook result contract and decide whether publish failure should roll back state, return a structured scene error, enqueue retry metadata, or remain best-effort.

### 2. `StateManager.read` silently returns `undefined` for unknown paths

**Location:** `packages/ts/scene-runner/src/state/state-manager.ts:19-21`, `packages/ts/scene-runner/src/state/state-manager.ts:36-38`

`write()` validates paths in strict/schema-backed managers, but `read()` directly returns `state[path]`. This means typoed reads and absent state values are indistinguishable.

**Impact:** Runtime bugs in prepare resolution or consumer code can look like legitimate missing values.

**Potential improvement:** Add strict-mode read validation or a second read API that distinguishes `missing path` from `known path with undefined value`.

### 3. Hook registry typing still requires unsafe publish-hook casting

**Location:** `packages/ts/scene-runner/src/types/harness-types.ts:22-26`, `packages/ts/scene-runner/src/executor/action-executor.ts:100-108`

`HookRegistry` is `Record<string, HookImpl>`, where `HookImpl` is `PrepareHookImpl | PublishHookImpl`. The publish path must cast a registry entry to `PublishHookImpl`, guarded by an ESLint suppression.

**Impact:** A prepare-shaped hook can be registered for a publish hook name without static enforcement.

**Potential improvement:** Split prepare and publish hook registries, or encode hook kind in the registry value.

### 4. Go converter is still a subprocess dependency for server-side loading

**Location:** `packages/ts/scene-runner/src/server/bridge.ts:26-68`

The scene-runner server bridge resolves a `turnout` binary from `TURNOUT_BIN`, `PATH`, or a locally built Go binary, then invokes it with `execFileSync`.

**Impact:** TypeScript consumers that load `.turn` files need Node `child_process` access and a built Go converter binary. This limits browser/serverless portability.

**Potential improvement:** Provide a WASM converter package or require pre-converted JSON at runtime boundaries.

---

## Open Improvements

### 1. Split `lower.go` into focused files

**Location:** `packages/go/converter/internal/lower/lower.go` (currently 1343 lines)

The lowerer still contains state/scene/action lowering, legacy RHS lowering, local `#if/#case/#pipe` lowering, prepare resolution, and proto-local-expression conversion in one file.

**Potential improvement:** Split into files such as `lower_pipeline.go`, `lower_local.go`, and `lower_prepare.go` while keeping package-private helpers.

### 2. Legacy `BindingRHS` variants remain in the lowering switch

**Location:** `packages/go/converter/internal/lower/lower.go:396-422`

`PipeRHS`, `CondRHS`, and `IfRHS` are still handled alongside the v1 call forms. The current parser emits v1 `IfCallRHS`, `CaseCallRHS`, and `PipeCallRHS` for new syntax, so these branches are legacy compatibility surface.

**Potential improvement:** Confirm whether legacy block forms are still supported input. If not, remove the AST variants, parser paths, lowerer branches, and related tests.

### 3. Bare reference lowering still emits identity combine calls

**Location:** `packages/go/converter/internal/lower/lower.go:469-495`

`name:type = other` lowers to a type-specific identity combine, such as `add(other, 0)` or `str_concat(other, "")`.

**Impact:** This adds an extra runtime function node for a pure alias.

**Potential improvement:** Add first-class alias/value-reference support in the model/runtime, or at least extract a shared `identityFnFor` helper used by both `lowerSingleRefRHS` and `emitIdentity`.

### 4. `#case` wildcard-only lowering emits an extra identity binding

**Location:** `packages/go/converter/internal/lower/lower.go:858-860`

When a `#case` has no conditional arms, the lowerer emits an identity binding from the fallback function into the user binding.

**Impact:** This is correct but slightly wasteful, similar to bare-reference identity lowering.

**Potential improvement:** If the runtime gains direct alias support, assign the fallback result directly to the user binding name.

### 5. `#pipe` context is saved/restored as three separate fields

**Location:** `packages/go/converter/internal/lower/lower.go:910-925`

`itRef`, `itType`, and `itAllowed` are always saved/restored together, but they are managed as separate locals.

**Impact:** Future edits can accidentally restore only part of the pipe context.

**Potential improvement:** Introduce a small `pipeContext` struct with save/restore helpers.

### 6. `MethodCallArg` is still part of the post-lowering `Arg` hierarchy

**Location:** `packages/go/converter/internal/ast/ast.go:596-636`

`MethodCallArg` represents source syntax (`receiver.method()`), but it implements `Arg`, whose comment describes post-lowering proto-level arguments.

**Impact:** The type hierarchy still mixes source syntax with lowered argument shapes.

**Potential improvement:** Move method-call syntax into a separate pre-lowering interface or lower it into `TransformArg` earlier.

### 7. Runtime argument-map keys are unbranded strings

**Location:** `packages/ts/runtime/src/compute-graph/types.ts:44-47`

`FuncArgMap` is typed as `{ [argName in string]: ValueId }`, so argument names are not distinguishable from arbitrary strings at the type level.

**Potential improvement:** Introduce an `ArgName` brand or a helper constructor for function argument maps.

### 8. `ConditionId` source checks are still manual discriminant strings

**Location:** `packages/ts/runtime/src/compute-graph/types.ts:127-129`

`ConditionId` uses `{ source: 'value' | 'func'; id }`. This is valid, but call sites still rely on raw string discriminants.

**Potential improvement:** Add small helpers such as `isValueCondition()` / `isFuncCondition()` to centralize narrowing.

### 9. Source positions are not embedded in emitted JSON

**Location:** `schema/turnout-model.proto:18-27`, `packages/ts/scene-runner/src/types/turnout-model_pb.ts`

The proto model carries schema data, scenes, routes, version, and sigil annotations, but no general source-position map for bindings/actions/routes in emitted JSON.

**Impact:** TypeScript runtime errors cannot reliably point back to the originating `.turn` line/column.

**Potential improvement:** Add optional source-position metadata to the model, likely gated so normal JSON output can stay compact.

### 10. Version handling validates only the current schema

**Location:** `schema/turnout-model.proto:21-23`, `packages/ts/scene-runner/src/runner.ts:114-119`

The runner rejects unsupported non-zero versions, but there is no reader-side migration table or compatibility strategy.

**Impact:** Future schema evolution will require hard cutovers unless migration support is added.

**Potential improvement:** Add versioned readers or migration functions before execution.

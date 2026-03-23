# Codebase Analysis Report

Date: 2026-03-22

## Summary

This repository is organized around a clean compiler/runtime split:

- A Go converter parses Turn DSL, resolves state schema, lowers to a canonical model, validates it, and emits either HCL or JSON.
- A TypeScript runtime consumes the shared JSON model, builds execution contexts, executes scene/action graphs, and manages route orchestration and state transitions.

The overall architecture is strong. The most reliable parts are the phased converter pipeline, the shared protobuf contract, the runtime's separation between graph execution and orchestration, and the breadth of the test suite.

## Verification

The full workspace test command passed on 2026-03-22:

```sh
pnpm test
```

Results:

- TypeScript runtime: 13 test files, 178 tests passed
- TypeScript scene-runner: 14 test files, 184 tests passed
- Go converter packages: all tests passed

## Architecture Overview

### Go converter

The Go converter follows a clear staged pipeline:

1. `lexer` tokenizes DSL input
2. `parser` builds AST nodes
3. `state` resolves inline or external state schema
4. `lower` converts AST to canonical intermediate model
5. `validate` applies structural and type rules
6. `emit` writes HCL or converts through HCL validation into JSON

Key entrypoints:

- `packages/go/converter/cmd/turnout/main.go`
- `packages/go/converter/internal/parser/parser.go`
- `packages/go/converter/internal/state/state.go`
- `packages/go/converter/internal/lower/lower.go`
- `packages/go/converter/internal/validate/validate.go`
- `packages/go/converter/internal/emit/emit.go`
- `packages/go/converter/internal/emit/json.go`

### Shared model contract

The main integration seam between Go and TypeScript is:

- `schema/turnout-model.proto`

This is a strong design choice. It keeps the converter/runtime boundary explicit and reduces drift risk between emitted JSON and runtime expectations.

### TypeScript runtime

The runtime is split into two conceptual layers:

- Generic compute-graph/value machinery in `packages/ts/runtime`
- Turn-specific scene/route orchestration in `packages/ts/scene-runner`

Important orchestration files:

- `packages/ts/scene-runner/src/executor/hcl-context-builder.ts`
- `packages/ts/scene-runner/src/executor/action-executor.ts`
- `packages/ts/scene-runner/src/executor/scene-executor.ts`
- `packages/ts/scene-runner/src/executor/route-executor.ts`
- `packages/ts/scene-runner/src/harness/harness.ts`
- `packages/ts/scene-runner/src/runner.ts`

## Code Organization and Relationships

### Types and interfaces

The model layering is easy to follow:

- AST types live in `internal/ast`
- lowered canonical representation lives in `internal/lower`
- diagnostics are centralized in `internal/diag`
- runtime schema is shared via protobuf-generated types

This structure makes it easier to reason about phase boundaries and data ownership.

### Function relationships

The runtime flow is also coherent:

- action `prepare` values are resolved first
- a runtime graph context is built from the program
- graph execution produces binding values
- `merge` writes selected values back into state
- scene and route executors compose these action-level results

One nice property is that compute-graph validation is separated from orchestration logic, which keeps most runtime behavior readable and testable.

## Reliability Assessment

### Strengths

- Diagnostics are accumulated instead of failing at the first issue, which improves author feedback.
- Validation is layered, with structural checks in Go before emission and graph-level validation in TypeScript before execution.
- State management in the TypeScript runtime is immutable across writes, which reduces accidental mutation risk.
- The repository has a strong automated test surface across both Go and TypeScript.
- Route matching logic is explicit and separately testable.

### Pitfalls and design gaps

#### 1. `publish` hooks are modeled but not executed

The specs describe a `prepare -> compute -> merge -> publish` lifecycle, and the protobuf model includes `publish` on actions, but the current runtime action executor stops after merge and returns.

Relevant files:

- `packages/ts/scene-runner/src/executor/action-executor.ts`
- `packages/ts/scene-runner/src/types/harness-types.ts`
- `schema/turnout-model.proto`

This is the largest behavior gap between the stated lifecycle and the implemented runtime.

#### 2. Action `text` is preserved in HCL but dropped in JSON/runtime

The scene spec describes optional action text, and the HCL path carries it, but the JSON decode path explicitly ignores it and the protobuf action model has no field for it.

Relevant files:

- `packages/go/converter/internal/emit/hcl_decode.go`
- `schema/turnout-model.proto`

This means HCL output is richer than JSON output, which creates asymmetry between converter modes.

#### ~~3. The Go converter is still structurally single-scene~~ ✅ Fixed 2026-03-23

The parser, lowered model, validator, and HCL emitter all now support multiple scene blocks per file. `TurnFile.Scenes` is a slice, the parser accumulates all scene blocks, `Lower()` produces `Model.Scenes`, `Validate()` loops over each scene and emits a `DuplicateSceneID` diagnostic for duplicate IDs, and `Emit()` writes all scenes in order. Single-scene files continue to work unchanged. The runtime and protobuf contract were already multi-scene and required no changes.

Relevant files:

- `packages/go/converter/internal/ast/ast.go`
- `packages/go/converter/internal/parser/parser.go`
- `packages/go/converter/internal/lower/lower.go`
- `packages/go/converter/internal/validate/validate.go`
- `packages/go/converter/internal/emit/emit.go`

#### 4. Route entry is implicit and order-dependent

When executing a route, the runtime chooses `model.scenes[0]` as the entry scene. That makes route start behavior dependent on scene ordering rather than explicit route metadata.

Relevant files:

- `packages/ts/scene-runner/src/harness/harness.ts`
- `packages/ts/scene-runner/src/runner.ts`

This is workable for fixtures, but brittle as the format evolves.

#### 5. HCL emission does not surface write failures

The emitter currently writes to `io.Writer` without returning write errors. The code comments acknowledge this, but it still means truncated or partially failed HCL writes may not be surfaced cleanly by the API.

Relevant file:

- `packages/go/converter/internal/emit/emit.go`

## Improvement Points

### Design-level

- ~~Unify the product direction around either true multi-scene conversion or explicitly single-scene authoring, because the current converter/runtime boundary is inconsistent.~~ ✅ Fixed 2026-03-23 — the converter now supports multiple scenes, aligning with the runtime and proto contract.
- Make route entry explicit in the shared model instead of inferring it from array order.
- Decide whether HCL and JSON outputs are meant to be semantically equivalent; if yes, add `text` support to the JSON model path.

### Types and interfaces

- Split hook interfaces by phase: prepare hooks returning binding maps versus publish hooks receiving final state read-only.
- Promote behavior-critical lifecycle fields into the shared proto whenever they are intended to survive JSON conversion.

### Implementations

- ~~Teach the Go converter to represent multiple scenes if route-oriented authoring is a first-class goal.~~ ✅ Fixed 2026-03-23
- Add runtime publish-hook execution after merge.
- Return or collect writer errors in the HCL emitter.

## Learning Path

For someone onboarding to this repo, the most effective reading order is:

1. `packages/go/converter/cmd/turnout/main.go`
2. `packages/go/converter/internal/parser/parser.go`
3. `packages/go/converter/internal/lower/lower.go`
4. `packages/go/converter/internal/validate/validate.go`
5. `packages/go/converter/internal/emit/json.go`
6. `schema/turnout-model.proto`
7. `packages/ts/runtime/src/compute-graph/runtime/validateContext.ts`
8. `packages/ts/scene-runner/src/executor/hcl-context-builder.ts`
9. `packages/ts/scene-runner/src/executor/action-executor.ts`
10. `packages/ts/scene-runner/src/executor/scene-executor.ts`
11. `packages/ts/scene-runner/src/executor/route-executor.ts`

## Final Assessment

This is a thoughtful and fairly disciplined codebase. The foundation is good, the tests are meaningful, and the major seams are easy to understand. The main risks are not general code quality issues so much as unfinished product alignment issues at the converter/runtime boundary, especially around multi-scene support, publish lifecycle support, and HCL versus JSON feature parity.

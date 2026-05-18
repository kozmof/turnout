# Code Analysis: Turnout DSL Compiler + Runtime
**Date:** 2026-05-18

---

## 1. Code Organization and Structure

The project is a **monorepo for a DSL compiler+runtime** called "Turnout" (Turn language). Its architecture is a classic two-sided pipeline:

```
.turn source → [Go Converter] → JSON model → [TypeScript Scene Runner]
```

### Top-level layout

| Directory | Role |
|---|---|
| `schema/turnout-model.proto` | Protobuf schema — single source of truth for the Go↔TS contract |
| `packages/go/converter/` | Go compiler: lex → parse → lower → validate → emit (HCL / JSON) |
| `packages/ts/runtime/` | TypeScript compute-graph execution engine |
| `packages/ts/scene-runner/` | TypeScript scene / action / route orchestrator |
| `apps/vscode/turn-language/` | VSCode syntax highlighting extension |
| `spec/` | DSL specification documents |

### Go converter internal layout

| Package | File | Purpose |
|---|---|---|
| `cmd/turnout` | `main.go` | CLI entry: `convert` / `validate` |
| `internal/lexer` | `lexer.go` | Hand-written scanner |
| `internal/parser` | `parser.go` | Recursive-descent parser |
| `internal/ast` | `ast.go` | AST node types |
| `internal/lower` | `lower.go` | AST → proto model |
| `internal/validate` | `validate.go` | Type & structural checks |
| `internal/emit` | `emit.go`, `json.go` | HCL / JSON output |
| `internal/state` | `state.go` | Schema loading / resolution |
| `internal/diag` | `diag.go` | Diagnostics system |
| `internal/overview` | `overview.go` | Flow-graph parse & enforcement |
| `internal/localexpr` | `proto.go` | Proto LocalExprModel walker |
| `internal/lower` | `sidecar.go` | Sigil metadata side-channel |

---

## 2. Relations of Implementations (Types / Interfaces)

### Go AST layer (`internal/ast`)

All interface types use **unexported marker methods** so the Go compiler enforces exhaustiveness in type switches:

```
ast.BindingRHS          (bindingRHS())
  ├── LiteralRHS        literal value
  ├── SingleRefRHS      bare identifier
  ├── FuncCallRHS       fn(args)
  ├── InfixRHS          lhs OP rhs
  ├── PipeRHS           legacy #pipe
  ├── CondRHS / IfRHS   legacy cond forms
  ├── IfCallRHS         v1 #if(cond, then, else)
  ├── CaseCallRHS       v1 #case(subject, arms...)
  ├── PipeCallRHS       v1 #pipe(initial, steps...)
  └── SigilInputRHS     ~> / <~> input declaration

ast.LocalExpr           (localExpr())  — pre-lowering expression tree
  ├── LocalRefExpr      bare identifier
  ├── LocalLitExpr      literal value
  ├── LocalItExpr       #it (pipe current value)
  ├── LocalCallExpr     fn(args)
  ├── LocalInfixExpr    lhs OP rhs
  ├── LocalIfExpr       #if(cond, then, else)
  ├── LocalCaseExpr     #case(subject, arms...)
  └── LocalPipeExpr     #pipe(initial, steps...)

ast.Arg                 (arg())        — post-lowering proto-level arg
  ├── RefArg            { ref = "name" }
  ├── LitArg            { lit = value }
  ├── FuncRefArg        { func_ref = "name" }
  ├── StepRefArg        { step_ref = N }
  ├── TransformArg      { transform = { ref, fn } }
  └── MethodCallArg     receiver.method1().method2()  (lowered → TransformArg)

ast.StateSource         (stateSource())
  ├── InlineStateBlock  literal state { ... }
  └── StateFileDirective state_file = "path"
```

### Proto model layer (`turnoutpb.*`)

Generated from `schema/turnout-model.proto`. Key: `TurnModel → StateModel, SceneBlock, RouteModel`. `BindingModel` carries exactly one of `value`, `expr`, or `ext_expr`. `LocalExprModel` is a proto `oneof` tree that mirrors `ast.LocalExpr`.

### TypeScript runtime layer

| Type | Role |
|---|---|
| `ExecutionContext` | Read-only bag of all tables; passed through all exec functions |
| `ScopedExecutionContext` | `ExecutionContext` + pipe-local `visibleValueIds` |
| `FuncTableEntry` | Discriminated union: `combine \| pipe \| cond` |
| `StateManager` (interface) | Immutable flat-map; `read` / `write` / `snapshot` |
| `ValueId`, `FuncId`, `CombineDefineId`, … | Branded `string` types for nominal safety |

---

## 3. Relations of Implementations (Functions)

### Go compiler pipeline

```
os.ReadFile
  → parser.ParseFile           (calls lexer.Tokenize internally)
    → state.Resolve            (loads schema from inline block or file)
      → lower.Lower            (AST + schema → TurnModel proto)
        → validate.Validate    (all type/structural checks)
          → emit.Emit / emit.EmitJSON
```

### Go lower layer (key dispatch)

| Function | Input → Output | Notes |
|---|---|---|
| `lowerBinding(decl, ...)` | `BindingDecl → []*BindingModel` | Main dispatch switch on RHS type |
| `lowerLocalRHS(...)` | `IfCallRHS\|CaseCallRHS\|PipeCallRHS → []*BindingModel` | Creates `localLowerer`, calls `lowerTop` |
| `localLowerer.lowerTop(rhs)` | `BindingRHS → []*BindingModel` | Attaches `ext_expr` to user binding |
| `localLowerer.lowerIfInto(...)` | emits cond temp, then-fn temp, else-fn temp, final cond binding | |
| `localLowerer.lowerCaseInto(...)` | emits in reverse-arm order (last arm first) for topological ordering | **non-obvious** |
| `localLowerer.lowerPipeInto(...)` | threads `#it` context through steps | saves/restores `itRef/itType/itAllowed` |

### TypeScript scene-runner

| Function | Role |
|---|---|
| `createSceneExecutor(scene, state, hooks, ...)` | Returns a manual-step executor |
| `executeScene(...)` | One-shot: calls `executor.next()` until `isDone()` |
| `executeSceneSafe(...)` | Same but returns discriminated union, never throws `SceneRuntimeError` |
| `evaluateNextRules(action, state, result, policy)` | Per action: builds independent context per next-rule prog, evaluates condition, respects `first-match` / `all-match` policy |
| `executeAction(action, state, hooks)` | Builds compute context, runs `executeGraph`, applies merge |
| `buildContextFromProg(prog, prepared, actionId)` | Builds `ExecutionContext` from a proto `ProgModel` |
| `executeGraph(funcId, ctx)` | Traverses the compute DAG from a root function |

---

## 4. Specific Contexts and Usages

### State data flow

```
STATE (flat dotted-path map)
  ↓  prepare { binding { from_state = "ns.field" } }
prog bindings  ←  compute   →  root binding (action output)
  ↓  merge { binding { to_state = "ns.field" } }
STATE (updated)
```

### Sigil system (`~>`, `<~`, `<~>`)

Sigils are captured in `lower/sidecar.go` as `(sceneID, actionID, scope, progName, bindingName) → Sigil`, embedded into `TurnModel.Annotations`, and consumed by the validator's `validateActionEffects`. The emitter clears `Annotations` before output. This is a **pure compile-time metadata path** — the TypeScript runtime never sees sigils.

### Route / match patterns

Patterns are stored as strings: `"scene_id.action_id"`, `"scene_id.*.terminal_action"`, or `"_"` (fallback). The scene-runner's `route-pattern.ts` matches these against `"scene_id.action_id"` breadcrumbs from executed actions.

### `#case` lowering ordering invariant

`lowerCaseInto` emits conditional bindings in **reverse arm order** (last arm first) so that each `CondExpr.else_branch` can reference the next arm's binding by name. The user-declared binding name is assigned to the outermost arm (emitted last). Violating this ordering would break the TypeScript runtime's DAG traversal.

---

## 5. Pitfalls

1. **Dead code: `detectBindingCycles`** (`validate.go:1455–1489`). This function is never called. The same DFS cycle detection is already inlined in `validateProg`'s Pass 1b (lines 289–319). Readers will assume it is used somewhere and waste time tracing call sites.

2. **`stateManagerFrom` is silently no-op for type safety** (`state-manager.ts:64`). The deprecated alias calls `stateManagerFromUnchecked`, which skips path validation. Code that relies on the old alias gets no protection against typo'd state paths.

3. **`StateManager.write` does not validate value types**. The interface enforces that the *path* exists (if strict mode), but not that the *value type* matches the schema's declared type. A `merge` that writes a `str` into a `number` field succeeds silently.

4. **`lowerStateBlockFromSchema` sorts alphabetically; inline state preserves declaration order** (`lower.go:169–203`). Two logically identical state definitions (one inline, one via `state_file`) produce different ordering in the emitted model, which affects HCL diff readability.

5. **Route validation does not check that action IDs exist in target scenes** (`validate.go:128–154`). `validateRoute` checks that target scenes exist in `knownScenes`, but match-arm patterns like `scene_id.action_id` are only structurally validated — the action ID is not verified against the target scene's action list.

6. **`inferLocalType` falls back to the declared type on unknown references** (`lower.go:1056–1097`). When a reference is undefined, `inferLocalType` returns `fallback` (the binding's declared type). The `UndefinedRef` diagnostic IS emitted, but the generated temp binding still gets the fallback type, which may cause a cascade of misleading type errors downstream.

7. **`executeSceneSafe` loses partial state on non-`SceneRuntimeError` throws** (`scene-executor.ts:204–223`). If `executor.next()` throws any error *other* than `SceneRuntimeError`, the outer `catch` re-throws and `executor.partialState()` is never returned.

8. **`parseIdentRHS` uses `panic` for the infix switch exhaustiveness guard** (`parser.go:556`). All other unreachable branches in the parser use `errorf`. The inconsistency is benign but will crash the process rather than surfacing a diagnostic in the unexpected case.

---

## 6. Improvement Points — Design Overview

1. **Split `lower.go`** (1344 lines) into three files:
   - `lower_pipeline.go`: state/scene/action/route lowering
   - `lower_local.go`: `localLowerer` struct and all methods
   - `lower_prepare.go`: `prepareResolver` interface + two implementations

2. **Route action-ID cross-check**: After building `knownScenes`, also build a `knownActions` map (`sceneID → Set<actionID>`). Validate that `scene_id.action_id` patterns in route arms reference actions that actually exist in the named scene.

3. **Source-position map in emitted JSON**: Embed optional `_pos: { line, col }` annotations in the JSON model so TypeScript runtime errors can reference the original `.turn` source location.

4. **Explicit `StateManager.write` type checking**: Add an optional `typeMap: Record<string, string>` to `StateManager` (populated from the schema) and validate that `write(path, value)` matches the declared type. This would catch `merge` type mismatches at runtime rather than silently corrupting state.

5. **No versioned proto migration path**: The `version = 1` check in the TypeScript runner rejects all other values with no fallback. A reader-side version table or a `@deprecated` annotation strategy would allow forward evolution.

---

## 7. Improvement Points — Types / Interfaces

1. **Remove legacy `BindingRHS` variants** (`CondRHS`, `IfRHS`, `PipeRHS`). The v1 forms (`IfCallRHS`, `CaseCallRHS`, `PipeCallRHS`) subsume them. The legacy variants appear in the type hierarchy but are never produced by the v1 parser, creating dead branches in the lowerer's dispatch switch.

2. **`state.Schema` should use a newtype key** instead of plain `string`:
   ```go
   type StatePath string
   type Schema map[StatePath]FieldMeta
   ```
   This prevents passing raw strings where paths are expected and makes the dot-separated convention explicit in the type system.

3. **`MethodCallArg` should not implement `ast.Arg` directly** — it is a *pre-lowering* syntax form (like `LocalExpr`), not a *post-lowering* proto-level arg (like `RefArg`). The mismatch is noted in comments but not enforced by the type hierarchy. It should either live in its own interface or be lowered into `TransformArg` at parse time.

4. **`FuncArgMap` keys should be branded**: `type FuncArgMap = { [argName in string]: ValueId }` — `argName` is plain `string`. A `Brand<string, 'argName'>` would prevent accidental substitution of binding names for argument names.

5. **`ConditionId` union is partially redundant**: The `source: 'value' | 'func'` discriminant is manually maintained alongside `id: ValueId | FuncId`. Since `ValueId` and `FuncId` are branded strings (not runtime-distinct), a helper `isValueCondition(c: ConditionId): c is { source: 'value'; id: ValueId }` would remove the raw string comparison from call sites.

---

## 8. Improvement Points — Implementations

1. **Remove `detectBindingCycles`** (`validate.go:1455–1489`) — never called, duplicates the inlined Pass 1b logic.

2. **Extract pipe `#it` context into a struct**. The three fields `itRef string`, `itType ast.FieldType`, `itAllowed bool` in `localLowerer` are always saved/restored together. A `pipeContext struct` with a `save()/restore()` pair (or `defer`-based) would eliminate the risk of forgetting to restore one of them.

3. **`scopeWithPatternBindings` should use an overlay pattern** instead of the lazy-copy + closure approach. A simple two-level lookup `func lookup(name string) (bindingInfo, bool)` that checks the overlay first is cleaner and avoids allocating a full map copy for each arm.

4. **`chooseHeredocDelim` magic number 1000** (`emit.go:238`): The loop cap `n < 1000` is unexplained. Replace with a named constant `maxHeredocDelimAttempts = 1000` with a comment.

5. **`tokenKindNames` and `keywords` maps are maintained separately** (`parser.go:1616–1684`, `lexer.go:185–213`). A new keyword requires an update in both. Consider a single `keywordTable` that drives both the keyword lookup and the name table, or use `go generate` to derive one from the other.

6. **`lowerSingleRefRHS` duplicates the identity-function pattern** across 4 type cases. A `identityFnFor(ft ast.FieldType) (fn string, identityArg *turnoutpb.ArgModel)` helper would consolidate the logic used by both `lowerSingleRefRHS` and `localLowerer.emitIdentity`.

7. **`validateProg` Pass 1b comment is misleading**: The heading says "Pass 1b" but the code is structurally part of Pass 1's same block. Rename to a named sub-function `detectCycles(...)` to make the separation explicit and eliminate the dead `detectBindingCycles`.

---

## 9. Learning Paths

### Go compiler side — entry → goal

| Step | File | Focus |
|---|---|---|
| 1 | `cmd/turnout/main.go` | `compile()` pipeline: understand each phase and how diagnostics flow |
| 2 | `internal/lexer/lexer.go` | `Tokenize`, `scanToken`, `scanHeredoc`, sigil scanning |
| 3 | `internal/ast/ast.go` | Interface hierarchies (`BindingRHS`, `LocalExpr`, `Arg`) and why marker methods are used |
| 4 | `internal/parser/parser.go` | `parseRHS`, `parseLocalExpr`, `parseBindingDecl` — follow one binding from source to AST |
| 5 | `internal/lower/lower.go` | `lowerBinding` dispatch, then `localLowerer.lowerCaseInto` (the hardest part) |
| 6 | `internal/validate/validate.go` | `validateProg`, `validateActionEffects`, `validateExtExpr` |
| 7 | `internal/emit/emit.go` | `writeBinding`, `writeExtExpr`, `chooseHeredocDelim` |
| **Goal** | — | Add a new binary built-in (e.g. `arr_reverse`) end-to-end: lexer keyword → validator spec → runtime preset function |

### TypeScript runtime side — entry → goal

| Step | File | Focus |
|---|---|---|
| 1 | `packages/ts/scene-runner/src/executor/scene-executor.ts` | `createSceneExecutor` — the action-queue loop, `first-match` vs `all-match` policy |
| 2 | `packages/ts/scene-runner/src/state/state-manager.ts` | Immutable `StateManager`, `stateManagerFromSchema`, `literalToValue` |
| 3 | `packages/ts/scene-runner/src/executor/action-executor.ts` | `executeAction` — prepare → compute → merge → publish |
| 4 | `packages/ts/runtime/src/compute-graph/types.ts` | `ExecutionContext`, `FuncTableEntry`, branded IDs |
| 5 | `packages/ts/runtime/src/compute-graph/runtime/executeGraph.ts` | DAG traversal from a root `FuncId` |
| 6 | `packages/ts/scene-runner/src/executor/hcl-context-builder.ts` | How a proto `ProgModel` becomes an `ExecutionContext` |
| **Goal** | — | Trace a full action execution: `executeAction` → `buildContextFromProg` → `executeGraph` → state merge |

---

## Key Reliability Summary

| Concern | Severity | Location |
|---|---|---|
| Dead function `detectBindingCycles` | Low (confusion) | `validate.go:1455–1489` |
| Route pattern validation: action IDs not cross-checked | Medium | `validate.go:128–154` |
| `StateManager.write` does not enforce value types | Medium | `state-manager.ts` |
| `#case` reverse-lowering invariant undocumented | Medium | `lower.go:810` |
| `localLowerer` `#it` context save/restore fragility | Low | `lower.go:913–927` |
| `executeSceneSafe` loses partial state on non-SceneRuntimeError | Low | `scene-executor.ts:204–223` |
| Legacy `BindingRHS` variants never produced by v1 parser | Low (dead code) | `ast.go`, `lower.go` |

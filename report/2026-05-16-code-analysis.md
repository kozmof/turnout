# Turnout Codebase Analysis — 2026-05-16

## System Overview

**Turnout** is a custom DSL compiler + runtime for authoring interactive scenario/workflow graphs. The pipeline:

```
.turn source file
  └─ [Go Converter]
       lexer → parser → AST → lower → validate → emit (HCL or JSON)
                                                        │
                                               [Proto Schema]  ← single contract
                                                        │
                                           [TypeScript Scene Runner]
                                           loads JSON model, executes scenes
                                                        │
                                           [TypeScript Runtime]
                                           compute graph execution engine
```

Three distinct packages:
- `packages/go/converter/` — the Turn DSL compiler
- `packages/ts/runtime/` — the compute graph engine
- `packages/ts/scene-runner/` — the JSON model executor
- `apps/vscode/turn-language/` — syntax highlighting

---

## 1. Code Organization and Structure

### Go Converter

| Package | Role |
|---|---|
| `lexer/` | Hand-written scanner; snapshot/restore for backtracking |
| `parser/` | Recursive-descent parser; one function per grammar production |
| `ast/` | All AST node types, organized by marker interfaces |
| `lower/` | AST → proto model; `localLowerer` handles `#if/#case/#pipe` |
| `validate/` | Full type-checking against proto model |
| `emit/` | HCL text generation + JSON marshal |
| `state/` | State schema resolution (`state_file` directive) |
| `overview/` | Overview flow DSL parsing and enforcement |
| `diag/` | Diagnostics accumulator with 100-error cap + halt |
| `cmd/turnout/` | CLI: `turnout convert`, `turnout validate` |

### TypeScript

| Package | Role |
|---|---|
| `runtime/src/compute-graph/builder/` | Fluent API for building `ExecutionContext` |
| `runtime/src/compute-graph/runtime/` | `buildExecutionTree`, `executeTree`, `executeGraph` |
| `runtime/src/state-control/` | `AnyValue` types, preset binary/transform functions |
| `scene-runner/src/executor/` | `executeAction`, `createSceneExecutor`, `hcl-context-builder` |
| `scene-runner/src/state/` | Immutable `StateManager` |
| `scene-runner/src/server/` | Node.js bridge (spawns Go binary subprocess) |

---

## 2. Relations — Types and Interfaces

### Go AST Interface Hierarchy

```
ast.BindingRHS
  ├── LiteralRHS         name:type = 42
  ├── PlaceholderRHS     name:type = _          (legacy form)
  ├── SigilInputRHS      ~>name:type            (v1 sigil, no RHS)
  ├── SingleRefRHS       name:type = other
  ├── FuncCallRHS        name:type = fn(a, b)
  ├── InfixRHS           name:type = a + b
  ├── PipeRHS            (old #pipe block form)
  ├── CondRHS            (old cond block form)
  ├── IfRHS              (old #if block form)
  ├── IfCallRHS          name:type = #if(c, t, e)   ← v1 current form
  ├── CaseCallRHS        name:type = #case(...)      ← v1 current form
  └── PipeCallRHS        name:type = #pipe(...)      ← v1 current form

ast.LocalExpr            (pre-lowering, used inside #if/#case/#pipe)
  ├── LocalRefExpr, LocalLitExpr, LocalItExpr (#it)
  ├── LocalCallExpr, LocalInfixExpr
  ├── LocalIfExpr, LocalCaseExpr, LocalPipeExpr

ast.Arg                  (post-lowering, proto-level, used in CombineExpr/PipeExpr)
  ├── RefArg, LitArg, FuncRefArg, StepRefArg, TransformArg, MethodCallArg

ast.StateSource           → InlineStateBlock | StateFileDirective
ast.ActionPrepareSource   → FromState | FromHook
ast.NextPrepareSource     → FromAction | FromState | FromLiteral
ast.Literal               → NumberLiteral | StringLiteral | BoolLiteral | ArrayLiteral
ast.LocalCasePattern      → WildcardCasePattern | LiteralCasePattern | VarBinderPattern | TupleCasePattern

lower.prepareResolver     → actionPrepareResolver | transitionPrepareResolver
```

### Proto Schema (Go ↔ TypeScript contract)

```
TurnModel
  ├── StateModel → NamespaceModel[] → FieldModel[]
  ├── SceneBlock[] → ActionModel[]
  │     ActionModel → ComputeModel → ProgModel → BindingModel[]
  │     BindingModel.Expr → CombineExpr | PipeExpr | CondExpr
  │     BindingModel.ExtExpr → LocalExprModel (HCL re-emission only, ignored by runtime)
  ├── RouteModel[] → MatchArm[]
  └── SigilAnnotations (cleared before JSON emission)
```

### TypeScript Interface Hierarchy

```
StateManager (interface)
  read(path) → AnyValue | undefined
  write(path, value) → StateManager      ← immutable; returns new instance
  snapshot() → Readonly<Record<string, AnyValue>>

ExecutionContext
  valueTable, funcTable
  combineFuncDefTable, pipeFuncDefTable, condFuncDefTable

FunctionBuilder = CombineBuilder | PipeBuilder | CondBuilder
```

---

## 3. Relations — Functions

### Go Converter Pipeline

```
main() → compile(inputPath)
  parser.ParseFile()
    lexer.Tokenize() → []Token
    p.parseFile() → *ast.TurnFile
  state.Resolve() → state.Schema
  lower.Lower(turnFile, schema) → *LowerResult
    lowerStateBlock()
    lowerSceneBlock() → lowerAction()
      newActionPrepareResolver()
      lowerProgInner() → lowerBinding() (per BindingDecl)
        lowerLocalRHS() → newLocalLowerer().lowerTop()
          lowerIfInto() / lowerCaseInto() / lowerPipeInto()
      lowerNextRule()
    lowerRouteBlocks()
  validate.Validate(model, schema)
emit.EmitJSON() / emit.Emit()
```

### TypeScript Scene Runner

```
loadJsonModel() (spawns Go binary)
stateManagerFromSchema(stateModel) → StateManager

createSceneExecutor(scene, state, hooks)
  next() → executeAction(action, state, hooks)
    resolveActionPrepare()   → injected binding values
    buildContextFromProg()   → ExecutionContext + nameToValueId map
    assertValidContext()     → ValidatedContext
    for each binding:
      executeTree(buildExecutionTree(funcId, ctx), ctx)
    apply merge → new StateManager
    invoke publish hooks
  evaluateNextRules(action, state, result, policy)
    buildContextFromProg() per next rule (independent, not cached)
    executeGraph(condFuncId, validatedCtx)
    isPureBoolean(condValue)
```

---

## 4. Specific Contexts and Usages

- **`_` placeholder**: In binding RHS, delegates the initial value to STATE via a `prepare` entry. The `prepareResolver` looks up the matching entry and returns the schema default value.
- **Sigils (`~>`, `<~`, `<~>`)**: Captured in `Sidecar` during lowering, packed into `TurnModel.Annotations` (map key: `"sceneID:actionID:scope:progName:bindingName"`), read by the validator, and **cleared before JSON emission** (`result.lr.Model.Annotations = nil`).
- **`#pipe`/`#if`/`#case` lowering**: `localLowerer` flattens nested expressions into a sequence of `BindingModel` with synthetic names (`__local_target_hint_N`, `__if_name_cond`). Bindings are topologically ordered: dependencies always precede uses.
- **`ext_expr`**: Preserved alongside flat bindings so the HCL emitter can reproduce the original `#if`/`#case`/`#pipe` form. Ignored entirely by the TypeScript runtime.
- **`stateManagerFromStrict`**: Validates write paths at call time. Used in tests to surface typo'd state paths as immediate errors rather than silent no-ops.

---

## 5. Pitfalls — Resolved 2026-05-16

### P1 — `TupleCasePattern` silently produces `false` — **Resolved**

`packages/go/converter/internal/lower/lower.go` now emits `CodeUnsupportedConstruct` if a tuple `#case` pattern reaches lowering. It still emits a structural `false` fallback after the diagnostic so later lowering does not panic on a malformed graph.

### P2 — `lowerBiDirInputRHS` swallows errors intentionally — **Resolved**

`prepareResolver.resolveDefault` now accepts the missing-prepare diagnostic code to emit. `<~>` missing prepare is reported as `CodeBidirMissingPrepareEntry`, while other resolver failures such as `CodeUnresolvedStatePath` are reported through the normal diagnostics path instead of being discarded.

### P3 — `executeSceneSafe` `failedActionId` is stale on certain failures — **Resolved**

`SceneExecutor` now exposes `currentActionId()`. `executeSceneSafe` uses it when catching `SceneRuntimeError`, so failures thrown before trace emission report the action currently being attempted rather than the last completed action.

### P4 — Named args silently stripped — **Resolved**

`parseFuncArgs` and `parseLocalArgList` now reject named arguments with `CodeNamedArgIgnored` as an error. Parsing continues through the value for recovery, but DSL calls are strictly positional.

### P5 — `parseRefVal` accepts keywords as bare identifiers in dotted paths — **Resolved**

`parseRefVal` now requires identifiers or quoted strings for references, and dotted path segments must be identifiers. Keyword-like paths must be quoted, e.g. `to_state = "story.route"`.

### P6 — `protoValueToJs` uses duck-typing for proto detection — **Resolved**

`protoValueToJs` now uses a narrow protobuf `Value` guard based on the generated message shape before calling `toJson(ValueSchema, ...)`. Plain objects with a `kind` property are returned unchanged.

### P7 — `lowerStateBlockFromAST` sorts fields alphabetically — **Resolved**

Inline state lowering now preserves author declaration order for namespaces and fields. `state_file` / schema-derived state still sorts namespaces and fields alphabetically because source order is unavailable there.

### P8 — `Object.assign` mutation with `executeTree` in action executor — **Resolved**

`executeAction` now creates a binding-local execution context and uses an explicit `mergeValueTable` helper to accumulate computed values. The cumulative cross-binding behavior is unchanged, but the mutation is intentional and covered by regression tests.

### Verification

- `go test ./...` from `packages/go/converter` passes.
- `pnpm test` from `packages/ts/scene-runner` passes: 15 test files, 211 tests.

---

## 6. Improvement Points — Design Overview

**1. Go binary as subprocess dependency**
The scene-runner's `server/bridge.ts` spawns the Go binary to convert `.turn` files. This requires Go to be installed alongside the TypeScript consumer. A WASM port of the converter would eliminate this requirement.

**2. Two parallel expression trees — Resolved incrementally**
A full IR rewrite was avoided. Instead, `packages/go/converter/internal/localexpr/` now provides shared proto-local-expression traversal helpers. Validation uses this shared traversal for `LocalExprModel` reference collection, reducing duplicated recursive switch logic while keeping the existing `ast.LocalExpr`, `ast.Arg`, `LocalExprModel`, and `ArgModel` public shapes unchanged.

**3. Sigil annotation key encoding — Resolved with compatibility path**
`schema/turnout-model.proto` now includes structured `SigilAnnotation` entries with explicit `scene_id`, `action_id`, `scope`, `prog_name`, `binding_name`, and `sigil` fields. `lower.Sidecar` emits structured entries, and validation reads structured entries first while retaining fallback support for the legacy string-keyed `sigils` map.

**4. `DEFAULT_MAX_STEPS` is not per-route configurable — Resolved**
Route execution now accepts `maxSceneSteps` and `maxRouteTransitions` options. These flow through `executeRoute`, `runHarness`, and `createRunner`, while preserving the previous defaults: 10,000 action steps per scene and 1,000 route transitions.

**5. Compiler error recovery is coarse — Improved**
The parser now has scoped recovery helpers (`syncToBlockItem`, `atAny`) and uses them in key scene/action/compute/prepare/merge/next parsing paths. Malformed block items skip their own nested bodies and continue to sibling items, surfacing more diagnostics in a single parse pass.

### Verification

- `buf generate` was run via the local Buf binary and regenerated Go/TypeScript protobuf types.
- `go test ./...` from `packages/go/converter` passes.
- `pnpm test` from `packages/ts/scene-runner` passes: 16 test files, 215 tests.
- `pnpm run typecheck` from repo root passes.

---

## 7. Improvement Points — Types and Interfaces

**1. Fat `BindingRHS` interface with legacy/v1 split**
There are 11 implementors. The split between old block forms (`CondRHS`, `IfRHS`, `PipeRHS`) and v1 function-call forms (`IfCallRHS`, `CaseCallRHS`, `PipeCallRHS`) is a historical seam. If the old forms are no longer emitted by the parser, they can be removed to reduce the lowering switch surface.

**2. `StateManager.read` returns `undefined` silently**
`write` validates paths against `validPaths` in strict mode. `read` does not — an unknown path returns `undefined` without error. Symmetric strict-mode validation on `read` would catch more bugs earlier.

**3. `HookRegistry` value type is `unknown`**
`packages/ts/scene-runner/src/executor/action-executor.ts:107` uses `eslint-disable @typescript-eslint/no-unsafe-type-assertion` when casting hooks. Fully typing `HookRegistry` would eliminate this.

**4. `TurnModel.version` validation**
The proto specifies the TypeScript runner validates `version == 1`, but this check is not visible in the executor source. If absent or weak, future schema changes could be consumed silently.

---

## 8. Improvement Points — Implementations

**1. `lowerSingleRefRHS` uses identity-function wrapping**
`packages/go/converter/internal/lower/lower.go:489-514` — `name:number = other` emits `add(other, 0)`. This wastes a runtime computation slot. A direct value alias (if supported by the runtime) would be cheaper.

**2. `lowerCaseInto` with only wildcard arm emits an extra identity binding**
`packages/go/converter/internal/lower/lower.go:878-880` — When no conditional arms exist (only `_`), `emitIdentity(name, ft, nextFn)` creates a binding that aliases the wildcard function. The wildcard function could be assigned directly to `name` instead.

**3. `lowerMethodCallArg` reports only the first unknown method**
`packages/go/converter/internal/lower/lower.go:1211-1218` — If multiple methods in a chain are unknown, only the first is reported; the function returns early. Collecting all errors would give a more complete diagnostic.

**4. Action executor trusts topological order without runtime verification**
`packages/ts/scene-runner/src/executor/action-executor.ts:63-79` — Bindings are executed in declaration order, trusting the Go converter. A malformed JSON model could trigger the `OutOfOrderBinding` error but not a more descriptive cycle detection. An explicit cycle check on load would make the runtime more robust against hand-crafted or corrupted models.

**5. `inferLocalType` falls back silently for unknown function aliases**
`packages/go/converter/internal/lower/lower.go:1094-1096` — Unknown function aliases return the declared binding type rather than emitting an error. The validator catches this later via `CodeUnknownFnAlias`, but the silent fallback in the lowerer can produce misleading intermediate type assignments for nested expressions.

---

## 9. Learning Paths

### Entry Points

| Starting point | File |
|---|---|
| Go CLI | `packages/go/converter/cmd/turnout/main.go` → `compile()` |
| TypeScript scene runner | `packages/ts/scene-runner/src/executor/scene-executor.ts` → `executeScene()` |
| TypeScript runtime | `packages/ts/runtime/src/compute-graph/runtime/exec/executeGraph.ts` |

### Recommended Reading Order

1. **Spec files** (`spec/`) — understand the DSL semantics before the implementation
2. **`ast/ast.go`** — all node types; the foundation for everything else
3. **`lexer/lexer.go`** — simple but complete; snapshot/restore is the key mechanism
4. **`parser/parser.go`** — one function per grammar rule; `parseRHS` and `parseLocalExpr` are the most complex
5. **`lower/lower.go`** — the system's core complexity; start with `lowerBinding` then trace into `localLowerer`
6. **`validate/validate.go`** — the `builtinFns` table and sigil checks are the most instructive parts
7. **`emit/emit.go`** and `emit/json.go` — relatively mechanical once the model is understood
8. **`state-manager.ts`** — immutability model for state
9. **`hcl-context-builder.ts`** — the bridge between proto model and runtime `ExecutionContext`
10. **`action-executor.ts`** and **`scene-executor.ts`** — the full runtime execution loop

### Key Invariants to Internalize

- Bindings in a `ProgModel` are **topologically sorted**: every binding's dependencies appear before it in the list
- `ext_expr` is **validator/emitter metadata only** — the runtime ignores it entirely
- `TurnModel.Annotations` (sigils) is **cleared before JSON emission** — it never reaches the TypeScript runtime
- `StateManager` is **fully immutable** — every `write` returns a new instance
- `DiagSink` has a **100-error hard cap** with halt-on-exceed semantics; recovery is "skip to end of input"
- Named args in function calls are **silently normalized to positional** with a warning only

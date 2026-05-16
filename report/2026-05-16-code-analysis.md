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

## 5. Pitfalls

### P1 — `TupleCasePattern` silently produces `false`

`packages/go/converter/internal/lower/lower.go:905-909` — `TupleCasePattern` in `lowerCasePatternCond` emits a `false` literal. The comment says validation rejects it first, but there is no guard: if validation is bypassed or a bug allows it through, the case arm silently never matches.

### P2 — `lowerBiDirInputRHS` swallows errors intentionally

`packages/go/converter/internal/lower/lower.go:483-487` — Resolving `<~>` default discards errors into `noDiags` so the validator can emit a bidir-specific error code instead. If the validator check for `CodeBidirMissingPrepareEntry` is ever missed or misordered, errors disappear silently.

### P3 — `executeSceneSafe` `failedActionId` is stale on certain failures

`packages/ts/scene-runner/src/executor/scene-executor.ts:196-213` — `lastActionId` captures the *last traced action*, not the failing one. For errors thrown *during* an action (before `trace` is emitted), `failedActionId` points to the previous action.

### P4 — Named args silently stripped

`packages/go/converter/internal/parser/parser.go:447-452` — Named args (`name: value`) emit a warning and are normalized to positional. Authors may write `fn(a: x, b: y)` thinking they have named-parameter semantics, but order is what matters.

### P5 — `parseRefVal` accepts keywords as bare identifiers in dotted paths

`packages/go/converter/internal/parser/parser.go:186-207` — Keywords (`state`, `route`, etc.) are allowed in dotted paths. This is a defensive workaround but can mask real syntax errors if a keyword appears where an identifier is expected.

### P6 — `protoValueToJs` uses duck-typing for proto detection

`packages/ts/scene-runner/src/state/state-manager.ts:110-118` — Detection by `'kind' in v` is fragile. Any plain object with a `kind` property would be misidentified as a proto Value.

### P7 — `lowerStateBlockFromAST` sorts fields alphabetically

`packages/go/converter/internal/lower/lower.go:151-184` — Namespace and field order in emitted output always follows alphabetical sort, regardless of source declaration order. This is deterministic but can confuse authors expecting output order to match source order.

### P8 — `Object.assign` mutation with `executeTree` in action executor

`packages/ts/scene-runner/src/executor/action-executor.ts:60-69` — `updatedTable` is mutated in-place, then passed via `{ ...validatedCtx, valueTable: updatedTable }`. Since the spread creates a new object but keeps the same reference for `valueTable`, if `executeTree` internally spreads the context again, the shared mutable reference means cross-binding state is cumulative — correct here, but subtle.

---

## 6. Improvement Points — Design Overview

**1. Go binary as subprocess dependency**
The scene-runner's `server/bridge.ts` spawns the Go binary to convert `.turn` files. This requires Go to be installed alongside the TypeScript consumer. A WASM port of the converter would eliminate this requirement.

**2. Two parallel expression trees**
The system maintains `LocalExpr` (pre-lowering, AST-level) and `Arg` (post-lowering, proto-level), both with literal/ref/call variants. Both are also mapped to proto messages (`LocalExprModel`, `ArgModel`). A single IR serving both roles could reduce the total type surface.

**3. Sigil annotation key encoding**
The key `"sceneID:actionID:scope:progName:bindingName"` in `SigilAnnotations` is an implicit string encoding. A proto message with explicit fields would be safer and self-documenting.

**4. `DEFAULT_MAX_STEPS` is not per-route configurable**
The 10,000-step ceiling in `createSceneExecutor` is a global constant. Complex scene graphs with legitimately long chains cannot raise this per-route; it must be passed as a parameter to every `executeScene()` call.

**5. Compiler error recovery is coarse**
On parse error, recovery uses `skipTo(TokRBrace)` or `skipBlock()`. This means one malformed block may suppress errors in adjacent sibling blocks. A more granular recovery strategy (e.g., re-sync at the next `action` or `scene` keyword) would surface more errors per compilation pass.

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

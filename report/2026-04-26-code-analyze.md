# Code Analysis — Turn DSL Compiler + Runtime

**Date:** 2026-04-26

---

## 1. Code Organization and Structure

The project is a monorepo with three distinct subsystems:

**Go Converter** (`packages/go/converter/`) — a classic compiler pipeline:
```
lexer/ → parser/ → ast/ → lower/ → validate/ → emit/
```
Each package has a single, clearly-stated responsibility. The `diag` package provides a uniform error-code system sourced from spec documents. The `state` package owns schema resolution (inline state blocks or external state files). Entry point: `packages/go/converter/cmd/turnout/main.go`.

**TypeScript Runtime** (`packages/ts/runtime/`) — a purely functional compute-graph engine:
- `compute-graph/builder/` — spec-to-context construction (`ctx`, `combine`, `pipe`, `cond`)
- `compute-graph/runtime/` — tree-based execution (`executeTree`, `executeGraph`)
- `state-control/` — typed value primitives (`AnyValue`) and preset binary/transform functions

**TypeScript Scene Runner** (`packages/ts/scene-runner/`) — the application layer:
- `executor/` — action execution, state threading, next-rule evaluation
- `state/` — immutable `StateManager` (flat `namespace.field` keyed)
- `server/` — harness integration bridge

**Schema** (`schema/turnout-model.proto`) — the canonical proto IR shared between Go emitter and TS runner.

---

## 2. Relations of Implementations (Types/Interfaces)

### Go AST type hierarchy

| Interface | Variants |
|-----------|----------|
| `BindingRHS` | `LiteralRHS`, `SigilInputRHS`, `SingleRefRHS`, `FuncCallRHS`, `InfixRHS`, `IfCallRHS`, `CaseCallRHS`, `PipeCallRHS` (v1) |
| `Arg` | `RefArg`, `LitArg`, `FuncRefArg`, `StepRefArg`, `TransformArg`, `MethodCallArg` |
| `LocalExpr` | `LocalRefExpr`, `LocalLitExpr`, `LocalItExpr`, `LocalCallExpr`, `LocalInfixExpr`, `LocalIfExpr`, `LocalCaseExpr`, `LocalPipeExpr` |
| `LocalCasePattern` | `WildcardCasePattern`, `LiteralCasePattern`, `VarBinderPattern`, `TupleCasePattern` |
| `ActionPrepareSource` | `FromState`, `FromHook` (action-level prepare only) |
| `NextPrepareSource` | `FromAction`, `FromState`, `FromLiteral` (transition-level) |
| `StateSource` | `InlineStateBlock`, `StateFileDirective` |

Notable: `FromState` implements both `ActionPrepareSource` and `NextPrepareSource`. `FromLiteral` is forbidden in action-level prepare by the type system (it only implements `NextPrepareSource`); the parser emits an error if `from_literal` appears in an action `prepare` block.

### TypeScript types

| Type | Role |
|------|------|
| `ExecutionContext` | Immutable readonly struct holding all runtime tables |
| `FuncTableEntry` | Discriminated union `'combine' \| 'pipe' \| 'cond'` |
| `PipeArgBinding` | Discriminated union `'input' \| 'step' \| 'value'` |
| `AnyValue` | Tagged union for runtime values |
| `StateManager` | Functional interface: `read/write/snapshot` |

---

## 3. Relations of Implementations (Functions)

**Go pipeline:**
```
main.go: ParseFile → state.Resolve → lower.Lower → validate.Validate → emit.Emit/EmitJSON
```

**Lowering flow for a binding:**
```
lowerBinding (lower.go:355)
  ├── lowerLiteralRHS / lowerSingleRefRHS / lowerFuncCallRHS / lowerInfixRHS
  └── (IfCallRHS | CaseCallRHS | PipeCallRHS) → localLowerer.lowerTop
       ├── lowerIfInto    → lowerExprTemp (cond, then, else) → appendBinding
       ├── lowerCaseInto  → right-to-left fold of nested CondExpr bindings
       └── lowerPipeInto  → thread currentRef through steps, with #it = prev step
```

**TypeScript execution:**
```
buildContextFromProg → buildSpec → ctx()
                                        ↓
executeGraph(funcId, assertValidContext(exec))
  → buildExecutionTree → executeTree
       ├── value node     → return leaf
       ├── conditional    → executeTree(cond) → executeTree(branch) → executeCondFunc
       └── function node  → executeTree(children) → executeCombineFunc / executePipeFunc
```

---

## 4. Specific Contexts and Usages

**Sidecar pattern:** The `lower.Sidecar` (`lower/sidecar.go`) is a metadata bag that cannot live in the proto IR:
- `Sigils` — binding direction indicators (`~>`, `<~`, `<~>`) consumed only by the validator
- `Scenes` / `Actions` — view metadata and docstrings (HCL-only)

The sidecar no longer carries `ExtExprs`. Structured `#if`/`#case`/`#pipe` expressions are now stored directly in `BindingModel.ext_expr` (`LocalExprModel`) in the proto IR and read by the emitter from there.

**`route` / `match` as hard keywords:** Both are now `TokKwRoute` / `TokKwMatch` in the lexer keyword map and the parser's `isKeyword` switch. Path expressions (dotted paths like `story.route`) accept keyword tokens as field-name segments via the `isKeyword(seg.Kind)` fallback in `parseRefVal`.

**`#case` lowering as a right-to-left fold:** `lowerCaseInto` (lower.go:729–766) builds nested `CondExpr` bindings from the last arm inward. The binding for the user's declared name is emitted last (when `i == 0`), so the output order is bottom-up.

---

## 5. Pitfalls

**P1 — Duplicate `literalFieldType` with divergent behavior: ✅ resolved**
The canonical implementation was moved to `ast.LiteralFieldType(ast.Literal) (ast.FieldType, bool)` in `ast/ast.go`. Both private copies were deleted; all call sites in `lower.go` and `validate.go` now call `ast.LiteralFieldType`. The lowerer's two bugs (empty array returning `true`, only checking the first element of multi-element arrays) are eliminated by the canonical implementation.

**P2 — `methodTypeToFieldType` loses array element type: ✅ resolved**
`fieldTypeToMethodType` now emits `"arr<number>"`, `"arr<str>"`, `"arr<bool>"` for the three array types instead of collapsing them all to `"array"`. `methodTypeToFieldType` has matching cases for each, making the pair a lossless round-trip. `inferLocalType` now correctly recovers the full array element type from `bindingTypes`.

**P3 — `FN_MAP` in `hcl-context-builder.ts` is missing `arr_get` and `arr_includes`: ✅ resolved**
`arr_get: 'binaryFnArray::get'` and `arr_includes: 'binaryFnArray::includes'` were added to the `FN_MAP` in `hcl-context-builder.ts`.

**P4 — `isKeyword` uses an implicit range: ✅ resolved**
`isKeyword` was rewritten as an explicit switch over all 26 keyword token kinds, including the newly-promoted `TokKwRoute` and `TokKwMatch`. Adding a new keyword now requires an explicit case rather than a silent no-op if it falls outside a magic range.

**P5 — `stateManagerFrom` vs `stateManagerFromSchema` validation asymmetry:**
`stateManagerFrom` intentionally uses `null` for `validPaths` (no path validation). The scene-executor and tests pass `StateManager.from({})` with an empty initial state and write merge outputs to arbitrary paths at runtime; strict validation would break these callers. The asymmetry is by design: `stateManagerFromSchema` is the production entry point with strict validation; `stateManagerFrom` is a permissive form for partial/ad-hoc states.

**P6 — No negative number literal support: ✅ resolved**
`parseLiteral` now handles `TokMinus` followed by `TokNumberLit`, returning a `*ast.NumberLiteral` with a negated value. `TokMinus` was also added to the literal dispatch cases in `parseRHS`, `parseLocalExpr`, and `parseCasePattern`.

---

## 6. Improvement Points 1 (Design Overview)

**D1 — Dual representation for extended expressions: ✅ resolved**
`#if`/`#case`/`#pipe` expressions are now stored once in the proto IR as `BindingModel.ext_expr` (`LocalExprModel`). The flat `ExprModel` bindings remain for runtime execution; the emitter reads `ext_expr` for HCL re-emission. `Sidecar.ExtExprs` and the `extExprFor` validator function were removed. The `LocalExprModel` message family was added to `schema/turnout-model.proto` and regenerated.

**D2 — Sidecar as an accumulating bolt-on: ✅ resolved**
`lower.Lower()` now returns `(*LowerResult, diag.Diagnostics)` where `LowerResult` bundles `Model *turnoutpb.TurnModel` and `Sidecar *Sidecar`. All callers in `main.go` and test helpers have been updated to use `lr.Model` / `lr.Sidecar`.

**D3 — `route`/`match` as value-checked idents: ✅ resolved**
Both are now hard keyword tokens (`TokKwRoute`, `TokKwMatch`). `parseFile` dispatches on `lexer.TokKwRoute` and `parseRouteBlock` checks for `lexer.TokKwMatch`.

**D4 — CLI has only one command:**
`main.go` has a `switch` on `os.Args[1]` with only `"convert"`. The scaffolding is ready for more commands, but `printUsage` hard-codes only one. A `cobra`/`kingpin` library would be cleaner if the CLI grows.

---

## 7. Improvement Points 2 (Types/Interfaces)

**T1 — `Arg` and `LocalExpr` are parallel hierarchies: ✅ resolved**
A doc comment block was added before `LocalExpr` in `ast.go` explaining the boundary: `Arg` feeds the lowerer (proto-level, flattened); `LocalExpr` is the v1 expression tree (pre-lowering, recursive). The asymmetry is intentional and now documented.

**T2 — `PrepareSource`/`NextPrepareSource` split not enforced by types: ✅ resolved**
`PrepareSource` was renamed to `ActionPrepareSource` (implemented only by `*FromState` and `*FromHook`). `*FromLiteral` no longer satisfies `ActionPrepareSource`, so passing it in action-level prepare is a compile-time error. The parser now emits a parse error if `from_literal` appears in an action `prepare` block.

**T3 — `FuncTableEntry.argMap` asymmetry in TypeScript: ✅ resolved**
`combine` and `pipe` carry `argMap` because their inputs are live value-table references resolved during execution; `cond` does not because its inputs are pre-resolved into `condFuncDefTable` at build time and `executeCondFunc` receives the selected value as a parameter. A `FuncArgMap` named type, an `ArgMapFuncEntry` union alias, and a `hasArgMap(entry)` predicate were added to `types.ts`. The `kind === 'cond'` guard in `executePipeFunc` was replaced with `!hasArgMap(funcEntry)`. Note: `combine` and `pipe` are now DSL-internal (only called from `hcl-context-builder.ts`); the asymmetry is a pure implementation detail with no external API surface.

**T4 — Branded type leakage in `hcl-context-builder.ts`: ✅ resolved**
Typed assertion helpers (`asFuncId`, `asValueId`, `asBinaryFnName`, `asCombineArg`) were added in `hcl-context-builder.ts`. All scattered `as FuncId` / `as ValueId` casts were replaced with helper calls, and the unsafe-cast reasoning is consolidated in a single header comment block.

---

## 8. Improvement Points 3 (Implementations)

**I1 — `validateCombineArgTypes` / `validateLocalCallArgTypes` near-duplication: ✅ resolved**
`validateBinaryArgTypePair(bindingName, fn string, spec fnSpec, t1 ast.FieldType, ok1 bool, t2 ast.FieldType, ok2 bool, ds *diag.Diagnostics)` was extracted as a shared helper. Both `validateLocalCallArgTypes` and `validateCombineArgTypes` now delegate to it; the duplicate flag-dispatch switch is gone.

**I2 — `sigilFor` double key-lookup: ✅ resolved**
The dual-registration block in `lowerBinding` was removed. `sigilFor` now performs a single lookup with the caller's scope. All sidecar construction in tests was updated to include the correct `Scope` field (`"compute"` for action prog bindings, `"next:N"` for transition prog bindings).

**I3 — `localFnReturnType` is incomplete relative to `builtinFns`: ✅ resolved**
`arr_get` was absent from `localFnReturnType` and fell through to `default: FieldTypeNumber`, mislabeling its temp binding when used on `arr<str>` or `arr<bool>`. It was added to the `"arr_concat", "arr_get"` case that returns `fallback`, carrying the declared binding type forward (same approach as `arr_concat`, since the element type is not inferable from the function name alone).

**I4 — `lowerCaseInto` emits bindings in non-intuitive order: ✅ resolved**
A doc comment was added to `lowerCaseInto` explaining that the right-to-left fold is required for topological ordering: each `cond` expression must be emitted before the binding that references it.

**I5 — `buildSpec` empty-array type gap: ✅ resolved**
`buildSpec` in `hcl-context-builder.ts` now throws `"inline array arg must not be empty"` instead of silently returning `buildArray([])` for empty array inline args. This surfaces the type-gap as an error at build time rather than a silent mismatch at runtime.

---

## 9. Learning Paths (Entries and Goals)

Recommended reading order to understand the full system:

| Step | File | Goal |
|------|------|-------|
| 1 | `packages/go/converter/cmd/turnout/main.go` | CLI and full pipeline orchestration |
| 2 | `packages/go/converter/internal/lexer/lexer.go` | Token kinds, sigil scanning, heredoc |
| 3 | `packages/go/converter/internal/ast/ast.go` | All interface hierarchies — read alongside step 4 |
| 4 | `packages/go/converter/internal/parser/parser.go` | `parseBindingDecl`, `parseRHS`, `parseLocalExpr` |
| 5 | `packages/go/converter/internal/lower/sidecar.go` | What the sidecar still carries (sigils, view/action metadata) |
| 6 | `packages/go/converter/internal/lower/lower.go` | `lowerBinding`, `localLowerer`, `bindingRHSToProto` — the most complex part |
| 7 | `packages/go/converter/internal/validate/validate.go` | `validateProg`, `validateActionEffects`, `validateExtExpr`, `protoLocalExprToAST` |
| 8 | `packages/go/converter/internal/emit/emit.go` | `writeBinding`, `writeExtExpr`, `localExprInline` (all proto-based) |
| 9 | `schema/turnout-model.proto` | The canonical IR between Go and TS; includes `LocalExprModel` for structured expressions |
| 10 | `packages/ts/runtime/src/compute-graph/types.ts` | `ExecutionContext`, `FuncTableEntry`, `PipeArgBinding` |
| 11 | `packages/ts/runtime/src/compute-graph/runtime/executeTree.ts` | Recursive tree execution |
| 12 | `packages/ts/scene-runner/src/executor/hcl-context-builder.ts` | Proto model → runtime context bridge |
| 13 | `packages/ts/scene-runner/src/state/state-manager.ts` | Immutable `StateManager` |
| 14 | `packages/ts/scene-runner/src/executor/scene-executor.ts` | Action queue, next-rule evaluation, `createSceneExecutor` |

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
| `PrepareSource` | `FromState`, `FromHook`, `FromLiteral` (action-level) |
| `NextPrepareSource` | `FromAction`, `FromState`, `FromLiteral` (transition-level) |
| `StateSource` | `InlineStateBlock`, `StateFileDirective` |

Notable: `FromState` and `FromLiteral` implement *both* `PrepareSource` and `NextPrepareSource`. The constraint that `FromLiteral` is forbidden at the action level is expressed in the validator, not the type system.

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
- `ExtExprs` — full AST of `#if`/`#case`/`#pipe` kept for HCL re-emission (not used by the TS runtime, which reads the already-flattened proto bindings)
- `Scenes` / `Actions` — view metadata and docstrings (HCL-only)

**BindingKey dual-scope registration:** When `scope == "compute"`, `lowerBinding` (lower.go:386–412) registers the same entry at both `{scope="compute", ...}` and `{scope="", ...}` in `sc.Sigils` and `sc.ExtExprs`. This is a workaround that allows the validator's `sigilFor`/`extExprFor` to find entries regardless of which scope string the caller passes.

**`route` / `match` as soft keywords:** These are parsed as `TokIdent` with value-checked strings (parser.go:1510–1519), not hard keywords. This avoids reserving them as identifiers globally but makes the parser fragile to value-based branching.

**`#case` lowering as a right-to-left fold:** `lowerCaseInto` (lower.go:729–766) builds nested `CondExpr` bindings from the last arm inward. The binding for the user's declared name is emitted last (when `i == 0`), so the output order is bottom-up.

---

## 5. Pitfalls

**P1 — Duplicate `literalFieldType` with divergent behavior:**
Both `lower.go:874` and `validate.go:775` define `literalFieldType(ast.Literal)`. They differ on empty arrays: the lowerer returns `(FieldTypeArrNumber, true)` while the validator returns `(FieldTypeArrNumber, false)`. This inconsistency means an empty array literal passes validation but may be treated differently during lowering.

**P2 — `methodTypeToFieldType` loses array element type:**
`lower.go:904–917` maps `"array"` → `FieldTypeArrNumber` regardless of the actual element type. This means `inferLocalType` can mislabel an `arr<str>` or `arr<bool>` binding as `arr<number>`.

**P3 — `FN_MAP` in `hcl-context-builder.ts` is missing `arr_get` and `arr_includes`:**
The Go validator accepts both functions (validate.go:65–66), but `hcl-context-builder.ts:22–51` has no mapping for them. A `.turn` file using either would pass Go validation but throw at runtime.

**P4 — `isKeyword` uses an implicit range:**
`parser.go:218–220` checks `k >= TokKwState && k <= TokKwText`. If a new keyword token is added *outside* that range, `isKeyword` silently returns false, breaking path-expression parsing for keyword-named scene IDs.

**P5 — `stateManagerFrom` vs `stateManagerFromSchema` validation asymmetry:**
`stateManagerFrom` uses `null` for `validPaths` (no path validation on `write`), while `stateManagerFromSchema` validates strictly. Tests that use the ad-hoc form won't catch invalid write paths that would throw in production.

**P6 — No negative number literal support:**
The lexer's `scanNumber` (lexer.go:643–656) only recognizes non-negative numbers. Negative literals must be expressed as infix (e.g., `0 - 1`) or cannot be state defaults.

---

## 6. Improvement Points 1 (Design Overview)

**D1 — Dual representation for extended expressions:**
`#if`/`#case`/`#pipe` expressions exist in two forms simultaneously: flattened into proto bindings (for execution) and kept as AST in the sidecar (for HCL re-emission). Any change to these forms must touch both paths. Consider extending the proto model with structured nodes to eliminate the AST sidecar, or computing HCL directly from the flattened proto.

**D2 — Sidecar as an accumulating bolt-on:**
As the DSL grows, the `Sidecar` struct will accumulate more optional metadata. The pattern is sustainable for now but a richer IR (separate from the proto exchange format) would be cleaner long-term.

**D3 — `route`/`match` as value-checked idents:**
Promoting these to hard keyword tokens (`TokKwRoute`, `TokKwMatch`) would make parsing more explicit and consistent with all other structural keywords.

**D4 — CLI has only one command:**
`main.go` has a `switch` on `os.Args[1]` with only `"convert"`. The scaffolding is ready for more commands, but `printUsage` hard-codes only one. A `cobra`/`kingpin` library would be cleaner if the CLI grows.

---

## 7. Improvement Points 2 (Types/Interfaces)

**T1 — `Arg` and `LocalExpr` are parallel hierarchies:**
`Arg` is for the proto-lowering path; `LocalExpr` is for the v1 expression tree. Both define literal, reference, and call variants — unification or explicit bridging types would reduce the total surface area.

**T2 — `PrepareSource`/`NextPrepareSource` split not enforced by types:**
The constraint "FromLiteral is forbidden in action-level prepare" lives only in the validator comment and documentation. A separate `ActionPrepareSource` type (without `FromLiteral`) would make this a compile-time guarantee.

**T3 — `FuncTableEntry.argMap` asymmetry in TypeScript:**
`combine` and `pipe` entries carry `argMap`; `cond` does not (types.ts:44–46). Code touching `FuncTableEntry` must always special-case `cond`. Documenting why (cond resolves its inputs differently) would help.

**T4 — Branded type leakage in `hcl-context-builder.ts`:**
Numerous `as FuncId`, `as ValueId`, `as ContextSpec` casts in `hcl-context-builder.ts:237–244` indicate the bridge between proto model and runtime types is not type-safe at the boundary. A typed adapter layer would eliminate these escape hatches.

---

## 8. Improvement Points 3 (Implementations)

**I1 — `validateCombineArgTypes` / `validateLocalCallArgTypes` near-duplication:**
Both functions in `validate.go:809–858` and `validate.go:1177–1230` implement the same flag-dispatch logic (`isGeneric`, `isArrGet`, etc.) but operate on different input types. A shared helper `validateBinaryArgTypePair(fn, spec, t1, ok1, t2, ok2)` would eliminate the duplication.

**I2 — `sigilFor`/`extExprFor` double key-lookup:**
Both helper functions in `validate.go:313–352` try two `BindingKey` lookups (with/without `Scope`) to compensate for the dual-registration in `lowerBinding`. Standardizing on a single canonical key lookup would remove this workaround.

**I3 — `localFnReturnType` is incomplete relative to `builtinFns`:**
`lower.go:919–930` hard-codes return types for a subset of functions, returning `FieldTypeNumber` as the implicit default. Functions added to `builtinFns` in the validator won't automatically appear here — they need a manual addition to avoid mistyped temp bindings.

**I4 — `lowerCaseInto` emits bindings in non-intuitive order:**
The right-to-left fold at `lower.go:745–762` means the `name` binding is emitted last and intermediate conditions are emitted before their referencing `cond` binding. Reordering (or documenting the intent) would make the output easier to trace.

**I5 — `buildSpec` empty-array type gap:**
`hcl-context-builder.ts:73–75` returns `buildArray([])` for empty array literals with no element type. If the array is subsequently used in a typed context (e.g., `arr_concat`), the runtime may encounter a type mismatch that the Go validator would have caught.

---

## 9. Learning Paths (Entries and Goals)

Recommended reading order to understand the full system:

| Step | File | Goal |
|------|------|-------|
| 1 | `packages/go/converter/cmd/turnout/main.go` | CLI and full pipeline orchestration |
| 2 | `packages/go/converter/internal/lexer/lexer.go` | Token kinds, sigil scanning, heredoc |
| 3 | `packages/go/converter/internal/ast/ast.go` | All interface hierarchies — read alongside step 4 |
| 4 | `packages/go/converter/internal/parser/parser.go` | `parseBindingDecl`, `parseRHS`, `parseLocalExpr` |
| 5 | `packages/go/converter/internal/lower/sidecar.go` | Why the sidecar exists |
| 6 | `packages/go/converter/internal/lower/lower.go` | `lowerBinding`, `localLowerer` — the most complex part |
| 7 | `packages/go/converter/internal/validate/validate.go` | `validateProg`, `validateActionEffects`, `validateExtExpr` |
| 8 | `packages/go/converter/internal/emit/emit.go` | `writeBinding`, `writeExtExpr`, `localExprInline` |
| 9 | `schema/turnout-model.proto` | The canonical IR between Go and TS |
| 10 | `packages/ts/runtime/src/compute-graph/types.ts` | `ExecutionContext`, `FuncTableEntry`, `PipeArgBinding` |
| 11 | `packages/ts/runtime/src/compute-graph/runtime/executeTree.ts` | Recursive tree execution |
| 12 | `packages/ts/scene-runner/src/executor/hcl-context-builder.ts` | Proto model → runtime context bridge |
| 13 | `packages/ts/scene-runner/src/state/state-manager.ts` | Immutable `StateManager` |
| 14 | `packages/ts/scene-runner/src/executor/scene-executor.ts` | Action queue, next-rule evaluation, `createSceneExecutor` |

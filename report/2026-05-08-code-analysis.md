# Code Analysis — Turnout DSL
**Date:** 2026-05-08
**Updated:** 2026-05-16 — all actionable pitfalls and improvement points resolved or triaged.

---

## Status Summary

| # | Item | Status |
|---|---|---|
| §5-1 | `lowerCaseInto` reverse order fragile | Already resolved — comment added at lower.go:816–820 |
| §5-2 | `inferLocalType` silent fallback | Already resolved — comment added at lower.go:1076–1079 |
| §5-3 | Empty array literal throws at runtime | **Fixed** — Go validator now emits `EmptyArrayLitArg` at conversion time |
| §5-4 | Cycle detection non-intuitive entry | **Fixed** — `reportCycle` rotates to lexicographically smallest node |
| §5-5 | `from_hook` missing-field guard | Already resolved — guard exists in prepare-resolver.ts:49–51 |
| §5-6 | `maxSteps` not model-declarable | Deferred — requires proto schema change |
| §6A | Two-level validation gap | Deferred — requires significant new infrastructure |
| §6B | `state_file` partially implemented | **Fixed** — emits diagnostic when `Lower()` called without pre-loaded schema |
| §6C | Publish hooks fire-and-forget | Deferred — requires API surface change |
| §6D | Version field not validated end-to-end | Already resolved — check present in runner.ts:110–116 |
| §7A | `ast.Arg` vs `ast.LocalExpr` duplication | **Fixed** — cross-reference comments added to both interfaces |
| §7B | `ProgScope` opaque | Already resolved — `ComputeScope()`/`NextScope(i)` constructors serve as named constants |
| §7C | `BuiltContext.ids` no discriminant | Already resolved — conditional mapped type in builder/types.ts discriminates |
| §7D | `UnvalidatedContext` partial typing imprecise | **Fixed** — `valueTable?: Partial<ValueTable>` → `valueTable?: ValueTable` |
| §8A | `lowerBinding` switch 11 cases | **Fixed** — `lowerLocalRHS` helper extracted |
| §8B | `buildSpec` literal counter resets | **Fixed** — `_litCounter` moved to module scope |
| §8C | `evaluateNextRules` re-validates context | Already resolved — caching was intentionally removed (scene-executor.ts:226–233) |
| §8D | `heredoc` indentation byte vs rune | Already resolved — comment at lexer.go:486 |
| §8E | `checkFunctionCycles` rebuilds map | **Fixed** — `returnIdToFuncId` shared via `ValidationState` |

---

## 1. Code Organization and Structure

The project is a **domain-specific language (DSL) for declarative scene-graph-based storytelling/workflow**. It consists of three distinct layers:

```
schema/                 ← protobuf contract (single source of truth for Go↔TS)
packages/go/converter/  ← Go: .turn source → TurnModel (lexer → parser → lower → validate → emit)
packages/ts/runtime/    ← TS: compute-graph runtime (builder, executor, validation)
packages/ts/scene-runner/ ← TS: scene orchestration (executes TurnModel at runtime)
apps/vscode/            ← VS Code syntax highlighting extension
```

The Go converter pipeline is cleanly layered:

| Stage | Package | Input → Output |
|---|---|---|
| Lex | `lexer` | source text → `[]Token` |
| Parse | `parser` | `[]Token` → `*ast.TurnFile` |
| Lower | `lower` | `*TurnFile` + `Schema` → `*TurnModel` (proto) |
| Validate | `validate` | `*TurnModel` → `Diagnostics` |
| Emit | `emit` | `*TurnModel` → JSON or HCL text |

The TypeScript side splits responsibility well:

- `runtime` — pure compute-graph engine, has no knowledge of scenes
- `scene-runner` — scene/action orchestration, consumes `runtime` + the proto-generated `TurnModel`

---

## 2. Relations of Implementations — Types and Interfaces

### Go side

- `ast.BindingRHS` (interface) — discriminated union for all binding right-hand-side forms (`LiteralRHS`, `InfixRHS`, `IfCallRHS`, `CaseCallRHS`, `PipeCallRHS`, `SigilInputRHS`, …). Used exclusively inside `ProgBlock`.
- `ast.ActionPrepareSource` / `ast.NextPrepareSource` — compile-time interface split that enforces `from_hook` ∉ transition-level and `from_action` / `from_literal` ∉ action-level. A clean type-system guarantee — no runtime guard needed.
- `ast.LocalExpr` (interface) — pre-lowering recursive expression tree for `#if`, `#case`, `#pipe`. Parallel to but distinct from `ast.Arg` (post-lowering, proto-level).
- `state.Schema` (`map[string]FieldMeta`) — flat dotted-key lookup table for STATE. Passed through the entire Go pipeline; the lowerer uses it to resolve `from_state` defaults.
- `lower.prepareResolver` (interface) — abstracts action-level vs transition-level default resolution behind a single `resolveDefault` method. Clean polymorphism.

### TypeScript side

- `ExecutionContext` — pure data record holding five immutable tables. All execution passes context as a value; mutation is always via returning a new `ValueTable`.
- `ValidatedContext` (branded) — `ExecutionContext & { [_brand]: true }`. Prevents passing an unvalidated context to `executeGraph` without going through `validateContext`.
- `FuncTableEntry` discriminated union (`combine | pipe | cond`) — the `hasArgMap()` type guard neatly narrows the two variants that carry `argMap`, avoiding case-by-case checks.
- `PipeArgBinding` (`input | step | value`) — source variants for pipe step arguments.
- `ConditionId` (`{ source: 'value' | 'func'; id }`) — value vs function condition discrimination used by `CondFuncDefTable`.

---

## 3. Relations of Implementations — Functions

### Go converter call chain

```
main.go
  ↓ parser.ParseFile()
  ↓ lower.Lower(ast, schema)
      ↓ lowerSceneBlock → lowerAction → lowerProgInner → lowerBinding
            → lowerLocalRHS (IfCallRHS | CaseCallRHS | PipeCallRHS)  ← extracted helper
            → lowerIfRHS / lowerCaseInto / lowerPipeInto  (localLowerer)
            → lowerArgsWithTypes / lowerMethodCallArg
  ↓ validate.Validate(model, schema)
  ↓ emit.EmitJSON / EmitHCL
```

The `localLowerer` struct is the most complex part of the lowerer. It:
1. Receives a top-level `#if`/`#case`/`#pipe` RHS
2. Recursively lowers sub-expressions into flat `BindingModel` entries
3. Generates synthetic names with `temp()` for intermediate results
4. Produces a topologically ordered list of `BindingModel` slices

### TypeScript call chain for one action

```
executeAction(action, state, hooks)
  → buildContextFromProg(prog, injectedValues)
       → buildSpec(prog, injected)          # Phase 1: proto → ContextSpec record
       → ctx(spec)                          # runtime builder
       → buildNameToValueId(bindings, ids)  # Phase 2: derive name→ValueId map
  → assertValidContext(exec)
  → executeGraph(rootFuncId, validatedCtx)
```

---

## 4. Specific Contexts and Usages

- **State schema** is the runtime's only global shared state. The Go converter uses the schema at lowering time to resolve `from_state` defaults for `PlaceholderRHS` (`_`). The schema is also used at validate-time to check that `from_state` paths exist.

- **Sigil annotations** are serialized into `TurnModel.Annotations` (a protobuf map) by the lowerer and read by the validator, which then clears them before JSON emission (`lower.go:64`). This avoids threading a separate sidecar through the validate/emit boundary.

- **`ext_expr` field** on `BindingModel` is populated by the lowerer for `#if`/`#case`/`#pipe` bindings (`lower.go:653–661`). It stores the structured source-form for HCL re-emission. The TS runtime explicitly ignores it.

- **`nameToValueId`** in `BuiltContext` is essential for the `from_action` flow: after an action executes, `next.prepare` entries with `from_action` read the binding's result value via `nameToValueId[bindingName]`.

- **`drainVisited` in scene executor** handles `all-match` deduplication. Under `all-match`, the same action can be enqueued by multiple next rules; the visited set prevents re-execution, and a warning is added to the trace.

---

## 5. Pitfalls

### 1. `lowerCaseInto` emits bindings in reverse order — Already resolved
`lower.go:820` — The `#case` lowering intentionally builds the chain bottom-up (last arm first), relying on topological ordering. This is correct but fragile: any future optimization that reorders bindings for a different reason must preserve this constraint. **A comment documenting this constraint was added at lower.go:816–820.**

### 2. `localLowerer.inferLocalType` falls back silently for unknown references — Already resolved
`lower.go:1066` — If a `LocalRefExpr` references an unknown binding, `inferLocalType` silently returns `fallback`. The `UndefinedRef` diagnostic is only emitted in `lowerExprInto`. For nested expressions (e.g. inside a `#pipe` step), type mismatch errors can cascade confusingly. **A comment explaining this intentional design was added at lower.go:1076–1079.**

### 3. Empty array literal in inline arg position throws at runtime — Fixed
~~`hcl-context-builder.ts:106–113` — `inferLiteralAnyValue` throws for `[]` with no type context. This is caught at executor build time, not at conversion time — the Go validator does not flag it.~~

**Fixed:** `validate.go` now emits `EmptyArrayLitArg` when a binding's `ExprModel` contains an empty array literal as an inline function argument (in `CombineExpr.Args`, `PipeExpr.Steps[].Args`, or `CondExpr` branch/condition args). Identity combines (`arr_concat(x, [])`) are exempt — they are lowerer-generated and carry an implicit type from the other operand.

### 4. Cycle detection may report a non-intuitive cycle entry — Fixed
~~`validateContext.ts:1381` — The `reported` set deduplicates cycles by path string. A 3-node cycle `A → B → C → A` may be reported from whichever DFS entry point reaches it first, which may not be the most readable starting node for authors.~~

**Fixed:** `reportCycle` now rotates the cycle path so it always starts from the lexicographically smallest node before joining into the dedup key and error message. Reports are now deterministic regardless of `Object.entries` iteration order.

### 5. `from_hook` resolve returns zero literal unconditionally at lowering time — Already resolved
`lower.go:1287` — Hooks are not invoked at lowering time; the zero default is used. **A missing-field guard already exists in `prepare-resolver.ts:49–51`:** if a hook returns an object that is missing the required field, `MissingHookField` is thrown before the zero default is ever used.

### 6. `maxSteps` guard is only enforced at the API level — Deferred
`scene-executor.ts:57` — The default of 10 000 steps cannot be declared in the model itself. A near-limit scene would silently succeed but be fragile to any action additions. **Deferred:** fixing this requires adding a `max_steps` field to the `TurnModel` proto schema.

---

## 6. Improvement Points — Design Overview

### A. Two-level validation gap — Deferred
The Go validator checks structural correctness of the model (binding references, sigil constraints, overview nodes). The TypeScript `validateContext` checks the compute-graph's internal consistency (argMap refs, cycle detection). But there is no cross-layer check: a binding in the JSON that references an undefined neighbor will only fail at TS runtime, not at Go conversion time. A richer emit-time check could cross-validate the topological order claimed by the lowerer against the actual `Ref` dependencies. **Deferred — requires significant new infrastructure.**

### B. `state_file` directive is partially implemented — Fixed
~~`lowerStateBlock` in `lower.go:139` has `_ = s` — the path in `StateFileDirective` is used only during parsing/validation; actual file loading happens earlier in `main.go`. If a consumer calls `Lower()` directly without pre-loading the state file, the schema will be empty with no diagnostic.~~

**Fixed:** `lowerStateBlock` now emits `UnsupportedConstruct` when `Lower()` is called with a `state_file` directive but an empty schema, alerting direct callers who bypass `main.go`'s pre-loading step.

### C. Publish hooks are fire-and-forget — Deferred
`publish` hooks fire after merge in declaration order and their return values are ignored. There is no mechanism to signal publish failure or retry. For safety-critical actions this is a design gap. **Deferred — requires API surface changes.**

### D. Version field in `TurnModel` is not validated end-to-end — Already resolved
~~The spec says the TS runner should reject versions ≠ 1. The field is set by the Go emitter but the scene-runner does not check it at load time (no version check visible in `scene-executor.ts` or `runner.ts`).~~

**Already resolved:** version check is present in `runner.ts:110–116`.

---

## 7. Improvement Points — Types and Interfaces

### A. `ast.Arg` vs `ast.LocalExpr` duplication — Fixed
~~Both hierarchies have `Ref`, `Lit`, and `Call` variants. They serve different stages (post-lowering proto-args vs pre-lowering source-tree nodes), but the distinction is not immediately obvious. A comment on one or both interfaces would prevent confusion for new contributors.~~

**Fixed:** `ast.go` already had a full explanation on `LocalExpr` (lines 434–444). A matching cross-reference comment was added to `Arg`: *"post-lowering, proto-level argument type used inside CombineExpr and PipeExpr steps — see LocalExpr for its pre-lowering counterpart."*

### B. `ProgScope` type is opaque — Already resolved
~~`ProgScope` encodes whether bindings come from a compute or next-rule context but its fields are not visible to readers of `lower.go`. Named constants or a `String()` method would make diagnostic messages from the sidecar more readable.~~

**Already resolved:** `ComputeScope()` and `NextScope(i)` constructor functions in `sidecar.go` already serve as named constants with self-documenting names.

### C. `BuiltContext.ids` has no discriminant — Already resolved
~~`ids` is typed as `Record<string, FuncId | ValueId>` with no discriminant. Callers must consult `prog.bindings[i].expr !== undefined` to distinguish kinds. Two separate maps (`funcIds` and `valueIds`) would eliminate the need for `getFuncId` / `getValueId` helper closures.~~

**Already resolved:** `BuildResult<T>.ids` in `builder/types.ts` uses a conditional mapped type (`T[K] extends FunctionBuilder ? FuncId : ValueId`) that already discriminates at the type level.

### D. `UnvalidatedContext` partial typing is imprecise — Fixed
~~`Partial<ValueTable>` types individual values as `AnyValue | undefined`, which is not meaningfully weaker than `AnyValue`. The real intent is "the whole table may be absent." Typing the field as `ValueTable | undefined` would express this more precisely.~~

**Fixed:** `UnvalidatedContext.valueTable` changed from `Partial<ValueTable>` to `ValueTable` (the `?` makes the field itself optional, expressing "present or absent" cleanly).

---

## 8. Improvement Points — Implementations

### A. `lowerBinding` switch has 11 cases — Fixed
~~`lower.go:407–455` — Extracting `lowerLocalRHS(rhs, …)` for the `IfCallRHS | CaseCallRHS | PipeCallRHS` trio (the three that go through `localLowerer`) would reduce the flat switch length and clarify the abstraction boundary.~~

**Fixed:** `lowerLocalRHS(name, ft, rhs, bindingTypes, ds)` extracted. The switch case is now a single readable delegation, and `localLowerer` is invoked only from this helper.

### B. `buildSpec` literal counter resets per call — Fixed
~~`hcl-context-builder.ts:145` — `__lit_0`, `__lit_1`, … are generated per `buildSpec` call. Since the spec is not merged with anything, collisions are impossible in practice. But if `buildSpec` is ever reused incrementally, the counter resets. A module-level counter or UUID would be safer.~~

**Fixed:** `_litCounter` is now a module-level variable in `hcl-context-builder.ts`. Names are globally unique across all `buildSpec` calls within a process lifetime.

### C. `evaluateNextRules` re-validates context on every rule — Already resolved
~~`scene-executor.ts:255` — `assertValidContext` runs a full O(n) graph pass on every next-rule evaluation. For scenes with many next rules on hot-path actions, caching the validated context keyed by `prog.name` could reduce overhead.~~

**Already resolved (by intentional removal):** caching by prog name was removed because it was incorrect — `scene-executor.ts:226–233` explains that the same prog name can appear with different injected values across rule evaluations.

### D. `heredoc` indentation stripping counts bytes, not runes — Already resolved
~~`lexer.go:487` — `rl[minIndent:]` is a byte-slice operation. All DSL keywords are ASCII, so this is safe in practice. However, if heredoc body content contains multi-byte UTF-8, the invariant should be explicitly documented in a comment.~~

**Already resolved:** comment at `lexer.go:486` reads: *"minIndent is a count of leading ASCII whitespace bytes, so byte-slicing is safe."*

### E. `checkFunctionCycles` rebuilds `returnIdToFuncId` locally — Fixed
~~`validateContext.ts:1316` — This map is already partially computed in `collectReturnIds`. Sharing it would avoid a second traversal of `funcTable`.~~

**Fixed:** `ValidationState` now carries `returnIdToFuncId: Map<string, string>`. `collectReturnIds` populates it alongside `returnIds`. `checkFunctionCycles` reads `state.returnIdToFuncId` directly, eliminating the redundant traversal.

---

## 9. Learning Paths

### Entry points for understanding the system end-to-end

1. **Start with the spec** — read `spec/scene-graph.md` and `spec/overview-dsl-spec.md` to understand the authoring model before touching code.

2. **Follow a `.turn` file through the Go pipeline:**
   - `packages/go/converter/cmd/turnout/main.go` — CLI entry point
   - `internal/lexer/lexer.go` — token classification, heredoc/triple-quote handling
   - `internal/parser/parser.go` — `parseFile` → `parseSceneBlock` → `parseActionBlock` → `parseBindingDecl` → `parseRHS`
   - `internal/lower/lower.go` — focus on `lowerAction` and `localLowerer` for `#if/#case/#pipe`
   - `internal/validate/validate.go` — `Validate` entry, `validateScene`, `validateProgBindings`

3. **Understand the TS compute graph:**
   - `packages/ts/runtime/src/compute-graph/types.ts` — all table types
   - `packages/ts/runtime/src/compute-graph/builder/context.ts` — how `ctx(spec)` builds tables
   - `packages/ts/runtime/src/compute-graph/runtime/validateContext.ts` — `validateContext` entry → per-table validators → cycle detectors
   - `packages/ts/runtime/src/compute-graph/runtime/exec/executeGraph.ts` — execution entry

4. **Trace a scene execution:**
   - `packages/ts/scene-runner/src/executor/hcl-context-builder.ts` — `buildContextFromProg` (proto model → runtime context)
   - `packages/ts/scene-runner/src/executor/action-executor.ts` — `executeAction` (prepare → run → merge → publish)
   - `packages/ts/scene-runner/src/executor/scene-executor.ts` — `createSceneExecutor` (queue, visited, next-rule evaluation)

5. **Goals to reach full system understanding:**
   - Be able to write a new `.turn` fixture, run it through `turnout convert -format json`, and read the emitted JSON
   - Be able to trace a `#case` binding through `localLowerer` all the way to the emitted `CondExpr` bindings
   - Be able to explain why `ValidatedContext` uses a branded type and why it prevents double-validation at the call site

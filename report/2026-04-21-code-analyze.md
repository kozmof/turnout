# Code Analysis: Turnout DSL Compiler & Runtime

**Date:** 2026-04-21

---

## 1. Code Organization and Structure

The project is a **polyglot monorepo** with a clean separation of concerns across three layers:

```
schema/                  ← Protobuf contract (single source of truth)
packages/go/converter/   ← Compilation: .turn DSL → JSON/HCL
packages/ts/runtime/     ← Execution: compute graph + value types
packages/ts/scene-runner/← Harness: TurnModel JSON → state transitions
apps/vscode/             ← IDE: syntax highlighting
```

The layering is architecturally sound. Each package has a single job, and the proto schema is the only shared contract. The Go converter's 8-phase pipeline (`lexer → parser → ast → lower → state → validate → emit`) is well-structured.

**Minor structural concern:** The `scene-runner` has a `server/` subdirectory intended for Node.js-only code, but it is co-located with browser-compatible code in the same package without a clear module boundary (no separate entry point or conditional exports).

---

## 2. Relations of Implementations (Types & Interfaces)

The type hierarchy is deep but coherent. Key relationships:

```
AnyValue
 ├── NumberValue        { symbol: 'number', val: number }
 ├── StringValue        { symbol: 'string', val: string }
 ├── BooleanValue       { symbol: 'boolean', val: boolean }
 ├── NullValue          { symbol: 'null', subSymbol: NullReason }
 └── ArrayValue<T>      { symbol: 'array', subSymbol: ElementType }
       ├── ArrayNumberValue
       ├── ArrayStringValue
       ├── ArrayBooleanValue
       └── ArrayNullValue
```

The `subSymbol` field doubles as:
- **element type** for arrays (encoding `arr<number>` etc.)
- **null reason** for nulls (`'missing' | 'not-found' | 'error' | 'filtered' | 'redacted' | 'unknown'`)

This reuse of the same field for semantically different purposes is a source of confusion (see Pitfalls §5).

**`ExecutionContext`** composes five lookup tables:

```
ExecutionContext
 ├── ValueTable          ValueId → AnyValue
 ├── FuncTable           FuncId  → CombineEntry | PipeEntry | CondEntry
 ├── CombineFuncDefTable CombineDefineId → { name, transformFn }
 ├── PipeFuncDefTable    PipeDefineId    → { args, sequence }
 └── CondFuncDefTable    CondDefineId    → { conditionId, trueBranchId, falseBranchId }
```

The `FuncTable` entries reference `DefTable` entries by ID, creating an indirection layer that mirrors a linking step — intentional but not documented.

---

## 3. Relations of Implementations (Functions)

The execution call graph flows as:

```
runner.run()
  └── sceneExecutor.execute(scene, state)
        └── actionExecutor.execute(action, state)
              ├── prepareResolver.resolve(prepare, state, hooks)
              ├── hclContextBuilder.build(prog)
              │     └── createValueId / createFuncId (ID factory)
              ├── validateContext(ctx)
              └── executeGraph(rootFuncId, validatedCtx)
                    └── executeTree(root, treeMap, ctx)
                          ├── executeCombineFunc(node, ctx)
                          ├── executePipeFunc(node, ctx)
                          └── executeCondFunc(node, ctx)
```

The Go compiler has a similarly clean cascade:

```
main() → convert()
  ├── lexer.Tokenize()
  ├── parser.Parse(tokens)
  ├── state.Resolve(ast)
  ├── lower.Lower(ast, schema)          → (*turnoutpb.TurnModel, *Sidecar)
  ├── validate.Validate(tm, sc, schema)
  └── emit.Emit(w, tm, sc)  /  emit.EmitJSON(w, tm)
```

Each phase depends only on the output of the prior phase — no backtracking or cross-phase mutation.

---

## 4. Specific Contexts and Usages

**Compute Graph Builder (high-level API):**

```typescript
// packages/ts/runtime/src/compute-graph/builder/
const ctx = buildCtx()
  .val('x', numberValue(5))
  .combine('sum', ref('x'), ref('y'), 'add')
  .build();
```

This builder pattern hides `createValueId`/`createFuncId` and table construction from consumers — good ergonomics.

**Scene Runner (test harness):**

```typescript
const runner = createRunner(model, { initialState });
runner.useHook('fetchUserData', async (args) => { ... });
const result = runner.run();
```

The `useHook` pattern allows injecting side-effectful operations (API calls, DB reads) without coupling the model to a specific runtime environment.

**Go DSL (`.turn` file):**

```
state "applicant" {
  income: number = 0
}
scene "evaluate" {
  action "check" {
    compute root = add(state.applicant.income, 1000)
    merge state.applicant.income = root
    next "approve" if root > 50000
  }
}
```

The DSL is readable and concise. The sigils (`~>`, `<~`, `<~>`) encode data-flow direction but their ergonomics need user testing.

---

## 5. Pitfalls

**P1 — `subSymbol` overloading** (`packages/ts/runtime/src/state-control/value.ts`)

`subSymbol` serves two purposes: encoding array element types and encoding null reasons. This is non-obvious — a reader must know which `symbol` value is in scope before `subSymbol` becomes interpretable. A discriminated union with separate `elementType` and `nullReason` fields would be clearer.

**P2 — `node10` module resolution in runtime** (`packages/ts/runtime/tsconfig.json`) ✓ *Already resolved*

~~The runtime uses `"moduleResolution": "node10"` while scene-runner uses `"node16"`. `node10` does not support the `exports` field in `package.json`, which means conditional exports (browser vs. Node.js) are silently ignored when the runtime is consumed.~~

The runtime tsconfig already uses `"moduleResolution": "bundler"`, which fully honours `package.json` `exports` fields including conditional exports. This pitfall no longer applies.

**P3 — No cycle detection documented as limitation**

`validateContext` includes cycle detection in the compute graph, but there is no test or doc clarifying what happens with a self-referencing binding. If cycles exist in the JSON model (not generated by the compiler), the runtime will likely enter infinite recursion before the validator fires.

**P4 — `UnvalidatedContext` → `ValidatedContext` brand bypass**

The validation brand is a TypeScript symbol (`declare const brand: unique symbol`). Any code that casts `as ValidatedContext` bypasses all runtime checks. This pattern is powerful but invisible — one unsafe cast in test scaffolding can silently propagate to production paths.

**P5 — Go `lower` phase output is HCL, not proto** ✓ *Resolved 2026-04-23*

~~The lowering phase outputs `HCLSceneBlock` / `HCLRouteBlock` Go structs that are then re-encoded to JSON/HCL by the emitter. The proto model is only involved at the emit stage. If the HCL structs and the proto schema diverge, the discrepancy would only surface at JSON emission time, not at the lowering stage — a late detection point.~~

`lower.Lower` now produces `*turnoutpb.TurnModel` directly; the ~25 `lower.HCL*` intermediate structs have been deleted. DSL-only metadata not representable in proto (sigils, action text) is carried in a thin `lower.Sidecar` value alongside. Schema divergence is now a compile-time error rather than a late emit-time surprise.

**P6 — `prepareResolver` hook failures are silent**

If a hook registered via `useHook` throws or returns an unexpected type, the prepare resolver's error handling is not clearly defined. Unhandled promise rejections in async hooks could cause the runner to hang or produce misleading trace output.

> **Partially resolved (2026-04-23):** Async hooks are now properly `await`ed throughout the call stack (`resolveActionPrepare` → `executeAction` → `SceneExecutor.next`). Promise rejections from hooks now propagate as rejected Promises on `Runner.run()` / `Runner.next()` rather than being silently dropped. Explicit error-boundary handling (catch + structured error value) remains a future improvement.

---

## 6. Improvement Points 1 — Design Overview

**D1 — No streaming or incremental execution** ✓ *Resolved 2026-04-23*

~~The runner's `next()` API steps one action at a time, but `run()` executes to completion synchronously. For long-running scenes with many actions, there is no way to yield, checkpoint, or resume — the entire execution must complete in one call. Consider an async generator or continuation-passing design for `run()`.~~

The entire execution stack has been made async and a streaming API has been added. Changes across 7 source files and 7 test files:

- `resolveActionPrepare()` — now `async`; hook calls are properly `await`ed (also fixes P6)
- `executeAction()` — now `async`; awaits prepare resolver and publish hooks
- `SceneExecutor.next()` — returns `Promise<StepResult>`
- `executeScene()` / `executeRoute()` — now `async`
- `Runner.next()` — returns `Promise<RunnerStepResult[]>`
- `Runner.run()` — returns `Promise<HarnessResult>`
- `Runner.runAsync()` — **new**: `AsyncGenerator<RunnerStepResult>` that yields after each action, giving callers incremental control and event-loop yield points between steps

```typescript
// Streaming: observe each action as it completes
for await (const step of runner.runAsync()) {
  console.log(step.sceneId, step.actionId);
  // checkpoint or cancel here if needed
}
const result = runner.result();

// Batch: unchanged ergonomics, now async
const result = await runner.run();
```

All 184 existing tests pass; a new test was added to `prepare-resolver.test.ts` asserting that async hook Promises are awaited (the previously silent failure case).

**D2 — Proto as late-stage contract, not early-stage** ✓ *Resolved 2026-04-23*

~~The protobuf schema is the "single source of truth" for JSON interchange, but the Go compiler's internal representation (`HCLSceneBlock` etc.) is a separate struct hierarchy. This means there are two models to keep in sync. Consider generating Go structs directly from the proto definition and using them throughout the pipeline from lowering onward.~~

The pipeline is now proto-first throughout. Changes across 12 source and test files:

- **`lower.Lower`** — return type changed from `(*lower.Model, diag.Diagnostics)` to `(*turnoutpb.TurnModel, *lower.Sidecar, diag.Diagnostics)`; all ~25 `lower.HCL*` intermediate struct types deleted
- **`lower.Sidecar`** — new thin struct that carries DSL-only metadata alongside the proto model: `Sigils map[BindingKey]ast.Sigil` (binding-level ingress/egress annotations consumed by the validator), `Actions map[string]ActionMeta` (action text for HCL emit), and `Scenes map[string]SceneMeta`
- **`validate.Validate`** — signature updated to `(tm *turnoutpb.TurnModel, sc *lower.Sidecar, schema state.Schema)`; sigil lookups now go through the sidecar map
- **`emit.Emit`** — signature updated to `(w io.Writer, tm *turnoutpb.TurnModel, sc *lower.Sidecar)`; action text sourced from sidecar
- **`emit.EmitJSON`** — 4-step HCL roundtrip (`Emit → parse → decode → re-encode`) replaced with a single `protojson.Marshal` call
- **`emit/hcl_decode.go`, `emit/hcl_schema.go`** — deleted (dead code)
- **`main.go`** — call chain updated to thread the three-return `Lower` result through validate and emit

All 10 test packages pass with 0 failures.

**D3 — VSCode extension is syntax-only**

The extension provides TextMate grammar but no language server (LSP). There is no hover documentation, go-to-definition, or inline diagnostics. Given that the Go converter already produces structured diagnostics, an LSP server would significantly improve the developer experience.

**D4 — No schema versioning**

The proto file has no `version` field or package version. As the DSL evolves, there is no mechanism to detect or migrate old JSON models. A `schema_version: int32` field and a migration path would prevent silent breakage when the format changes.

---

## 7. Improvement Points 2 — Types & Interfaces

**T1 — Split `subSymbol` into `elementType` and `nullReason`**

```typescript
// Current (confusing)
type ArrayValue = { symbol: 'array'; subSymbol: 'number' | 'string' | ... }
type NullValue  = { symbol: 'null';  subSymbol: 'missing' | 'not-found' | ... }

// Suggested (explicit)
type ArrayValue = { symbol: 'array'; elementType: 'number' | 'string' | ... }
type NullValue  = { symbol: 'null';  nullReason: 'missing' | 'not-found' | ... }
```

**T2 — `FuncTable` entry `kind` field should be a const enum or literal**

The discriminant field `kind: 'combine' | 'pipe' | 'cond'` on `FuncTableEntry` is a plain string. Exhaustiveness checking works, but making it a `const` or `enum` would catch typos at the definition site rather than use site.

**T3 — `HarnessResult.trace` is a union without a discriminant**

```typescript
type HarnessResult = {
  trace: SceneTrace | RouteTrace  // no `kind` field
}
```

Consumers must check for the presence of `routeId` vs `sceneId` to determine which case they have. Adding a `traceKind: 'scene' | 'route'` field removes the structural guessing.

**T4 — `MatchArm.patterns` is `string[]` with implicit encoding**

The pattern `"_"` means fallback and `"scene.action"` means a qualified path, but these semantics live only in the executor code. A discriminated union `Pattern = WildcardPattern | QualifiedPattern` would make the encoding explicit in the type.

---

## 8. Improvement Points 3 — Implementations

**I1 — `hcl-context-builder.ts` is a God function** ✓ *Resolved 2026-04-23*

~~The `hclContextBuilder.build(prog)` function translates an entire `ProgModel` into an `ExecutionContext` — covering ID creation, table population, literal inference, and function name mapping all in one place.~~

`buildContextFromProg` has been reduced to a 5-line orchestrator over two exported, independently testable phases:

- **`buildSpec(prog, injectedValues)`** — owns all binding-translation logic (preprocessing, literal registration, arg resolution, the value/combine/pipe/cond dispatch loop). Returns a plain `Record<string, unknown>` that can be inspected without running `ctx()` or `executeGraph`.
- **`buildNameToValueId(bindings, ids, funcTable)`** — pure function that maps each binding name to its `ValueId`, making the value-vs-function-binding indirection explicit.

10 new unit tests cover both functions in isolation; the 20 existing integration tests are unchanged.

**I2 — `executeGraph` rebuilds the tree on every call**

`buildReturnIdToFuncIdMap()` and tree construction run inside `executeGraph` on every invocation. For a given `ValidatedContext`, the execution tree is deterministic and could be memoized or pre-built once (e.g., during `validateContext`). This is a performance improvement for repeated execution of the same model.

**I3 — State manager uses dotted-path strings as keys without validation** ✓ *Resolved 2026-04-23*

~~`state-manager.ts` keys state by dotted path (e.g., `"applicant.income"`). There is no validation that the path exists in the schema at read/write time — a typo silently returns `undefined`.~~

The internal `make()` factory now accepts a `validPaths: ReadonlySet<string> | null` parameter. Schema-backed managers (created via `stateManagerFromSchema`) build the set from the schema namespaces/fields in the same loop that populates defaults, then thread it through every subsequent `write()` call. A write to an undeclared path throws immediately with the bad path name in the message. Schema-less managers (`stateManagerFrom`) pass `null` and remain permissive. 4 new tests cover valid write, unknown-path throw, constraint propagation to the returned manager, and schema-less passthrough.

**I4 — Go `validate.go` has a 70+ function flat registry**

All built-in function specs live in a single flat map. As the function library grows, this will become difficult to maintain. Grouping by domain (`number`, `string`, `array`, `control-flow`) and registering them separately would make the file navigable.

**I5 — No structured logging or observability**

The runner produces a `trace` in the result, but there is no log output during execution. Debugging a misbehaving hook or unexpected null propagation requires post-hoc inspection of the trace. A pluggable logger interface (even a no-op default) would help in production and test environments.

---

## 9. Learning Paths on Implementations

**Entry: Understanding the value system**
1. `packages/ts/runtime/src/state-control/value.ts` — start here to understand all value types and the `symbol`/`subSymbol` pattern
2. `packages/ts/runtime/src/state-control/value-builders.ts` — factory functions that create values
3. `packages/ts/runtime/src/state-control/preset-funcs/` — how built-in functions operate on values

**Entry: Understanding the compute graph**
1. `packages/ts/runtime/src/compute-graph/types.ts` — the five tables and their relationships
2. `packages/ts/runtime/src/compute-graph/idValidation.ts` — how branded IDs work
3. `packages/ts/runtime/src/compute-graph/builder/` — high-level API before diving into low-level tables
4. `packages/ts/runtime/src/compute-graph/runtime/exec/executeGraph.ts` — the DAG traversal
5. `packages/ts/runtime/src/compute-graph/runtime/validateContext.ts` — how `UnvalidatedContext` becomes `ValidatedContext`

**Entry: Tracing a `.turn` file through the Go compiler**
1. `packages/go/converter/cmd/turnout/main.go` — the CLI orchestration
2. `packages/go/converter/internal/lexer/lexer.go` — tokenization of the DSL
3. `packages/go/converter/internal/parser/parser.go` — recursive-descent parsing
4. `packages/go/converter/internal/ast/ast.go` — AST node types
5. `packages/go/converter/internal/lower/lower.go` — AST → `*turnoutpb.TurnModel` + `*lower.Sidecar`
6. `packages/go/converter/internal/validate/validate.go` — type checking and sigil rules
7. `packages/go/converter/internal/emit/emit.go` — HCL output; `emit/json.go` for JSON via `protojson.Marshal`

**Entry: Running a model end-to-end**
1. `schema/turnout-model.proto` — understand the JSON contract first
2. `packages/ts/scene-runner/src/runner.ts` — the public API
3. `packages/ts/scene-runner/src/executor/action-executor.ts` — the core execution step
4. `packages/ts/scene-runner/src/executor/hcl-context-builder.ts` — bridging JSON model to runtime types
5. `packages/ts/scene-runner/src/state/state-manager.ts` — how state is read and mutated
6. `packages/ts/scene-runner/tests/` — integration tests as executable examples

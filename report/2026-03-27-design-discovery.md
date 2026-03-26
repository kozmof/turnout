# Turnout Design Discovery Report
_2026-03-27_

---

## Overview

**Turnout** is a two-phase workflow execution engine built as a monorepo. It separates domain authoring (a `.turn` DSL compiled by a Go converter) from execution (a TypeScript runtime). A Protobuf schema bridges the two.

| Layer | Language | Role |
|---|---|---|
| Go Converter | Go | DSL parser → canonical HCL/JSON |
| Runtime | TypeScript | Functional compute graph execution |
| Scene Runner | TypeScript | Action/scene/route orchestration |
| VSCode Extension | TypeScript | Editor language support |
| Protobuf Schema | Proto3 | Cross-language type contract |

---

## Architecture: Two-Phase Pipeline

The system explicitly separates **convert time** from **runtime**:

- **Phase 1 (Convert):** Parse `.turn` DSL → validate → lower to canonical HCL → emit `TurnModel` JSON
- **Phase 2 (Runtime):** Load `TurnModel` → construct execution context → execute graphs → manage state

This decouples authoring from execution semantics and enables static validation before runtime. The Go converter is the authoritative validator; the TypeScript runtime is the trusting executor.

**Key files:** `spec/convert-runtime-spec.md`, `packages/go/converter/cmd/turnout/main.go`

---

## Design Dimensions

### 1. Branded Types as Compile-Time Invariants

Turnout uses phantom types (not just strings) across its entire type surface:

```typescript
// Brand<K, T> = K & { __brand: T }
type FuncId        = Brand<string, 'FuncId'>
type ValueId       = Brand<string, 'ValueId'>
type CombineDefineId = Brand<string, 'CombineDefineId'>
```

You cannot pass a `ValueId` where `FuncId` is expected — the compiler prevents it. This extends to definition IDs vs instance IDs, keeping four separate ID namespaces that look like plain strings but are typed as distinct domains.

**Key files:** `packages/ts/runtime/src/util/brand.ts`, `packages/ts/runtime/src/compute-graph/types.ts`

---

### 2. Demand-Driven Execution Tree Building

`buildExecutionTree` is not a full graph traversal — it is demand-driven and lazy:

1. Starts from a single root `FuncId`
2. Expands only the subgraph reachable from that root
3. Uses a `visited` set for cycle detection (ancestor chain, cleaned up after subtree)
4. Memoizes results to handle diamond patterns (shared dependencies computed once)
5. Resolves "which function produced value X" via a reverse-lookup `ReturnIdToFuncIdMap`

The tree is a discriminated union of `ValueNode` (leaf), `FunctionNode` (combine/pipe), and `ConditionalNode` (lazy branches). Branches of a `cond` are not materialized until the condition is evaluated.

**Key file:** `packages/ts/runtime/src/compute-graph/runtime/buildExecutionTree.ts`

---

### 3. The Three Operations Are Not Symmetric

`combine`, `pipe`, and `cond` look parallel but have fundamentally different execution models:

| Operation | Argument style | Evaluation |
|---|---|---|
| `combine` | Positional (a, b) | Eager — both args always evaluated |
| `pipe` | Named params + ordered steps | Eager per step, sequential, scoped value table |
| `cond` | Condition + two branch refs | **Lazy** — only selected branch executes |

**`pipe` is most complex:** each step creates a temporary `FuncId` (`{pipeFuncId}__step{i}`), gets its own scoped value table with limited visibility (`visibleValueIds`), and threads results forward. Empty step sequences throw `EmptySequenceError`.

**`cond` is the only lazy node:** it short-circuits, so the execution tree represents branches as unevaluated subtrees rather than pre-computed values.

**Key files:** `packages/ts/runtime/src/compute-graph/runtime/exec/executePipeFunc.ts`, `executeCondFunc.ts`

---

### 4. Null Is a First-Class Value with Typed Reasons

There is no `undefined` in state — absence is represented as `NullValue` with an explicit reason sub-symbol:

| Null reason | Meaning |
|---|---|
| `'missing'` | Value was never provided |
| `'not-found'` | Lookup found no match |
| `'error'` | Computation failed |
| `'filtered'` | Intentionally excluded |
| `'redacted'` | Access-controlled |
| `'unknown'` | Reason not determined |

"Why is this null" is always queryable at runtime. A missing hook returns `buildNull('missing')` — not an exception, not `undefined`. Type guards like `isPure(val)` and `isPureNumber(val)` compose these into precise constraints.

**Key file:** `packages/ts/runtime/src/state-control/value.ts`

---

### 5. Tag Propagation as Data Provenance

Tags are readonly string arrays that propagate through all operations via **set union**:

```
combine(v1: tags=['random'], v2: tags=['network'])
  → result: tags=['random', 'network']
```

You can query the final output of a complex graph and know it was derived from random or network-dependent inputs — without instrumenting intermediate steps. Common tags: `'random'`, `'cached'`, `'network'`, `'io'`, `'deprecated'`, `'user-input'`.

A downstream consumer can check `isPure(result)` (tags empty) to assert the computation had no side-channel dependencies.

---

### 6. Next Rule Evaluation Is a Mini Pipeline

Next rules are not just boolean conditions — they have their own Prepare → Compute mini-pipeline:

```
PrepareEntry[] (from_action / from_state / from_literal)
  → bind values
  → build ExecutionContext from NextComputeModel.prog
  → execute root binding as boolean
  → match policy (first-match | all-match)
  → enqueue target action IDs
```

The condition expression is compiled by the Go converter into a `ProgModel` — the same structure used for action compute. There is no separate expression evaluator for conditions; they reuse the full compute graph engine.

**Key file:** `packages/ts/scene-runner/src/executor/scene-executor.ts`

---

### 7. ValidatedContext Is a Compile-Time Gate

Before any graph executes, `validateContext()` must succeed. Its return type is a **branded `ValidatedContext`**:

```typescript
type ValidatedContext = ExecutionContext & { __validated: true }
```

`executeGraph` only accepts `ValidatedContext` — not raw `ExecutionContext`. You cannot call the execution engine without passing validation. The compiler enforces this, not just runtime checks. `assertValidContext()` is the throwing variant used in production paths.

---

### 8. Harness Is Push, Runner Is Pull

The API surface encodes two distinct execution philosophies:

**Harness** — Push-based, one-shot:
- `runHarness(options)` → `HarnessResult`
- Computes everything immediately, returns complete result
- No intermediate access to state between actions

**Runner** — Pull-based, demand-driven:
- `.next(steps)` → `RunnerStepResult[]`
- Hooks can be registered **between steps** (picked up immediately)
- Scene transitions in route mode are transparent (do not consume step tokens)
- Can observe state after any individual action

The Runner is not a thin wrapper around Harness — it maintains a persistent queue, visited set, and action trace across calls.

**Key files:** `packages/ts/scene-runner/src/harness/harness.ts`, `packages/ts/scene-runner/src/runner.ts`

---

### 9. Error Handling: Two Distinct Layers

Errors are handled differently at different layers:

**Graph layer — throws typed errors:**
```typescript
type GraphExecutionError =
  | MissingDependencyError | MissingDefinitionError
  | FunctionExecutionError | EmptySequenceError
  | MissingValueError     | InvalidTreeNodeError
```
Each has a `.kind` discriminant for runtime dispatch. `executeGraphSafe()` wraps these into `{ result?, errors }` for callers that want non-throwing behavior.

**State/prepare layer — returns null values, never throws:**
- Missing hook → `buildNull('missing')`
- Missing state path → `buildNull('not-found')`
- Failed computation → `buildNull('error')`

The boundary is deliberate: **graph errors are programmer errors** (malformed context, type mismatches) and warrant exceptions. **Missing data is a domain concern** and is modeled as typed null values.

**Key file:** `packages/ts/runtime/src/compute-graph/runtime/errors.ts`

---

### 10. Proto Model Encodes Runtime Guarantees

The Go converter makes structural guarantees that the TypeScript runtime relies on without re-checking:

- Bindings in `ProgModel` are **topologically sorted** — dependencies always appear before dependents
- Each `BindingModel` has exactly one of `value` or `expr` set
- Each `ArgModel` has exactly one field set (ref / lit / func_ref / step_ref / transform)
- All function names are in a validated `FN_MAP`
- State field types match their literal defaults

The TypeScript runtime can do a single linear pass through bindings rather than sorting or re-validating. The proto contract is the trust boundary between languages.

**Key file:** `schema/turnout-model.proto`

---

### 11. Scene and Route Execution Models

**Within a scene — queue-based:**
- Actions are executed from a FIFO queue (entry actions seeded initially)
- After each action, next rules evaluate and enqueue subsequent actions
- Visited actions are skipped (cycle prevention)
- Policy is configurable: `first-match` (default) or `all-match`

**Across scenes — history-based pattern matching:**
- Routes match against the **full accumulated execution history** (e.g., `"scene.action"`, `"scene.*.action"`, `"_"`)
- Only the first contiguous appearance of a scene in history is considered (prevents later revisits from affecting routing)
- Enables complex multi-scene workflows where transitions depend on prior decisions

**Key files:** `packages/ts/scene-runner/src/executor/scene-executor.ts`, `packages/ts/scene-runner/src/executor/route-pattern.ts`

---

## Data Flow (End-to-End)

```
.turn DSL
  → Go converter (lex → parse → validate → lower → emit)
  → TurnModel JSON  [proto contract boundary]
  → createRunner(model)
  → For each action:
      Prepare  (from_state / from_hook → bind inputs)
      Compute  (build ExecutionContext → executeGraph → post-order DFS)
      Merge    (write bindings → new StateManager)
      Publish  (fire post-merge hooks, read-only)
      Next     (evaluate conditions → enqueue next actions)
  → Route pattern matching → scene transitions
  → Final HarnessResult
```

---

## Core Design Principles

| Principle | How It Manifests |
|---|---|
| **Fail at the boundary, not inside** | Validation gates (Go converter + `ValidatedContext` brand) — runtime trusts its inputs |
| **Typed absence over implicit undefined** | `NullValue` with reason sub-symbols; no `undefined` in state |
| **Provenance as a first-class concern** | Tag propagation (set union) through all operations, queryable at any output |
| **Two modes for two audiences** | Harness for batch/test; Runner for interactive/debug |
| **ID domains never mix** | Branded types for `FuncId`/`ValueId`/`DefineId` enforced at compile time |
| **Short-circuit only where declared** | `cond` is the only lazy node; all other operations are eager |
| **Topological ordering as a contract** | Converter guarantees sort order; runtime exploits it without re-sorting |
| **Immutability throughout** | Every action write returns new `StateManager`; no in-place mutation |

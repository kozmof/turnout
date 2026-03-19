# Turnout Codebase Analysis

**Date**: 2026-03-20

---

## 1. Code Organization and Structure

The project is a monorepo organized into clearly separated layers:

```
turnout/
├── packages/
│   ├── go/converter/          # Go DSL-to-HCL converter (CLI tool)
│   │   ├── cmd/turnout/       # CLI entry point
│   │   └── internal/          # Lexer, parser, lowering, validation, emit
│   └── ts/                    # TypeScript runtime packages
│       ├── runtime/           # Core compute graph engine
│       └── scene-runner/      # Scene orchestration harness
├── spec/                      # Formal specifications (7 markdown docs)
├── apps/vscode/               # VSCode Turn language syntax plugin
├── report/                    # Analysis and design documents
└── todo/                      # Feature tracking and requirements
```

**Two-phase pipeline**:
1. **Go Converter Phase** — Parses Turn DSL and emits canonical HCL (or JSON).
2. **TypeScript Runtime Phase** — Parses the JSON model and executes scenes and actions.

The separation between converter and runtime is clean: the Go package outputs a `TurnModel` JSON schema that the TypeScript side consumes as a well-typed `ProgModel`.

---

## 2. Relations of Implementations (Types and Interfaces)

### Core Value Type

Defined in [packages/ts/runtime/src/state-control/value.ts](packages/ts/runtime/src/state-control/value.ts):

```typescript
export type Value<T, BaseType, SubType, Tags> = {
  readonly symbol: BaseType;
  readonly value: T;
  readonly subSymbol: SubType;
  readonly tags: Tags;
};
```

- `BaseTypeSymbol`: `'number' | 'string' | 'boolean' | 'array' | 'null'`
- `NullReasonSubSymbol`: `'missing' | 'not-found' | 'error' | 'filtered' | 'redacted' | 'unknown'`
- Tags are read-only tuples propagated through operations using set union semantics.

### Branded Types (ID Safety)

Defined in [packages/ts/runtime/src/util/brand.ts](packages/ts/runtime/src/util/brand.ts):

```typescript
export type Brand<K, T> = K & { __brand: T }

export type ValueId        = Brand<string, 'valueId'>;
export type FuncId         = Brand<string, 'funcId'>;
export type CombineDefineId = Brand<string, 'combineDefineId'>;
export type PipeDefineId   = Brand<string, 'pipeDefineId'>;
export type CondDefineId   = Brand<string, 'condDefineId'>;
```

Zero-cost at runtime; prevents accidental ID mixing at compile time.

### ExecutionContext

Defined in [packages/ts/runtime/src/compute-graph/types.ts](packages/ts/runtime/src/compute-graph/types.ts):

```typescript
export type ExecutionContext = {
  readonly valueTable: Readonly<ValueTable>;
  readonly funcTable: Readonly<FuncTable>;
  readonly combineFuncDefTable: Readonly<CombineFuncDefTable>;
  readonly pipeFuncDefTable: Readonly<PipeFuncDefTable>;
  readonly condFuncDefTable: Readonly<CondFuncDefTable>;
};
```

- `FuncTableEntry` is a discriminated union on `kind: 'combine' | 'pipe' | 'cond'`.
- `ValidatedContext` is a branded wrapper ensuring validation ran before execution.
- `ScopedExecutionContext` extends `ExecutionContext` with a `visibleValueIds` set for pipe-step scoping.

### Scene Model Types

Defined in [packages/ts/scene-runner/src/types/scene-model.ts](packages/ts/scene-runner/src/types/scene-model.ts):

```typescript
export type TurnModel = {
  state?: StateModel;
  scenes: SceneBlock[];
  routes?: RouteModel[];
};

export type ActionModel = {
  id: string;
  compute?: ComputeModel;
  prepare?: PrepareEntry[];
  merge?: MergeEntry[];
  next?: NextRuleModel[];
};

export type ExprModel =
  | { combine: CombineExpr }
  | { pipe: PipeExpr }
  | { cond: CondExpr };
```

`ExprModel` is a discriminated union covering the three function expression kinds. `BindingModel` supports both literal `value` and expression `expr` fields.

---

## 3. Relations of Implementations (Functions)

### Graph Execution Flow

```
executeGraph(rootFuncId, ValidatedContext)
  └─ buildExecutionTree(rootFuncId, context)      → builds DAG of nodes
  └─ executeTree(tree, context)                   → post-order traversal
       ├─ executeCombineFunc(node, context)
       ├─ executePipeFunc(node, context)           → sequential steps w/ scoped visibility
       └─ executeCondFunc(node, context)           → condition branch dispatch
  Returns: ExecutionResult { value, updatedValueTable }
```

All execution functions are pure — no mutations; new `ValueTable` instances returned.

### Action Execution Pipeline

```
executeAction(action, state, hooks)
  1. resolveActionPrepare(entries, state, hooks)
       └─ Maps data sources: from_state | from_hook | from_action | from_literal
  2. buildContextFromProg(prog, preparedValues)
       └─ Translates ProgModel → ExecutionContext
  3. assertValidContext(context)
       └─ Validates all references and types
  4. executeGraph(rootFuncId, context)
       └─ Computes root binding value
  5. Collect all binding values for from_action resolution
  6. mergeState(state, mergeEntries)
       └─ Atomic merge of computed values into STATE
```

### Scene Execution Loop

```
executeScene(scene, state, hooks)
  Loop:
    1. Dequeue action from queue
    2. Cycle guard check
    3. executeAction(action, state, hooks)
    4. Evaluate next rules → find next actions
    5. Enqueue matching next actions
  Returns: SceneExecutionResult { traces, terminationInfo }
```

### Route Execution (Multi-Scene)

```
executeRoute(route, scenes, entrySceneId, state, hooks)
  Loop:
    1. executeScene(currentScene, state, hooks)
    2. Accumulate route history: "sceneId.actionId"
    3. selectNextScene(history, route.match, currentSceneId)
    4. If match found → move to next scene, repeat
    5. If no match → exit route
  Returns: RouteExecutionResult { finalState, traces }
```

STATE persists across scene boundaries within a route.

---

## 4. Specific Contexts and Usages

### Builder API

The high-level builder API in [packages/ts/runtime/src/compute-graph/builder/](packages/ts/runtime/src/compute-graph/builder/) reduces boilerplate:

```typescript
const context = ctx({
  v1: 5,
  v2: 3,
  sum:    combine('binaryFnNumber::add', { a: 'v1', b: 'v2' }),
  result: cond('condition', { then: 'sum', else: 'v2' }),
  seq:    pipe({ x: 'v1', y: 'v2' }, [
            combine('binaryFnNumber::add', { a: 'x', b: 'y' }),
          ]),
});
```

### STATE Management

`StateManager` in [packages/ts/scene-runner/src/state/state-manager.ts](packages/ts/scene-runner/src/state/state-manager.ts) uses dotted-path keys and immutable updates:

```typescript
const s1 = StateManager.from({ 'user.score': 0 });
const s2 = s1.write('user.score', 42);  // s1 unchanged
```

### Harness Entry Point

```typescript
// packages/ts/scene-runner/src/harness/harness.ts
await runHarness(hclFilePath, overrides, hooks);
```

Spawns the Go converter as a subprocess via `bridge.ts`, parses the JSON output, and feeds it to the route/scene executor.

### Validation

```typescript
const result = validateContext(unvalidatedContext);
if (!result.ok) {
  // result.errors contains typed ValidationError[]
}
// result.context is ValidatedContext (branded)
```

---

## 5. Pitfalls

### 5.1 Pipe Visibility Is Implicit

`ScopedExecutionContext.visibleValueIds` is enforced at the execution layer but constructed inside `executePipeFunc`. If the builder API allows binding names that shadow outer values, the scoping constraint may be silently violated or confusingly correct — both equally hard to debug.

### 5.2 Cycle Guard Is Count-Based, Not Graph-Based

The scene executor's cycle guard counts action visits rather than detecting actual structural cycles. A legitimate workflow that visits the same action many times could be incorrectly terminated. Conversely, a true cycle could run many times before being caught.

### 5.3 State Merge Is Unordered Within an Action

`mergeState` applies merge entries from a single action, but if two entries write to the same dotted path, the outcome depends on iteration order of the array — which is not specified by the spec or schema.

### 5.4 Go Converter Spawned As Subprocess

`bridge.ts` spawns the Go binary synchronously via `child_process`. If the binary is missing or crashes mid-run, the error surface is a raw process exit code rather than a typed error. Error recovery is limited.

### 5.5 Tag Propagation Uses Set Union Unconditionally

Tags always accumulate via union. There is no mechanism to drop or reset tags, so values that pass through many operations will accumulate tags without bound. In long-running routes, a value's tag set could become very large.

### 5.6 `from_hook` Has No Schema

`PrepareEntry` supports `from_hook` as a data source, but the hook return type is `AnyValue`. There is no schema validation on hook output, so type mismatches surface only at execution time, not at build/validate time.

---

## 6. Improvement Points — Design Overview

### 6.1 Explicit Pipeline Boundary Contract

The contract between the Go converter and TypeScript runtime is currently a JSON schema embedded in `scene-model.ts`. A shared schema file (e.g., JSON Schema or a protobuf spec) would allow both sides to be validated against the same ground truth, rather than relying on manual alignment.

### 6.2 Route History as a First-Class Type

Route history is currently a `string[]` of `"sceneId.actionId"` tokens. If route patterns become more complex (e.g., wildcards, quantifiers), using a structured type instead of string concatenation would make pattern matching safer and more extensible.

### 6.3 Hook Interface Formalization

Hooks are called with untyped signatures. Defining a formal `HookSpec` type — similar to how `PrepareEntry` is typed — would allow hook implementations to be validated at harness setup time rather than at action execution time.

### 6.4 Observability Layer

Traces are collected but there is no structured emit mechanism (logging, OpenTelemetry, etc.). A pluggable trace sink interface would let users route trace events to their observability stack without modifying executor code.

---

## 7. Improvement Points — Types and Interfaces

### 7.1 `AnyValue` Is a Weak Boundary

`AnyValue` (used in state, hooks, and merge entries) is a broad union type. Narrowing the state value type to match the declared `StateModel` namespace types would catch type mismatches earlier.

### 7.2 `PrepareEntry` Data Source Is a Discriminated Union Without Exhaustiveness

The `PrepareEntry` source field uses string literals but is not structured as a TypeScript discriminated union. Exhaustiveness checking would be lost when new source kinds are added. Refactoring to `{ kind: 'from_state'; path: string } | { kind: 'from_hook'; hookId: string } | ...` would solve this.

### 7.3 `ValidationResult` Warnings Are Unactionable

`ValidationWarning[]` is returned alongside errors, but there is no mechanism in `runHarness` or `executeAction` to surface warnings to callers. Adding a warning callback or surfacing warnings in the trace would make them actionable.

### 7.4 `ScopedExecutionContext` Is an Intersection Type

`ScopedExecutionContext = ExecutionContext & { scope: 'pipe'; visibleValueIds: ... }` uses an intersection. This works but makes it unclear that the scoped variant is only valid during pipe step execution. A nominal wrapper type would make the constraint more explicit.

---

## 8. Improvement Points — Implementations

### 8.1 `buildExecutionTree` Traversal Is Recursive

`buildExecutionTree` in `executeGraph.ts` uses recursive descent. Deep function graphs could cause stack overflows. Converting to an iterative BFS/DFS with an explicit stack would eliminate this risk.

### 8.2 `validateContext` Rebuilds the Type Environment Each Call

`validateContext` builds the full type environment on every call. If the same context is validated multiple times (e.g., in test loops), this is wasted work. Caching the type environment keyed on context identity would improve performance.

### 8.3 `StateManager.write` Clones the Full Record

Every `write()` on `StateManager` performs a shallow clone of the full state record. For large state objects this is O(n) per write. A persistent data structure (e.g., a path-trie) would reduce this to O(log n).

### 8.4 Preset Functions Are Registered by String Key

Binary and transform functions are looked up by string keys (e.g., `'binaryFnNumber::add'`). There is no compile-time registry type, so a typo in a function name only surfaces at runtime. A typed registry object (using `satisfies`) would catch misspellings at build time.

### 8.5 `executePipeFunc` Rebuilds Scoped Context Per Step

Each pipe step constructs a new `ScopedExecutionContext` with an updated `visibleValueIds` set. Sharing the base context and diffing only the visible set would reduce allocations in pipes with many steps.

---

## 9. Learning Paths on Implementations

### Entry: Understanding How Values Flow

1. Start with [packages/ts/runtime/src/state-control/value.ts](packages/ts/runtime/src/state-control/value.ts) — understand `Value<T, BaseType, SubType, Tags>` and the null sub-symbol design.
2. Read [packages/ts/runtime/src/state-control/value-builders.ts](packages/ts/runtime/src/state-control/value-builders.ts) — see how typed values are constructed with tag propagation.
3. Read any file under [packages/ts/runtime/src/state-control/preset-funcs/number/](packages/ts/runtime/src/state-control/preset-funcs/number/) — see how binary operations combine two values and merge their tags.

### Entry: Understanding the Compute Graph

1. Read [packages/ts/runtime/src/compute-graph/types.ts](packages/ts/runtime/src/compute-graph/types.ts) — understand `ExecutionContext` and `FuncTableEntry`.
2. Read [packages/ts/runtime/src/compute-graph/builder/context.ts](packages/ts/runtime/src/compute-graph/builder/context.ts) — see how the builder API constructs an `ExecutionContext`.
3. Read [packages/ts/runtime/src/compute-graph/runtime/exec/executeGraph.ts](packages/ts/runtime/src/compute-graph/runtime/exec/executeGraph.ts) — trace the execution from root function to final value.

**Goal**: Be able to manually construct an `ExecutionContext`, validate it, and execute it, interpreting the `ExecutionResult`.

### Entry: Understanding Scene and Route Execution

1. Read [packages/ts/scene-runner/src/types/scene-model.ts](packages/ts/scene-runner/src/types/scene-model.ts) — understand `TurnModel`, `SceneBlock`, and `ActionModel`.
2. Read [packages/ts/scene-runner/src/executor/action-executor.ts](packages/ts/scene-runner/src/executor/action-executor.ts) — trace the 5-phase action execution.
3. Read [packages/ts/scene-runner/src/executor/scene-executor.ts](packages/ts/scene-runner/src/executor/scene-executor.ts) — see how actions are queued and dispatched within a scene.
4. Read [packages/ts/scene-runner/src/executor/route-executor.ts](packages/ts/scene-runner/src/executor/route-executor.ts) — see how multiple scenes are chained with shared STATE.

**Goal**: Be able to write a `.hcl` fixture, convert it to JSON, and trace through the executor to predict the final state.

### Entry: Understanding Validation

1. Read [packages/ts/runtime/src/compute-graph/runtime/validateContext.ts](packages/ts/runtime/src/compute-graph/runtime/validateContext.ts) — understand the `ValidationResult` discriminated union and what is checked.
2. Read [packages/ts/runtime/src/compute-graph/runtime/typeInference.ts](packages/ts/runtime/src/compute-graph/runtime/typeInference.ts) — see how types are inferred for all function kinds.

**Goal**: Be able to predict whether a given `ExecutionContext` will pass validation and why.

---

## Summary

Turnout is a well-structured, type-safe workflow orchestration system. Its core strengths are immutable execution, branded ID types, and a clean three-layer architecture (state-control → compute-graph → scene-runner). The main areas for improvement are around operational robustness (cycle detection, merge ordering, hook typing) and performance at scale (recursive tree traversal, full-record state cloning). The learning path is well-supported by clear module boundaries and a builder API that makes the runtime accessible without deep knowledge of the internal graph representation.

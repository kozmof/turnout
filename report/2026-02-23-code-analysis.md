# Code Analysis Report — Turnout

**Date:** 2026-02-23
**Project:** Turnout — TypeScript Computation Graph Execution Engine
**Stack:** TypeScript 5.9.2 · Valibot 1.1.0 · Vitest 3.0.7 · Vite 6.2.0

---

## 1. Code Organization and Structure

### Directory Layout

```
src/
├── index.ts                         # Public API entry point (~60 exports)
├── flatKV.ts                        # Nested key-value flattening utilities
├── compute-graph/                   # Core DAG execution engine
│   ├── types.ts                     # Domain types (ExecutionContext, FuncTable, …)
│   ├── idValidation.ts              # Branded ID validation and creation
│   ├── builder/                     # High-level DSL (ctx, combine, pipe, cond)
│   └── runtime/                     # Execution engine
│       ├── exec/                    # Per-node executors
│       ├── buildExecutionTree.ts    # DAG → tree compilation
│       ├── executeTree.ts           # Post-order traversal
│       ├── validateContext.ts       # Context validation
│       └── typeInference.ts        # Function signature lookup
├── state-control/                   # Value system
│   ├── value.ts                     # Core Value<T, …> type
│   ├── value-builders.ts            # Value construction with tag merging
│   ├── meta-chain/                  # Type metadata for operations
│   └── preset-funcs/                # Built-in binary and transform functions
└── util/                            # General utilities
    ├── brand.ts                     # Branded type helper
    ├── constants.ts                 # NAMESPACE_DELIMITER ('::')
    ├── idGenerator.ts               # Crypto-random ID generation
    └── splitPair.ts                 # Namespaced name parsing
```

### Layering

```
util → state-control → compute-graph/runtime → compute-graph/builder → index
```

Each layer has a single responsibility and depends only on layers below it. The public API surface is fully consolidated in `src/index.ts`.

### Assessment

- **Strengths:** Clean separation of building, validation, and execution. Each concern lives in its own module, and layers only import downward.
- **Concerns:** `compute-graph/builder/` and `compute-graph/runtime/` share no internal utility layer; some logic (e.g. ID resolution) is replicated.

---

## 2. Relations of Implementations — Types and Interfaces

### Value Type Hierarchy

```
Value<T, BaseType, SubType, Tags>
  ├── NumberValue     = Value<number,    'number',  undefined>
  ├── StringValue     = Value<string,    'string',  undefined>
  ├── BooleanValue    = Value<boolean,   'boolean', undefined>
  ├── NullValue       = Value<null,      'null',    NullReasonSubSymbol>
  └── AnyArrayValue   = Value<AnyValue[], 'array',  ArrayElemSubSymbol>
AnyValue = NumberValue | StringValue | BooleanValue | NullValue | AnyArrayValue
```

### Execution Context Types

```
ExecutionContext
  ├── valueTable:         { [ValueId]: AnyValue }
  ├── funcTable:          { [FuncId]: FuncTableEntry }
  │   └── FuncTableEntry (discriminated union)
  │       ├── kind: 'combine'  → CombineDefineId + argMap + returnId
  │       ├── kind: 'pipe'     → PipeDefineId    + argMap + returnId
  │       └── kind: 'cond'     → CondDefineId    + returnId
  ├── combineFuncDefTable: { [CombineDefineId]: CombineFuncDef }
  ├── pipeFuncDefTable:    { [PipeDefineId]:    PipeFuncDef }
  └── condFuncDefTable:    { [CondDefineId]:    CondFuncDef }

ScopedExecutionContext extends ExecutionContext
  └── scope: 'pipe' + visibleValueIds: ReadonlySet<ValueId>
```

### Branded ID Types

```
Brand<string, 'valueId'>          → ValueId   (prefix: v_)
Brand<string, 'funcId'>           → FuncId    (prefix: f_)
Brand<string, 'combineDefineId'>  → CombineDefineId
Brand<string, 'pipeDefineId'>     → PipeDefineId
Brand<string, 'condDefineId'>     → CondDefineId
```

### Validation Result Types

```
ValidationResult (discriminated union)
  ├── { ok: true;  context: ValidatedContext }
  └── { ok: false; errors: ValidationError[]; warnings: ValidationWarning[] }

ValidatedContext = Brand<ExecutionContext, 'validatedContext'>
```

### Assessment

- **Strengths:** Deep use of discriminated unions and branded types prevents entire categories of runtime errors at compile time. The `Tags` tuple type on `Value` enables fine-grained provenance tracking.
- **Concerns:** `AnyValue` is a flat union; adding a new primitive type requires updates in many places (type guards, preset functions, meta-chains, schemas).

---

## 3. Relations of Implementations — Functions

### Execution Call Graph

```
executeGraph(rootFuncId, context)
  └── buildExecutionTree(rootFuncId, context)   →  ExecutionTree
        └── (recursive DAG → tree compilation, memoizes shared nodes)
  └── executeTree(tree, context)
        └── executeTreeInternal(node, context, tableState)
              ├── ValueNode       → return cached value
              ├── FunctionNode    → execute children first (post-order)
              │     ├── executeCombineFunc(def, argValues, tableState)
              │     │     └── applyTransforms → binaryFn → build result
              │     ├── executePipeFunc(def, argValues, tableState)
              │     │     └── iterate steps, threading valueTable state
              │     └── executeCondFunc(def, condValue, tableState)
              │           └── pick branch → execute branch recursively
              └── ConditionalNode → evaluate condition → branch execution
```

### Builder-to-Runtime Translation

```
ctx(spec)
  └── ContextBuilder
        ├── val.number / val.string / val.boolean → ValueTable entries
        ├── combine(name, args)  → CombineFuncDef + FuncTableEntry
        ├── pipe(args, steps)    → PipeFuncDef    + FuncTableEntry
        └── cond(cond, branches) → CondFuncDef    + FuncTableEntry
  └── BuildResult { ids, exec: ExecutionContext }
```

### Validation Pipeline

```
validateContext(context)
  ├── validate valueTable entries (schema)
  ├── validate funcTable references → combineFuncDef / pipeFuncDef / condFuncDef
  ├── validate argument types via typeInference(funcId, context)
  ├── check cycle detection across the DAG
  └── return ValidationResult (ok / errors+warnings)
```

### Assessment

- **Strengths:** The separation of compilation (`buildExecutionTree`) from execution (`executeTree`) enables future optimizations (caching compiled trees). Post-order traversal is a clean, correct strategy for DAGs.
- **Concerns:** `executePipeFunc` threads mutable `tableState` through steps via reassignment; while the outer API is immutable, internal mutation could be surprising when debugging.

---

## 4. Specific Contexts and Usages

### Builder API Usage

```typescript
// Primitive values
const { ids, exec } = ctx({ a: 5, b: 3 });

// Tagged values (provenance tracking)
ctx({ v: val.number(42, ['random', 'external-api']) });

// Binary operation
ctx({
  x: 5, y: 3,
  sum: combine('binaryFnNumber::add', { a: 'x', b: 'y' }),
});

// Sequential pipeline
ctx({
  x: 10, y: 5,
  result: pipe(
    { x: ref.value('x'), y: ref.value('y') },
    [
      combine('binaryFnNumber::add',      { a: 'x', b: 'y' }),
      combine('binaryFnNumber::multiply', { a: ref.output('step0'), b: 'x' }),
    ]
  ),
});

// Conditional branching
ctx({
  flag: true,
  thenOp: combine('binaryFnNumber::add',      { a: 'v1', b: 'v2' }),
  elseOp: combine('binaryFnNumber::multiply', { a: 'v1', b: 'v2' }),
  result: cond('flag', { then: 'thenOp', else: 'elseOp' }),
});
```

### Execution

```typescript
const validated = assertValidContext(exec);       // throws if invalid
const { value, updatedValueTable } = executeGraph(ids.result, validated);

// Safe variant
const { result, errors } = executeGraphSafe(ids.result, validated);
```

### Preset Function Namespace Pattern

```
binaryFnNumber::add          binaryFnString::concat
binaryFnBoolean::and         binaryFnArray::intersect
binaryFnGeneric::equals      transformFnNumber::toStr
transformFnArray::flatten    transformFnNull::pass
```

---

## 5. Pitfalls

| # | Location | Description |
|---|----------|-------------|
| 1 | `executePipeFunc.ts` | Internal step state is accumulated via reassignment (`let tableState = …`). Although the external contract is immutable, this imperative pattern can cause confusion if pipe steps share mutable references inside `AnyValue`. |
| 2 | `buildExecutionTree.ts` | Cycle detection relies on visitation during tree construction. If the detection logic has an edge-case bug, it would silently produce an infinite recursion at runtime rather than a clear error. |
| 3 | `types.ts` (FuncTableEntry) | `argMap` keys are plain `string`, not branded. A misspelled arg key would compile successfully but silently fail at execution. |
| 4 | `typeInference.ts` | Function type metadata is stored in separate meta-tables and looked up by string namespace prefix. Any inconsistency between a registered function name and its meta entry is only caught at validation time, not at registration time. |
| 5 | `preset-funcs` (array ops) | `intersect`, `union`, `difference` use deep equality comparison. For nested `AnyValue[]` arrays, performance degrades quadratically and correctness depends on referential or structural equality strategy not explicitly documented. |
| 6 | `value.ts` (Tags tuple) | Tags are `readonly TagSymbol[]` tuples accumulated via union. A very long computation chain could accumulate a large tag tuple, increasing memory pressure on deeply nested graphs. |
| 7 | `idValidation.ts` | ID prefixes (`v_`, `f_`) are validated at parse time but are human-readable strings, not cryptographically verified. IDs from different contexts can be mixed without error if the prefix matches. |
| 8 | `builder/context.ts` | The builder accepts raw `null` as a value shorthand, but the resulting `NullValue` requires a `subSymbol` for null reason. The default null reason semantics may not be obvious to callers. |

---

## 6. Improvement Points — Design Overview

### 6.1 Compiled Graph Caching

`buildExecutionTree` is called on every `executeGraph` invocation, even for identical `ExecutionContext` values. Since the context is immutable, the compiled tree could be memoized (keyed by context identity or a stable hash) to avoid re-compilation on repeated executions.

### 6.2 Streaming / Incremental Execution

Currently, the entire DAG is evaluated synchronously. For large graphs or async data sources (tagged `'network'`, `'io'`), an async execution model (returning `Promise<ExecutionResult>`) would be a natural extension without breaking the current synchronous API.

### 6.3 Custom Function Registration

The preset function set is closed at compile time. Providing a typed registration mechanism for user-defined binary and transform functions (with corresponding meta entries) would make the system far more general-purpose.

### 6.4 Graph Visualization / Introspection

There is no built-in facility for serializing or visualizing the execution graph. An `exportGraph(context)` utility returning a standard format (e.g. DOT, JSON adjacency list) would aid debugging and documentation.

### 6.5 Partial / Incremental Evaluation

The `updatedValueTable` returned from execution includes all computed values but requires re-executing the full graph to update a single upstream value. A dependency-tracking mechanism could enable partial re-evaluation (à la reactive spreadsheet model).

---

## 7. Improvement Points — Types and Interfaces

### 7.1 Branded `argMap` Keys

```typescript
// Current
argMap: { [argName: string]: ValueId }

// Improved
type ArgName = Brand<string, 'argName'>
argMap: { [argName: ArgName]: ValueId }
```

Prevents silent key mismatches between definition and call sites.

### 7.2 Exhaustive Tag Union

`TagSymbol` is currently a string alias. Converting it to a string literal union of known tags would catch typos at compile time and enable autocomplete:

```typescript
type TagSymbol = 'random' | 'network' | 'cached' | 'io' | 'user-input' | 'external-api';
```

### 7.3 Generic `PipeArgBinding` Source Discrimination

The `source: 'step'` binding uses a plain `stepIndex: number`. An out-of-range index is only caught at runtime. Encoding step references as branded types or validating against the pipe's step count at build time would shift this error earlier.

### 7.4 Covariant `Tags` on `Value`

Tag propagation results in union of parent tags. This grows unboundedly. Capping tags at a maximum depth or using a `Set` representation instead of a tuple could reduce type complexity for deep graphs.

### 7.5 `ScopedExecutionContext` Clarity

`ScopedExecutionContext` extends `ExecutionContext` with a discriminant field (`scope: 'pipe'`). However, functions accepting `ExecutionContext` can accidentally receive a scoped context without awareness of visibility restrictions. A more explicit parameter type (accepting `ExecutionContext | ScopedExecutionContext`) with explicit narrowing at call sites would make scoping more visible.

---

## 8. Improvement Points — Implementations

### 8.1 Eliminate Internal Mutation in `executePipeFunc`

Replace the mutable accumulator pattern with a `reduce` over steps:

```typescript
// Current (simplified)
let tableState = initialTable;
for (const step of steps) {
  const result = executeStep(step, tableState);
  tableState = result.updatedValueTable;
}

// Improved
const finalTable = steps.reduce(
  (tableState, step) => executeStep(step, tableState).updatedValueTable,
  initialTable
);
```

This makes the data flow explicit and eliminates the mutable `let`.

### 8.2 Validate Arg Keys at Build Time

In `builder/context.ts`, when resolving `combine` arg references, assert that all referenced keys exist in the current builder scope and emit a `BuildError` rather than deferring to validation:

```typescript
for (const [argName, ref] of Object.entries(args)) {
  if (!builderScope.has(ref)) throw createUndefinedValueReferenceError(ref);
}
```

### 8.3 `typeInference` Lookup Table Performance

Currently, `typeInference` performs string prefix matching to resolve namespaces. For large function tables, a pre-built `Map<FuncId, TypeMetadata>` indexed at context build time would improve lookup from O(n) to O(1).

### 8.4 Array Operation Equality Semantics

Document and standardize equality for `intersect`, `union`, `difference`. Either use `JSON.stringify` for structural equality or a configurable comparator:

```typescript
type EqualityComparator = (a: AnyValue, b: AnyValue) => boolean;
const defaultComparator: EqualityComparator = (a, b) => JSON.stringify(a) === JSON.stringify(b);
```

### 8.5 Error Messages Enrichment

Execution errors (`MissingDependencyError`, `FunctionExecutionError`, etc.) include IDs but not human-readable names. Since the `ExecutionContext` is available at the call site, augmenting error messages with the corresponding value or function names from the tables would greatly aid debugging.

---

## 9. Learning Paths on Implementations

### Entry Points

| Goal | Start Here |
|------|-----------|
| Understand the value model | `src/state-control/value.ts` → `value-builders.ts` |
| Write a computation graph | `src/compute-graph/builder/context.ts` → `builder/functions.ts` |
| Understand execution flow | `src/compute-graph/runtime/exec/executeGraph.ts` → `executeTree.ts` |
| Understand graph compilation | `src/compute-graph/runtime/buildExecutionTree.ts` |
| Understand validation | `src/compute-graph/runtime/validateContext.ts` → `typeInference.ts` |
| Add a new preset function | `src/state-control/preset-funcs/{type}/binaryFn.ts` + meta-chain entry |
| Understand branded types | `src/util/brand.ts` → `src/compute-graph/idValidation.ts` |
| Understand tag propagation | `src/state-control/value-builders.ts` → `src/state-control/meta-chain/` |

### Recommended Reading Order

1. `src/util/brand.ts` — understand the core generic pattern used throughout
2. `src/state-control/value.ts` — learn the fundamental data unit
3. `src/compute-graph/types.ts` — learn the full domain model
4. `src/compute-graph/builder/context.ts` — see how the DSL assembles a context
5. `src/compute-graph/runtime/validateContext.ts` — understand the safety net
6. `src/compute-graph/runtime/buildExecutionTree.ts` — DAG compilation
7. `src/compute-graph/runtime/exec/executeGraph.ts` — top-level execution
8. `src/compute-graph/runtime/exec/executePipeFunc.ts` — most complex executor
9. Test files — concrete examples of all major scenarios

### Learning Goals by Role

**Library Consumer:** Read builder API (`context.ts`, `functions.ts`, `values.ts`) and the public `index.ts` exports. Focus on `ctx()`, `combine()`, `pipe()`, `cond()`, `val`, `ref`, `executeGraph()`, `validateContext()`.

**Library Contributor:** After the consumer path, study `types.ts`, `validateContext.ts`, `typeInference.ts`, and the preset function structure before adding new functions or modifying the execution model.

**Architecture Reviewer:** Focus on the layering between `state-control/`, `runtime/`, and `builder/`, and the branded-type + discriminated-union patterns that enforce correctness at compile time.

---

## Summary

Turnout is a well-architected, type-safe computation graph engine. Its strongest qualities are its disciplined use of TypeScript's type system (branded types, discriminated unions, readonly modifiers), clean layer separation, and immutable execution model. The primary improvement areas are: shifting more error detection to build time (arg key branding, step index validation), enabling extensibility (custom function registration, async execution), and hardening internal implementation consistency (eliminating internal mutation, standardizing array equality semantics).

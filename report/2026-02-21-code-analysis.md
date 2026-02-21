# Turnout — Code Analysis Report

**Date:** 2026-02-21
**Stack:** TypeScript, Vite, Vitest, Valibot

---

## 1. Code Organization and Structure

### Directory Layout

```
src/
├── flatKV.ts                          # Generic nested key-value store utility
├── state-control/                     # Core value type system
│   ├── value.ts                       # Value<T,BaseType,SubType,Tags> definition
│   ├── value-builders.ts              # Value construction helpers (buildNumber, etc.)
│   ├── errors.ts                      # InvalidValueError type
│   ├── preset-funcs/                  # Preset function implementations
│   │   ├── number/                    # binaryFn, transformFn for numbers
│   │   ├── string/                    # binaryFn, transformFn for strings
│   │   ├── array/                     # binaryFn, transformFn for arrays
│   │   ├── generic/                   # isEqual (cross-type)
│   │   ├── convert.ts                 # Conversion type aliases
│   │   └── util/
│   │       ├── isComparable.ts        # Runtime type comparability check
│   │       └── propagateTags.ts       # Tag propagation utility
│   └── meta-chain/                    # Type-level metadata for function signatures
│       ├── types.ts                   # ElemType (marked "Maybe deprecated")
│       ├── binary-fn/                 # metaReturn, metaParams for binary fns
│       └── transform-fn/              # metaReturn for transform fns
└── compute-graph/                        # Computation graph engine
    ├── types.ts                       # ExecutionContext + all table types
    ├── index.ts                       # Public API re-exports
    ├── idValidation.ts                # Branded ID creators + table-based guards
    ├── literal-schema/                # Valibot schema: function name literals
    ├── builder/                       # High-level declarative builder API
    │   ├── context.ts                 # ctx() — Phase 1/2/3 context construction
    │   ├── functions.ts               # combine(), pipe(), cond() builders
    │   ├── values.ts                  # val, ref helpers
    │   ├── types.ts                   # Builder type definitions
    │   └── errors.ts                  # Builder validation errors
    └── runtime/
        ├── buildExecutionTree.ts      # DAG → ExecutionTree construction
        ├── executeTree.ts             # Post-order tree traversal executor
        ├── typeInference.ts           # Static return-type inference
        ├── validateContext.ts         # Single-pass context validator
        ├── tree-types.ts              # ValueNode / FunctionNode / ConditionalNode
        ├── errors.ts                  # GraphExecutionError discriminated union
        └── exec/
            ├── executeGraph.ts        # Public entry: executeGraph / executeGraphSafe
            ├── executeCombineFunc.ts  # Binary function execution
            ├── executePipeFunc.ts     # Sequential pipeline execution
            └── executeCondFunc.ts     # Conditional branch execution
```

### Layering

```
Builder API (compute-graph/builder/)
        ↓  produces
ExecutionContext (compute-graph/types.ts)
        ↓  validated by
validateContext (runtime/validateContext.ts)
        ↓  transformed into
ExecutionTree (runtime/buildExecutionTree.ts)
        ↓  evaluated by
executeTree → executeCombineFunc / executePipeFunc / executeCondFunc
        ↓  using
preset-funcs (state-control/preset-funcs/)
        ↓  operating on
Value<T, ...> (state-control/value.ts)
```

---

## 2. Relations of Implementations — Types and Interfaces

### Core Value Hierarchy

```
Value<T, BaseType, SubType, Tags>
  ├── NumberValue<Tags>           symbol='number', value: number, subSymbol: undefined
  ├── StringValue<Tags>           symbol='string', value: string, subSymbol: undefined
  ├── BooleanValue<Tags>          symbol='boolean', value: boolean, subSymbol: undefined
  ├── ArrayValue<Tags>            symbol='array', subSymbol: undefined  (untyped)
  ├── ArrayNumberValue<Tags>      symbol='array', subSymbol: 'number'
  ├── ArrayStringValue<Tags>      symbol='array', subSymbol: 'string'
  └── ArrayBooleanValue<Tags>     symbol='array', subSymbol: 'boolean'

AnyValue = NumberValue | StringValue | BooleanValue | ArrayValue | Array*Value
UnknownValue = Value<unknown, BaseTypeSymbol, BaseTypeSubSymbol, readonly TagSymbol[]>
```

### ID Type Hierarchy (Branded Types)

All IDs are `Brand<string, T>` — nominal wrappers around strings:

```
ValueId        = Brand<string, 'valueId'>
FuncId         = Brand<string, 'funcId'>
CombineDefineId = Brand<string, 'combineDefineId'>
PipeDefineId   = Brand<string, 'pipeDefineId'>
CondDefineId   = Brand<string, 'condDefineId'>
InterfaceArgId = Brand<string, 'interfaceArgId'>
```

### ExecutionContext Tables

```typescript
ExecutionContext = {
  valueTable:          { [id: ValueId]:           AnyValue }
  funcTable:           { [id: FuncId]:            { defId, argMap, returnId } }
  combineFuncDefTable: { [id: CombineDefineId]:   { name, transformFn, args } }
  pipeFuncDefTable:    { [id: PipeDefineId]:       { args, sequence } }
  condFuncDefTable:    { [id: CondDefineId]:       { conditionId, trueBranchId, falseBranchId } }
  returnIdToFuncId?:   ReadonlyMap<ValueId, FuncId>   // optional perf cache
}
```

### Function Name Type System

Function names are template literal types:

```typescript
BinaryFnNames =
  | `binaryFnNumber::${keyof BinaryFnNumber}`    // add, minus, multiply, divide
  | `binaryFnString::${keyof BinaryFnString}`    // concat
  | `binaryFnArray::${keyof BinaryFnArray}`      // includes, get
  | `binaryFnGeneric::${keyof BinaryFnGeneric}`  // isEqual

TransformFnNames =
  | `transformFnNumber::${keyof TransformFnNumber}`  // pass, toStr
  | `transformFnString::${keyof TransformFnString}`  // pass, ...
  | `transformFnArray::${keyof TransformFnArray}`    // pass, ...
```

### ExecutionTree Discriminated Union

```typescript
ExecutionTree = ValueNode | FunctionNode | ConditionalNode
  ValueNode:       { nodeType: 'value',       nodeId: ValueId, value: AnyValue }
  FunctionNode:    { nodeType: 'function',    nodeId: FuncId, funcDef: CombineDefineId|PipeDefineId, children? }
  ConditionalNode: { nodeType: 'conditional', nodeId: FuncId, funcDef: CondDefineId,
                     conditionTree, trueBranchTree, falseBranchTree }
```

---

## 3. Relations of Implementations — Functions

### Execution Flow

```
executeGraph(rootFuncId, context)
  → validateContext(context)          [optional, single-pass]
  → buildExecutionTree(rootFuncId, context)
      → (recursive) builds DAG into ExecutionTree
      → checks returnIdToFuncId for pre-computed map
  → executeTree(tree, context)
      → ValueNode:       returns value as-is
      → ConditionalNode: evaluates condition, executes one branch, calls executeCondFunc
      → FunctionNode:    post-order children first, then dispatches to:
          → executeCombineFunc(funcId, defId, context)
              → getTransformFn(name)(valA) → getTransformFn(name)(valB) → getBinaryFn(name)(A, B)
          → executePipeFunc(funcId, defId, context)
              → creates scoped ValueTable from arg bindings
              → iterates sequence steps, threading state
              → dispatches each step to executeCombineFunc or executePipeFunc (recursive)
```

### Builder Phases

```
ctx(spec)
  Phase 1: collectValues(spec)         → valueTable: Record<string, AnyValue>
  Phase 2: processFunctions(spec, ...) → funcTable, *DefTables (via processFunction dispatch)
      processFunction → processCombineFunc | processPipeFunc | processCondFunc
  Phase 3: buildExecutionContext(...)  → ExecutionContext
  +        buildIdMap(spec)            → typed {[key]: FuncId | ValueId}
```

### Tag Propagation Path

```
Binary op: binaryNumberOp(op, a, b) → buildNumber(op(a.value, b.value), mergeTags(a, b))
Transform: unaryNumberOp(fn, src)   → buildNumber(fn(src.value), src.tags)
Convert:   convertValue(fn, src, builder) → builder(fn(src.value), src.tags)
```

---

## 4. Specific Contexts and Usages

### Builder API Usage Pattern

```typescript
import { ctx, combine, pipe, cond, ref, val } from './compute-graph/builder';
import { executeGraph } from './compute-graph';

const context = ctx({
  v1: 5,                          // auto-wrapped → NumberValue
  v2: 3,
  flag: true,

  // CombineFunc (binary operation)
  sum: combine('binaryFnNumber::add', { a: 'v1', b: 'v2' }),

  // PipeFunc (sequential pipeline)
  compute: pipe(
    { x: 'v1', y: 'v2' },        // arg bindings: name → value key
    [
      combine('binaryFnNumber::multiply', { a: 'x', b: 'y' }),
      combine('binaryFnNumber::add', {
        a: ref.step('compute', 0), // output of step 0
        b: 'x'
      }),
    ]
  ),

  // CondFunc (conditional branch)
  result: cond('flag', { then: 'sum', else: 'compute' }),
});

const { value } = executeGraph(context.ids.result, context.exec);
```

### Manual ExecutionContext Construction

For low-level control:
```typescript
import { createValueId, createFuncId, createCombineDefineId } from './compute-graph/idValidation';

const context: ExecutionContext = {
  valueTable: { [createValueId('v1')]: buildNumber(5) },
  funcTable: { [createFuncId('f1')]: { defId: defId, argMap: {...}, returnId: retId } },
  combineFuncDefTable: { [defId]: { name: 'binaryFnNumber::add', transformFn: {...}, args: {...} } },
  pipeFuncDefTable: {},
  condFuncDefTable: {},
};
```

### Validation Usage

```typescript
import { validateContext, assertValidContext } from './compute-graph';

// Non-throwing — returns ValidationResult discriminated union
const result = validateContext(context);
if (!result.valid) {
  result.errors.forEach(e => console.error(e.message));
}

// Throwing assertion
assertValidContext(context); // throws if invalid
```

---

## 5. Pitfalls

### P-1: IdGenerator requires initialization before use

**File:** [src/util/idGenerator.ts](../src/util/idGenerator.ts)
**File:** [src/compute-graph/builder/context.ts](../src/compute-graph/builder/context.ts#L62-L69)

`IdGenerator` uses module-level mutable variables that must be populated by `initializeIdGenerator()`. This call is made as a side effect when `context.ts` is imported. If `executePipeFunc.ts` or `idValidation.ts` is imported in isolation (e.g. in tests that skip the builder), and `IdGenerator.generate*Id()` is called, it will throw a runtime error with the message `"IdGenerator not initialized"`. This pattern is fragile.

### P-2: `propagateTags` is defined but unused in preset functions

**File:** [src/state-control/preset-funcs/util/propagateTags.ts](../src/state-control/preset-funcs/util/propagateTags.ts)

`propagateTags` is exported and well-documented, but none of the actual preset functions (`bfNumber`, `bfString`, etc.) import it. All binary operations use `binaryNumberOp` / `binaryBooleanOp` etc. from `value-builders.ts`, which call the internal `mergeTags` function. The exported `propagateTags` and the internal `mergeTags` are functionally equivalent but maintained separately — a duplication risk.

### P-3: Boolean values have no dedicated transform namespace

**File:** [src/compute-graph/builder/context.ts:172-176](../src/compute-graph/builder/context.ts#L172-L176)

`getPassTransformFn('boolean')` returns `transformFnNumber::pass`, which is a number transform applied to a boolean. This works at runtime because `pass` is identity, but it means type validation in `validateContext` may flag boolean values as type mismatches when paired with `transformFnNumber::pass`, since the transform expects a number input.

### P-4: `inferPassTransform` for `StepOutputRef` defaults to `'number'`

**File:** [src/compute-graph/builder/context.ts:1030-1035](../src/compute-graph/builder/context.ts#L1030-L1035)

```typescript
// TODO: Properly track step output types
return getPassTransformFn('number');
```

When a step output is referenced by another function in the same `combine()` call (via `ref.step()`), the transform function is always inferred as `transformFnNumber::pass`, even if the step produces a string or boolean. This causes silent type mismatch if the step produces a non-number.

### P-5: Error type guards are too broad

**Files:**
- [src/state-control/errors.ts:52-60](../src/state-control/errors.ts#L52-L60)
- [src/compute-graph/runtime/errors.ts:156-164](../src/compute-graph/runtime/errors.ts#L156-L164)
- [src/compute-graph/builder/errors.ts:155-163](../src/compute-graph/builder/errors.ts#L155-L163)

All three type guards (`isValueBuilderError`, `isGraphExecutionError`, `isBuilderValidationError`) only check:
```typescript
error instanceof Error && 'kind' in error && typeof error.kind === 'string'
```
Any `Error` subclass with a string `kind` property (from any library) would match. They do not check `kind` is a member of the expected discriminated union.

### P-6: `CondFunc` within `PipeFunc` is not implemented

**File:** [src/compute-graph/runtime/exec/executePipeFunc.ts:200-204](../src/compute-graph/runtime/exec/executePipeFunc.ts#L200-L204)

```typescript
} else if (isCondDefineId(defId, scopedContext.condFuncDefTable)) {
  throw new Error(
    `CondFunc execution within PipeFunc is not yet implemented...`
  );
}
```

A pipeline step cannot reference a `CondFunc` definition. This is a known gap, but there is no type-level enforcement preventing users from constructing such a configuration.

### P-7: `kvUpdate` throws an empty `Error`

**File:** [src/flatKV.ts:68](../src/flatKV.ts#L68)

```typescript
throw new Error();  // no message
```

This makes debugging nested KV update failures very hard. The error provides no context about which key path triggered the exception.

### P-8: `meta-chain/types.ts` is marked as deprecated

**File:** [src/state-control/meta-chain/types.ts](../src/state-control/meta-chain/types.ts)

The `// Maybe deprecated` comment at the top indicates this file may be dead code. `ElemType` is only re-exported and consumed by `metaReturn.ts` in the same directory. If `getResultType.ts` files are also unused (they exist but are not imported by the main codebase), they represent orphaned code.

### P-9: `PipeArg.type` field is never used at runtime

**File:** [src/compute-graph/builder/functions.ts:66](../src/compute-graph/builder/functions.ts#L66)

```typescript
const inferredArgs: PipeArg[] = Object.keys(argBindings).map(name => ({
  name,
  type: 'number' as const, // Default (unused at runtime anyway)
}));
```

`PipeArg.type` exists in the type definition but is hardcoded to `'number'` and never read during execution. The field is extraneous in the current design.

### P-10: `validateContext` ordering affects accuracy

**File:** [src/compute-graph/runtime/validateContext.ts:906-930](../src/compute-graph/runtime/validateContext.ts#L906-L930)

The single-pass algorithm validates `funcTable` entries first, then `combineFuncDefTable`. A `funcEntry` referencing a `defId` is checked via `defineIdExistsInContext`, but the `referencedDefs` set (used to generate "never used" warnings) is populated during the funcTable pass. If a `combineFuncDef` is added in the `combineFuncDefTable` pass after the funcTable pass, it will appear as unreferenced even if it is referenced.

---

## 6. Improvement Points — Design Overview

### D-1: No top-level `src/index.ts`

There is no consolidated public API entry point at `src/`. The `compute-graph/index.ts` exports runtime functions, but `state-control` types and utilities have no unified export. Users must reach into internal paths.

**Recommendation:** Add `src/index.ts` re-exporting the intended public surface: `Value` types, `buildNumber`/`buildString`/etc., `executeGraph`, builder functions, and validation utilities.

### D-2: `flatKV.ts` is architecturally disconnected

`flatKV.ts` is a generic nested key-value store. No file in `compute-graph/` or `state-control/` imports it. It seems like a utility that was planned for or came from a previous iteration but is no longer used in the main engine.

**Recommendation:** If unused, remove to reduce dead code. If planned for future use, document the intent.

### D-3: `IdGenerator` initialization pattern

The current pattern (module side-effect in `context.ts`) creates an implicit dependency ordering. Any module that calls `IdGenerator.generate*Id()` without first importing `context.ts` will fail at runtime.

**Recommendation:** Remove the initialization indirection. Since the branded ID creators (`createValueId`, etc.) are simple casts, `IdGenerator` can import them directly without circular dependency by inverting the dependency — having `idGenerator.ts` import from `idValidation.ts`.

### D-4: `propagateTags` vs `mergeTags` duplication

Two implementations of tag union logic exist:
- `propagateTags` in `src/state-control/preset-funcs/util/propagateTags.ts` (public, accepts nullable `b`)
- `mergeTags` in `src/state-control/value-builders.ts` (private, variadic)

**Recommendation:** Consolidate to one utility. `value-builders.ts` already owns the tag-merge logic used by all builders; `propagateTags` can either be removed or made to delegate.

### D-5: No `src/` root module entry point in `package.json`

`package.json` has `"main": "index.js"` but there is no `index.ts` at the project root and no build step configured. The project is currently test-only with no emit target.

---

## 7. Improvement Points — Types and Interfaces

### T-1: `isValueBuilderError` / `isGraphExecutionError` / `isBuilderValidationError` need stronger discrimination

All three guards should narrow to the specific `kind` values of their respective unions:

```typescript
// Current (too broad):
error instanceof Error && 'kind' in error && typeof error.kind === 'string'

// Recommended:
const GRAPH_ERROR_KINDS = new Set(['missingDependency', 'missingDefinition', ...]);
error instanceof Error && 'kind' in error && GRAPH_ERROR_KINDS.has(error.kind as string)
```

### T-2: `PipeArg` type has a dead field

```typescript
export type PipeArg = {
  readonly name: string;
  readonly type: 'number' | 'string' | 'boolean' | 'array'; // never used
};
```

`type` is always hardcoded to `'number'` in the builder and never read anywhere. If the intent is future type-checking of pipeline arguments, it should be documented; otherwise the field should be removed.

### T-3: `UnknownValue` could be expressed more cleanly

`UnknownValue = Value<unknown, BaseTypeSymbol, BaseTypeSubSymbol, readonly TagSymbol[]>` is used only as an intermediate in `value-builders.ts`. Callers immediately validate and narrow it. Consider whether it adds clarity or just adds an intermediate type name.

### T-4: `BinaryFnNamespaceToType` maps `binaryFnGeneric` to `'number'` arbitrarily

**File:** [src/compute-graph/builder/context.ts:198-203](../src/compute-graph/builder/context.ts#L198-L203)

```typescript
const BinaryFnNamespaceToType: Record<BinaryFnNamespaces, BaseTypeSymbol> = {
  binaryFnGeneric: 'number', // default to number for generic
};
```

`binaryFnGeneric::isEqual` accepts any type and returns `boolean`. Mapping it to `'number'` for transform inference means using it with string or array arguments will infer the wrong transform type silently.

### T-5: `CondFuncDefTable` uses `FuncId | ValueId` for `conditionId` without type narrowing

**File:** [src/compute-graph/types.ts:132-138](../src/compute-graph/types.ts#L132-L138)

```typescript
export type CondFuncDefTable = {
  [defId in CondDefineId]: {
    conditionId: FuncId | ValueId;   // union, no discrimination
    trueBranchId: FuncId;
    falseBranchId: FuncId;
  };
};
```

The `conditionId` union requires runtime instanceof/in checks when consumed. A discriminated form `{ source: 'value'; id: ValueId } | { source: 'func'; id: FuncId }` would make dispatch safer and clearer.

---

## 8. Improvement Points — Implementations

### I-1: `splitPair.ts` type predicates don't validate function name existence

**File:** [src/util/splitPair.ts:7-33](../src/util/splitPair.ts#L7-L33)

`isTransformFnName` and `isBinaryFnName` only check that the split produces two non-empty parts. They do not validate the namespace or function name against the known registry. A string like `"foo::bar"` would pass the guard and be typed as a valid `TransformFnNames`.

### I-2: `getBinaryFn` and `getTransformFn` perform unsafe type assertions

**File:** [src/compute-graph/call-presets/getBinaryFn.ts:18-27](../src/compute-graph/call-presets/getBinaryFn.ts#L18-L27)

```typescript
return bfArray[fnName] as AnyToAny;
```

If `fnName` is not a key of `bfArray`, this will produce `undefined` at runtime but TypeScript won't flag it. The switch case exhausts all known namespaces but doesn't guard against unknown `fnName` values within a namespace.

### I-3: `executeTree.ts` double `.value` access is confusing

**File:** [src/compute-graph/runtime/executeTree.ts:46](../src/compute-graph/runtime/executeTree.ts#L46)

```typescript
const branchResult = conditionResult.value.value  // AnyValue.value (the JS boolean)
  ? executeTree(tree.trueBranchTree, currentContext)
  : executeTree(tree.falseBranchTree, currentContext);
```

`conditionResult.value` is `AnyValue`, and `.value` on `AnyValue` is the raw JavaScript value. The chain `conditionResult.value.value` reads as confusing. There is also no assertion that `conditionResult.value.symbol === 'boolean'` at this call site (the check exists in `executeCondFunc`, but the branch selection happens before that call).

### I-4: `buildExecutionTree` sets and cleans `visited` within a try/finally — DAG vs tree

**File:** [src/compute-graph/runtime/buildExecutionTree.ts:41-54](../src/compute-graph/runtime/buildExecutionTree.ts#L41-L54)

The visited-set cleanup after each subtree means a node can be visited multiple times (sibling DAG sharing). This is intentional for diamond patterns, but re-execution of shared nodes is O(n) per reference rather than O(1) with memoization. Graphs with many shared intermediate values may be unnecessarily expensive to construct.

### I-5: `processPipeFunc` ignores `PipeBuilder.args` for type information

**File:** [src/compute-graph/builder/context.ts:771-795](../src/compute-graph/builder/context.ts#L771-L795)

The `PipeBuilder.args` array (which holds `{ name, type }`) is iterated only to extract the `name`. The `type` field is never read. Since step transform inference falls back to `'number'` for step outputs, pipeline steps producing non-number types that are referenced later will silently receive the wrong transform.

### I-6: `BINARY_INTERFACE_ARG_IDS` reuses hardcoded IDs across all combine definitions

**File:** [src/compute-graph/builder/context.ts:614-617](../src/compute-graph/builder/context.ts#L614-L617)

```typescript
const BINARY_INTERFACE_ARG_IDS = {
  a: createInterfaceArgId('ia1'),
  b: createInterfaceArgId('ia2'),
} as const;
```

All `CombineFunc` definitions share the same `InterfaceArgId` values (`ia1`, `ia2`). This works currently because `InterfaceArgId` is not used for runtime lookup, but it defeats the purpose of the `InterfaceArgId` brand and makes the validation surface of `InterfaceArgId` meaningless.

---

## 9. Learning Paths

### Entry Points

| Goal | Start File |
|------|-----------|
| Understand value types | [src/state-control/value.ts](../src/state-control/value.ts) |
| Build a computation | [src/compute-graph/builder/index.ts](../src/compute-graph/builder/index.ts) |
| Execute a graph | [src/compute-graph/runtime/exec/executeGraph.ts](../src/compute-graph/runtime/exec/executeGraph.ts) |
| Add a preset function | [src/state-control/preset-funcs/number/binaryFn.ts](../src/state-control/preset-funcs/number/binaryFn.ts) |
| Validate a context | [src/compute-graph/runtime/validateContext.ts](../src/compute-graph/runtime/validateContext.ts) |
| Understand type inference | [src/compute-graph/runtime/typeInference.ts](../src/compute-graph/runtime/typeInference.ts) |

### Learning Path: Understanding the Value System

1. [src/state-control/value.ts](../src/state-control/value.ts) — `Value<T,BaseType,SubType,Tags>`, type guards (`isNumber`, `isArray`, etc.)
2. [src/state-control/value-builders.ts](../src/state-control/value-builders.ts) — `buildNumber`, `binaryNumberOp`, tag merging
3. [src/state-control/preset-funcs/util/propagateTags.ts](../src/state-control/preset-funcs/util/propagateTags.ts) — Tag semantics
4. [src/state-control/preset-funcs/number/binaryFn.ts](../src/state-control/preset-funcs/number/binaryFn.ts) — Concrete function implementations

### Learning Path: Using the Builder API

1. [src/compute-graph/builder/types.ts](../src/compute-graph/builder/types.ts) — `ContextSpec`, `BuildResult`, `CombineBuilder`, `PipeBuilder`, `CondBuilder`
2. [src/compute-graph/builder/functions.ts](../src/compute-graph/builder/functions.ts) — `combine()`, `pipe()`, `cond()` constructors
3. [src/compute-graph/builder/values.ts](../src/compute-graph/builder/values.ts) — `val`, `ref` helpers
4. [src/compute-graph/builder/context.ts](../src/compute-graph/builder/context.ts) — `ctx()` three-phase processing

### Learning Path: Runtime Execution

1. [src/compute-graph/types.ts](../src/compute-graph/types.ts) — `ExecutionContext` structure
2. [src/compute-graph/idValidation.ts](../src/compute-graph/idValidation.ts) — Branded ID system
3. [src/compute-graph/runtime/tree-types.ts](../src/compute-graph/runtime/tree-types.ts) — `ExecutionTree` discriminated union
4. [src/compute-graph/runtime/buildExecutionTree.ts](../src/compute-graph/runtime/buildExecutionTree.ts) — DAG → tree
5. [src/compute-graph/runtime/executeTree.ts](../src/compute-graph/runtime/executeTree.ts) — Post-order traversal
6. [src/compute-graph/runtime/exec/executeCombineFunc.ts](../src/compute-graph/runtime/exec/executeCombineFunc.ts) — Leaf execution
7. [src/compute-graph/runtime/exec/executePipeFunc.ts](../src/compute-graph/runtime/exec/executePipeFunc.ts) — Sequential scoped execution

### Learning Path: Adding a New Preset Function

1. Implement the function in `src/state-control/preset-funcs/{type}/binaryFn.ts` or `transformFn.ts`
2. Add the return type metadata to `src/state-control/meta-chain/{binary-fn|transform-fn}/metaReturn.ts`
3. Add parameter metadata (for binary fns) to `metaParams.ts`
4. The function name is automatically derived from the interface key + namespace delimiter

---

## Summary Table

| Category | Rating | Notes |
|----------|--------|-------|
| Architecture | ★★★★☆ | Clear layering; builder → context → tree → exec |
| Type Safety | ★★★★☆ | Branded IDs, discriminated unions, template literals well used |
| Immutability | ★★★★★ | All execution returns new state; no mutation |
| Error Handling | ★★★☆☆ | Discriminated error types good; guards too broad |
| Test Coverage | ★★★☆☆ | Integration and unit tests present, coverage unknown |
| Documentation | ★★★★☆ | JSDoc present on key functions; design rationale documented |
| Dead Code | ★★★☆☆ | `flatKV.ts`, `propagateTags`, `meta-chain/types.ts`, `PipeArg.type` |
| Known Gaps | ★★☆☆☆ | CondFunc in PipeFunc unimplemented; step type inference broken for non-number |
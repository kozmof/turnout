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

### ~~P-1: IdGenerator requires initialization before use~~ ✓ Fixed

Removed `initializeIdGenerator` and the module-level `let` variables from [src/util/idGenerator.ts](../src/util/idGenerator.ts). `IdGenerator` now imports the branded creators (`createValueId`, `createFuncId`, etc.) directly from [src/compute-graph/idValidation.ts](../src/compute-graph/idValidation.ts), eliminating the fragile side-effect initialization. The `initializeIdGenerator` call and import were removed from [src/compute-graph/builder/context.ts](../src/compute-graph/builder/context.ts).

### ~~P-2: `propagateTags` is defined but unused in preset functions~~ ✓ Fixed

Deleted `src/state-control/preset-funcs/util/propagateTags.ts`. No code imported it — all binary/transform ops already use `mergeTags` inside [src/state-control/value-builders.ts](../src/state-control/value-builders.ts). Also removed the stale JSDoc reference to the file from `value.ts`.

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

### ~~P-8: `meta-chain/types.ts` is marked as deprecated~~ ✓ Fixed

Deleted four dead files that were never imported outside the `meta-chain/` directory:
- `binary-fn/getResultType.ts`
- `transform-fn/getResultType.ts`
- `binary-fn/getBinaryFn.ts`
- `transform-fn/getTransformFn.ts`

Stripped [src/state-control/meta-chain/types.ts](../src/state-control/meta-chain/types.ts) down to only `ElemType` (the one export consumed by `metaReturn.ts`), removing the `// Maybe deprecated` comment and the five unused helper functions (`numberType`, `stringType`, `booleanType`, `arrayType`, `someType`).

### ~~P-9: `PipeArg.type` field is never used at runtime~~ ✓ Fixed

Resolved by the T-2 fix — `PipeArg.type` was removed from the type definition and the hardcoded assignment was dropped from `pipe()`.

### P-10: `validateContext` ordering affects accuracy

**File:** [src/compute-graph/runtime/validateContext.ts:906-930](../src/compute-graph/runtime/validateContext.ts#L906-L930)

The single-pass algorithm validates `funcTable` entries first, then `combineFuncDefTable`. A `funcEntry` referencing a `defId` is checked via `defineIdExistsInContext`, but the `referencedDefs` set (used to generate "never used" warnings) is populated during the funcTable pass. If a `combineFuncDef` is added in the `combineFuncDefTable` pass after the funcTable pass, it will appear as unreferenced even if it is referenced.

---

## 6. Improvement Points — Design Overview

### ~~D-1: No top-level `src/index.ts`~~ ✓ Fixed

Created [src/index.ts](../src/index.ts) as the unified public entry point. It re-exports: all `Value` types and type-guards from `state-control/value`; all builder functions (`buildNumber`, `buildString`, etc.) and operation helpers from `state-control/value-builders`; `ValueBuilderError`/`isValueBuilderError` from `state-control/errors`; `executeGraph`/`executeGraphSafe`, `validateContext`/`assertValidContext`, and all `ExecutionContext`-related types from `compute-graph`; and the full builder API (`ctx`, `combine`, `pipe`, `cond`, `val`, `ref`) plus `BuilderValidationError`/`isBuilderValidationError` from `compute-graph/builder`.

### D-2: `flatKV.ts` is architecturally disconnected

`flatKV.ts` is a generic nested key-value store. No file in `compute-graph/` or `state-control/` imports it. It seems like a utility that was planned for or came from a previous iteration but is no longer used in the main engine.

**Recommendation:** If unused, remove to reduce dead code. If planned for future use, document the intent.

### ~~D-3: `IdGenerator` initialization pattern~~ ✓ Fixed

Resolved by the P-1 fix — `idGenerator.ts` now imports creators directly from `idValidation.ts`.

### ~~D-4: `propagateTags` vs `mergeTags` duplication~~ ✓ Fixed

Resolved by the P-2 fix — `propagateTags.ts` was deleted; `mergeTags` in `value-builders.ts` is the single implementation.

### ~~D-5: No `src/` root module entry point in `package.json`~~ ✓ Fixed

Updated [package.json](../package.json) `"main"` from `"index.js"` to `"src/index.ts"`, pointing to the new source entry created for D-1.

---

## 7. Improvement Points — Types and Interfaces

### ~~T-1: `isValueBuilderError` / `isGraphExecutionError` / `isBuilderValidationError` need stronger discrimination~~ ✓ Fixed

Added a private `Set<string>` of valid `kind` values to each error module. All three guards (`isValueBuilderError` in [src/state-control/errors.ts](../src/state-control/errors.ts), `isGraphExecutionError` in [src/compute-graph/runtime/errors.ts](../src/compute-graph/runtime/errors.ts), `isBuilderValidationError` in [src/compute-graph/builder/errors.ts](../src/compute-graph/builder/errors.ts)) now check membership in their respective Set instead of a loose `typeof === 'string'` check.

### ~~T-2: `PipeArg` type has a dead field~~ ✓ Fixed

Removed the dead `type` field from `PipeArg` in [src/compute-graph/builder/types.ts](../src/compute-graph/builder/types.ts#L86-L88) and the corresponding hardcoded `type: 'number' as const` from the `pipe()` builder in [src/compute-graph/builder/functions.ts](../src/compute-graph/builder/functions.ts#L63-L65). `PipeArg` now only carries `name`.

### ~~T-3: `UnknownValue` could be expressed more cleanly~~ ✓ Fixed

Added `@internal` JSDoc annotation to `UnknownValue` in [src/state-control/value.ts](../src/state-control/value.ts) to signal that it is an implementation detail of the builder infrastructure and not part of the public API.

### T-4: `BinaryFnNamespaceToType` maps `binaryFnGeneric` to `'number'` arbitrarily

**File:** [src/compute-graph/builder/context.ts:198-203](../src/compute-graph/builder/context.ts#L198-L203)

```typescript
const BinaryFnNamespaceToType: Record<BinaryFnNamespaces, BaseTypeSymbol> = {
  binaryFnGeneric: 'number', // default to number for generic
};
```

`binaryFnGeneric::isEqual` accepts any type and returns `boolean`. Mapping it to `'number'` for transform inference means using it with string or array arguments will infer the wrong transform type silently.

### ~~T-5: `CondFuncDefTable` uses `FuncId | ValueId` for `conditionId` without type narrowing~~ ✓ Fixed

Introduced `ConditionId` discriminated union in [src/compute-graph/types.ts](../src/compute-graph/types.ts):

```typescript
export type ConditionId =
  | { readonly source: 'value'; readonly id: ValueId }
  | { readonly source: 'func'; readonly id: FuncId };
```

Updated `CondFuncDefTable.conditionId` to use the new type. Propagated through:
- `processCondFunc` in [src/compute-graph/builder/context.ts](../src/compute-graph/builder/context.ts) — now produces the discriminated form
- `buildExecutionTree` in [src/compute-graph/runtime/buildExecutionTree.ts](../src/compute-graph/runtime/buildExecutionTree.ts) — reads `.conditionId.id`
- `validateContext` in [src/compute-graph/runtime/validateContext.ts](../src/compute-graph/runtime/validateContext.ts) — `hasConditionId` guard checks for `{ source, id }` shape; validation block dispatches on `source === 'value'` vs `source === 'func'`
- All test fixtures in `validateContext.test.ts`, `validateContext.integration.test.ts`, and `executeGraph.test.ts`
- `ConditionId` exported from [src/compute-graph/index.ts](../src/compute-graph/index.ts) and [src/index.ts](../src/index.ts)

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

### ~~I-3: `executeTree.ts` double `.value` access is confusing~~ ✓ Fixed

Extracted `conditionResult.value` to `conditionValue: AnyValue` in [src/compute-graph/runtime/executeTree.ts](../src/compute-graph/runtime/executeTree.ts). Added an explicit `symbol !== 'boolean'` guard before branch selection (throwing `createFunctionExecutionError` early, before the wrong branch could execute). The ternary now reads `conditionValue.value` — one dereference, clearly the raw JS boolean.

### ~~I-4: `buildExecutionTree` sets and cleans `visited` within a try/finally — DAG vs tree~~ ✓ Fixed

Added an optional `memo: Map<NodeId, ExecutionTree>` parameter (defaulting to `new Map()`) to `buildExecutionTree` in [src/compute-graph/runtime/buildExecutionTree.ts](../src/compute-graph/runtime/buildExecutionTree.ts). The cache is checked before visiting a node; the built subtree is stored in the cache before returning. `memo` is propagated through `buildExecutionTreeInternal` and all four recursive `buildExecutionTree` calls. External callers are unaffected (parameter is optional).

### ~~I-5: `processPipeFunc` ignores `PipeBuilder.args` for type information~~ ✓ Fixed

`buildStepTransformMap` in [src/compute-graph/builder/context.ts](../src/compute-graph/builder/context.ts) now accepts `pipeBuilder: PipeBuilder`. When a step argument is a `StepOutputRef`, the function looks up `pipeBuilder.steps[ref.stepIndex]` and calls `inferTransformForBinaryFn` on the *referenced* step's function name — giving the correct pass-transform type instead of always defaulting to `'number'`. The sole call site in `buildPipeStepBinding` was updated to pass `pipeBuilder`.

### ~~I-6: `BINARY_INTERFACE_ARG_IDS` reuses hardcoded IDs across all combine definitions~~ ✓ Fixed

Removed the `BINARY_INTERFACE_ARG_IDS` constant from [src/compute-graph/builder/context.ts](../src/compute-graph/builder/context.ts). `buildCombineDefinition` now calls `IdGenerator.generateInterfaceArgId()` twice per invocation, producing a unique `InterfaceArgId` pair for every combine definition. Dropped the now-unused `createInterfaceArgId` import.

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
3. [src/state-control/value-builders.ts](../src/state-control/value-builders.ts) — Tag merging via `mergeTags` (internal), `binaryNumberOp`, `unaryNumberOp`, etc.
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
| Error Handling | ★★★★☆ | Discriminated error types good; guards strengthened with Set-based kind checks |
| Test Coverage | ★★★☆☆ | Integration and unit tests present, coverage unknown |
| Documentation | ★★★★☆ | JSDoc present on key functions; design rationale documented |
| Dead Code | ★★★★☆ | `flatKV.ts` remaining; `meta-chain` orphans, `propagateTags`, `PipeArg.type` removed |
| Public API | ★★★★☆ | `src/index.ts` now consolidates full public surface; `package.json` updated |
| Known Gaps | ★★☆☆☆ | CondFunc in PipeFunc unimplemented; step type inference broken for non-number |
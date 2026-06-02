# Code Analysis

**Date:** 2026-06-02  
**Scope:** `packages/ts/runtime`, `packages/ts/scene-runner`

---

## 1. Code Organization and Structure

The repo is a TypeScript monorepo with two core packages:

| Package | Role |
|---|---|
| `packages/ts/runtime` | Pure functional compute-graph engine (value types, builder API, tree execution) |
| `packages/ts/scene-runner` | Domain execution engine (scene/action loop, state, HCL bridge, hooks) |

**runtime** is layered cleanly:

```
state-control/     ← Value types, builders, preset function metadata
compute-graph/
  literal-schema/  ← BinaryFn / TransformFn name enums
  call-presets/    ← Name→function dispatch tables
  builder/         ← ctx() / combine() / pipe() / cond() builder API
  runtime/         ← Tree building + execution + validation + type inference
util/              ← Brand, ID generation, strEnum, TOM helpers
```

**scene-runner** is structured around execution flow:

```
state/             ← Immutable StateManager
executor/          ← HCL bridge, action / scene execution, next-rule evaluation
harness/           ← High-level runHarness orchestrator
server/            ← Node.js-specific file loading + conversion
types/             ← Proto-generated model types
```

**Issue — file sizes:** `validateContext.ts` (1649 lines) and `context.ts` (1190 lines) each contain too many concerns for a single file. Both should be split.

---

## 2. Relations (Types, Interfaces)

### Value hierarchy

```
Value<T, BaseType, SubType, Tags>
│
├── NumberValue<Tags>          symbol:'number', subSymbol:undefined
├── StringValue<Tags>          symbol:'string', subSymbol:undefined
├── BooleanValue<Tags>         symbol:'boolean', subSymbol:undefined
├── NullValue<Tags>            symbol:'null',   subSymbol:NullReasonSubSymbol
│                                               ('missing'|'not-found'|'error'|…)
└── AnyArrayValue<Tags>
    ├── ArrayValue<Tags>       symbol:'array',  subSymbol:undefined  (untyped)
    └── TypedArrayValue<Tags>
        ├── ArrayNumberValue   symbol:'array',  subSymbol:'number'
        ├── ArrayStringValue   symbol:'array',  subSymbol:'string'
        ├── ArrayBooleanValue  symbol:'array',  subSymbol:'boolean'
        └── ArrayNullValue     symbol:'array',  subSymbol:'null'
```

### ExecutionContext structure

```
ExecutionContext
├── valueTable:         { [ValueId]: AnyValue }
├── funcTable:          { [FuncId]: FuncTableEntry }
│     ├── { kind:'combine', defId:CombineDefineId, argMap, returnId }
│     ├── { kind:'pipe',    defId:PipeDefineId,    argMap, returnId }
│     └── { kind:'cond',    defId:CondDefineId,           returnId }
├── combineFuncDefTable:{ [CombineDefineId]: { name, transformFn:{a,b} } }
├── pipeFuncDefTable:   { [PipeDefineId]: { args, sequence:PipeStepBinding[] } }
└── condFuncDefTable:   { [CondDefineId]: { conditionId, trueBranchId, falseBranchId } }
```

`ValidatedContext` brands `ExecutionContext` with a unique symbol — it is impossible to construct one without going through the validation path. This is the strongest correctness guarantee in the codebase.

`ScopedExecutionContext` (in `compute-graph/types.ts`) adds `scope:'pipe'` and `visibleValueIds: ReadonlySet<ValueId>`, but is never referenced elsewhere — appears to be a dead type.

Branded ID types (`ValueId`, `FuncId`, `CombineDefineId`, etc.) use the `Brand<string, X>` pattern and prevent silent ID mixing across tables.

---

## 3. Relations (Functions)

### Build pipeline (runtime)

```
ctx(spec)
  collectValues()                               ← Phase 1: JS literals → ValueTable
  processFunctions()                            ← Phase 2: two-pass function build
    buildReferenceIndexAndRegisterReturns()       Pass 1: key categorization + return ID pre-registration
    validateFunctionReference()                 ← per-function reference validation
    processFunction()
      processCombineFunc()
      processPipeFunc()
      processCondFunc()
  buildExecutionContext()                       ← Phase 3: assemble ExecutionContext
  buildIdMap()                                  ← typed ID map for caller
```

### Execution pipeline (runtime)

```
executeGraph(nodeId, context)
  buildReturnIdToFuncIdMap(context)             ← returnId → funcId reverse map
  buildExecutionTree(nodeId, …)                 ← DAG → ExecutionTree with memo + cycle detection
  executeTree(tree, context)                    ← post-order traversal, threading valueTable
    executeCombineFunc / executePipeFunc / executeCondFunc
```

### Scene execution pipeline (scene-runner)

```
executeSceneSafe(scene, state, hooks)
  createSceneExecutor()
    executor.next() per action:
      executeAction(action, state, hooks)
        resolveActionPrepare()                  ← Step 1: inject state/hook values
        buildContextFromProg(prog, …)           ← Step 2: ProgModel → ExecutionContext
          buildSpec() → ctx()
          buildNameToValueId()
        assertValidContext()                    ← Step 3: validate
        [forward pass over bindings]            ← Step 4: execute all bindings
          buildExecutionTree + executeTree
        state.writeBatch()                      ← Step 5: merge to state
        [publish hooks]                         ← Step 6
      evaluateNextRules()                       ← enqueue next actions
```

---

## 4. Specific Contexts and Usages

- **HCL → Runtime bridge** (`hcl-context-builder.ts`): `FN_MAP` translates DSL-level names (e.g. `"add"`) to `BinaryFnNames` (e.g. `"binaryFnNumber::add"`). This is the only place where domain string names enter the runtime type system.

- **Forward-pass execution** (`action-executor.ts:61`): all bindings are executed in declaration order, not just the `compute.root`. This ensures bindings referenced only by `merge` entries (not reachable from root) are still computed and available for state writes.

- **Action map cache** (`scene-executor.ts:69`): `WeakMap<SceneBlock, Record<string, ActionModel>>` — keyed by object identity so the cache is GC'd when the scene leaves scope. Avoids rebuilding the O(n) lookup map on repeated executions of the same scene.

- **Next-rule context cache** (`scene-executor.ts:287`): scoped `WeakMap<NextRuleModel, BuiltContext>` per invocation. Prevents stale injected values from a previous action leaking into the current action's next-rule evaluation.

- **`stateManagerFromSchema`** integrates protobuf `StateModel` via `protoValueToJs` + `literalToValue` — the only place where `google.protobuf.Value` is unwrapped to JS primitives.

---

## 5. Pitfalls

**P1 — `buildExecutionTree` materializes both cond branches eagerly**  
(`buildExecutionTree.ts:117`) If a branch references a missing value ID, the error is thrown at *tree-build time*, not at execution time. A branch that will never execute can still prevent tree construction.

**P2 — `buildReturnIdToFuncIdMap` in default parameter**  
(`buildExecutionTree.ts:28`)

```typescript
buildExecutionTree(nodeId, context, visited, memo,
  returnIdToFuncId = buildReturnIdToFuncIdMap(context)  // recomputed if omitted
)
```

`action-executor.ts` correctly pre-builds it once. Any caller who forgets will silently recompute it O(|funcTable|) times per binding.

**P3 — `getOrCreateCombineDefinitionId` incorrectly rejects array binary functions at build time**  
(`context.ts:1176`)

```typescript
if (getBinaryFnReturnType(name) === null) {
  throw new Error(`Unknown binary function '${name}'...`);
}
```

`getBinaryFnReturnType` returns `null` for all `binaryFnArray::*` functions when called without `elemType`. So array binary functions always throw at context build time. This is undocumented.

**P4 — `inferFuncReturnType` has incomplete nested pipe recursion**  
(`typeInference.ts:277`) The nested pipe-in-pipe case manually repeats one level of recursion with a comment: `// TODO: infer all func type-chains`. Type inference silently returns `null` for deeply nested pipes, which can cause validation to miss real type mismatches.

**P5 — `buildNull` performs redundant post-construction validation**  
(`value-builders.ts:136`) `createUnknownValue` is a pure object constructor — the `isValidValue` check immediately after can never fail unless `reason` is an invalid `NullReasonSubSymbol`, which TypeScript catches at compile time. The runtime re-validation is wasted work.

**P6 — `stepMetadata[id].returnType` is mutated after creation**  
`IdFactory.createStepOutput` creates metadata as `{ parentFuncId, stepIndex }` (no `returnType`). Then `buildPipeSequence` sets `state.stepMetadata[stepOutputId].returnType = stepReturnType` directly. The inner object is not `readonly`, making this a hidden mutation on an otherwise immutable-looking structure.

**P7 — Cond functions cannot be forward-referenced**  
In `inferPassTransform`, if a `FuncOutputRef` targets a `cond` function not yet processed, it throws with a helpful error message. But this ordering constraint is not enforced or documented at the builder API level — it is only discovered at build time.

---

## 6. Improvement Points (Design Overview)

**D1 — Split `validateContext.ts`**  
At 1649 lines it handles `UnvalidatedContext` types, `ValidatedContext` branding, `ValidationError`/`ValidationWarning` types, and all validation logic for values, combine defs, pipe defs, and cond defs. Extract into `validateValues.ts`, `validateCombineDefs.ts`, `validatePipeDefs.ts`, `validateCondDefs.ts`.

**D2 — Remove or implement `ScopedExecutionContext`**  
The type is defined with `scope:'pipe'` and `visibleValueIds` but appears unused. Either implement it as intended or delete it.

**D3 — Make `inferFuncReturnType` complete**  
The recursive pipe-in-pipe case should use the main recursion path. The limitation is that `inferFuncReturnType` takes a `FuncId` but a nested `PipeDefineId` isn't directly a `FuncId`. The fix is to add `inferPipeDefReturnType(defId, context, visited)` as a sibling function.

**D4 — `buildReturnIdToFuncIdMap` should not be a default parameter**  
Require callers to pass it explicitly, or make `buildExecutionTree` internal and expose a `createExecutor(context)` factory that pre-builds the map once.

**D5 — Document or fix array binary function behavior (P3)**  
Either allow `binaryFnArray::*` through build-time validation by checking the namespace first, or add an explicit error message: "array functions are not supported via the builder API — use pipe with `arr_*` HCL functions".

---

## 7. Improvement Points (Types, Interfaces)

**T1 — `ArrayXxxValue.value` should be narrowed by element type**

```typescript
// Current: value is AnyValue[] regardless of subSymbol
type ArrayNumberValue<Tags> = Value<AnyValue[], 'array', 'number', Tags>;
// Better:
type ArrayNumberValue<Tags> = Value<NumberValue[], 'array', 'number', Tags>;
```

This prevents `array.value[0].symbol === 'string'` from type-checking on a `ArrayNumberValue`.

**T2 — `ValueInputRef` union creates excessive branching**  
`ValueInputRef = ValueRef | ValueObjectRef | FuncOutputRef | StepOutputRef` leads to 4-branch switches in every resolution function. The string form (`ValueRef`) could be normalized to `ValueObjectRef` at the `combine()`/`ref.*` entry points, reducing all internal resolution to `ValueSourceRef`.

**T3 — `ContextBuilder` and `FunctionPhaseState` are unrelated**  
`ContextBuilder` is defined in `builder/types.ts` but `FunctionPhaseState` in `context.ts` has a strict superset of its fields without declaring the relationship. `FunctionPhaseState` should extend or reference `ContextBuilder` explicitly.

**T4 — `Tags` type parameter is structural, not nominal**  
`PureNumberValue` aliases `NumberValue` with no tags argument (defaults to `readonly []`). But `NumberValue<['random']>` is also assignable to `NumberValue<readonly TagSymbol[]>`. The `isPure*` guards check `val.tags.length === 0` at runtime correctly, but the type `PureNumberValue` does not prevent assignment from a tagged value. This is a known TypeScript limitation but worth documenting.

---

## 8. Improvement Points (Implementations)

**I1 — `buildNull` should validate `reason` first, not post-construction**

```typescript
// Better: validate reason up-front, then construct once
export function buildNull(reason: NullReasonSubSymbol, tags: readonly TagSymbol[] = []): NullValue<...> {
  if (!nullReasonSubSymbols.includes(reason)) throw createInvalidValueError(...);
  const uniqueTags = tags.length > 0 ? Array.from(new Set(tags)) : [];
  return createUnknownValue('null', null, reason, uniqueTags) as NullValue<...>;
}
```

Eliminates the post-construction `isValidValue` call entirely.

**I2 — `createValueBuilder` deduplicates tags unconditionally**  
```typescript
const uniqueTags = tags.length > 0 ? Array.from(new Set(tags)) : [];
```
When `tags` comes from `mergeTags()` (which already uses a Set), the second deduplication is wasted. Add a fast path: skip deduplication when `tags.length <= 1`.

**I3 — `IdFactory` read helpers appear unused**  
`IdFactory.getStepMetadata`, `getReturnValueSource`, `isStepOutput`, `isFunctionOutput` are defined in `context.ts` but not called anywhere in the file. Verify and remove dead code.

**I4 — `action-executor.ts` tree cache has a subtle invariant**  
```typescript
const bindingCtx = { ...validatedCtx, valueTable: updatedTable };  // changes each iteration
let tree = treeCache.get(funcId);
if (!tree) {
  tree = buildExecutionTree(funcId, bindingCtx, ...);  // built against first iteration
  treeCache.set(funcId, tree);
}
const result = executeTree(tree, bindingCtx);  // executed against current iteration
```
This is safe because `buildExecutionTree` only reads `funcTable` (stable) and pre-defined `valueTable` entries (not function outputs), but the invariant is non-obvious. Add a comment explaining why re-use across changing `bindingCtx` values is correct.

**I5 — `buildCombineDefSignature` is not collision-safe**  
```typescript
return `${name}|a:${transformA?.join(',')}|b:${transformB?.join(',')}`;
```
If a function name contains `|` or a transform name contains `,`, two distinct signatures could produce the same string. Use `JSON.stringify([name, transformA, transformB])` for a guaranteed-unique key.

**I6 — `withValueTable` allocates a new context object per function child**  
In `executeTree`, `withValueTable` is called once per child node, creating O(children) intermediate context objects — even though `funcTable`, `combineFuncDefTable`, etc. are constant for the entire execution. A context wrapper that holds a shared static part and a separate `valueTable` reference would reduce allocation pressure.

---

## 9. Learning Paths

### Path A — Value system
*Goal: understand how values are created, tagged, and narrowed*

1. `packages/ts/runtime/src/state-control/value.ts` — `Value<T, BaseType, SubType, Tags>`, `AnyValue`, type guards
2. `packages/ts/runtime/src/state-control/value-builders.ts` — `buildNumber/String/Boolean/Null`, `mergeTags`, binary/unary ops
3. `packages/ts/runtime/src/state-control/errors.ts` — `InvalidValueError`, `ValueBuilderError`

### Path B — Compute graph data model
*Goal: understand what `ctx()` produces*

1. `packages/ts/runtime/src/compute-graph/types.ts` — `ExecutionContext`, all table types, `FuncTableEntry`, `PipeStepBinding`
2. `packages/ts/runtime/src/compute-graph/builder/types.ts` — `ContextSpec`, `CombineBuilder`, `PipeBuilder`, `CondBuilder`, `BuildResult<T>`
3. `packages/ts/runtime/src/util/idGenerator.ts` — how IDs are generated (crypto random hex, prefixed)

### Path C — Builder API
*Goal: understand how `ctx()` translates specs to contexts*

1. `packages/ts/runtime/src/compute-graph/builder/context.ts` — 3-phase `ctx()`, 2-pass function processing, forward reference handling
2. `packages/ts/runtime/src/compute-graph/runtime/typeInference.ts` — how return types are statically inferred from function names

### Path D — Execution
*Goal: understand how trees execute*

1. `packages/ts/runtime/src/compute-graph/runtime/tree-types.ts` — `ExecutionTree` discriminated union: `ValueNode`, `FunctionNode`, `ConditionalNode`
2. `packages/ts/runtime/src/compute-graph/runtime/buildExecutionTree.ts` — DAG → tree, memoization, cycle detection
3. `packages/ts/runtime/src/compute-graph/runtime/executeTree.ts` — post-order traversal, `withValueTable`, branch selection

### Path E — Domain execution
*Goal: understand the full scene lifecycle*

1. `packages/ts/scene-runner/src/state/state-manager.ts` — immutable state, schema validation, `stateManagerFromSchema`
2. `packages/ts/scene-runner/src/executor/hcl-context-builder.ts` — `FN_MAP`, `buildSpec()`, `buildContextFromProg()`
3. `packages/ts/scene-runner/src/executor/action-executor.ts` — 6-step action execution, forward-pass binding loop
4. `packages/ts/scene-runner/src/executor/scene-executor.ts` — BFS action queue, `evaluateNextRules`, `first-match`/`all-match` policies, `SceneExecutor` iterator API

# Code Analysis: `turnout` — 2026-02-23

**Project summary:** A typed **computation graph execution engine** in TypeScript. Users declare a graph with a builder API (`ctx`, `combine`, `pipe`, `cond`) and execute it functionally via `executeGraph`. Values carry provenance tags that propagate through operations.

**Update (2026-02-23):** `InterfaceArgId` was removed from the compute-graph model and API. Function-definition `args` are represented as key-presence markers (`true`) because runtime behavior depends on arg names, not argument-ID values.
**Update (2026-02-23, later):** Pitfalls **P1–P7** listed below were fixed in code, and targeted regression tests were added for pipe-step `funcOutput` validation and conditional return-type inference.

---

## 1. Code Organization and Structure

```
src/
├── index.ts                      — Public re-export surface
├── flatKV.ts                     — (utility, minor)
├── util/
│   ├── brand.ts                  — Brand<K,T> phantom type
│   ├── tom.ts                    — Typed Object Method helpers
│   ├── strEnum.ts                — String-enum builder
│   ├── constants.ts              — NAMESPACE_DELIMITER etc.
│   ├── idGenerator.ts            — UUID-based ID factories
│   └── splitPair.ts              — Namespace::name parser
├── state-control/
│   ├── value.ts                  — Core Value<T,B,S,Tags> type + guards
│   ├── value-builders.ts         — buildNumber/String/… + binary/unary ops
│   ├── errors.ts                 — InvalidValueError
│   ├── meta-chain/               — Metadata tables for type inference
│   │   ├── binary-fn/            — metaReturn, metaParams
│   │   └── transform-fn/         — metaReturn
│   └── preset-funcs/             — Concrete fn implementations by type
│       ├── number/, string/, boolean/, array/, null/, generic/
│       └── convert.ts
└── compute-graph/
    ├── types.ts                  — ExecutionContext, FuncTable, etc.
    ├── idValidation.ts           — Branded ID creators + table guards
    ├── index.ts                  — Module re-exports
    ├── literal-schema/           — Valibot schemas for fn names
    ├── call-presets/             — getBinaryFn / getTransformFn dispatch
    ├── builder/                  — ctx() builder (context.ts, functions.ts, values.ts)
    └── runtime/
        ├── buildExecutionTree.ts — DAG → ExecutionTree
        ├── executeTree.ts        — Post-order traversal executor
        ├── validateContext.ts    — Single-pass context validator
        ├── typeInference.ts      — Return/param type inference
        ├── tree-types.ts         — ValueNode / FunctionNode / ConditionalNode
        └── exec/
            ├── executeGraph.ts   — Entry point (safe + unsafe)
            ├── executeCombineFunc.ts
            ├── executePipeFunc.ts
            └── executeCondFunc.ts
```

The layering is clean: `util` → `state-control` → `compute-graph`. The builder and runtime are well-separated within `compute-graph`.

---

## 2. Type/Interface Relations

```
Brand<K,T>                  — phantom type foundation
  └── ValueId, FuncId, CombineDefineId, PipeDefineId, CondDefineId

Value<T, BaseType, SubType, Tags>
  ├── NumberValue, StringValue, BooleanValue, NullValue
  ├── ArrayValue, ArrayNumberValue, ArrayStringValue, ArrayBooleanValue, ArrayNullValue
  ├── AnyValue  (union of all above with readonly TagSymbol[])
  ├── NonArrayValue
  └── UnknownValue  (internal, all fields unknown-widened)

ExecutionContext
  ├── ValueTable          — ValueId → AnyValue
  ├── FuncTable           — FuncId → FuncTableEntry (discriminated: combine | pipe | cond)
  ├── CombineFuncDefTable — CombineDefineId → { name, transformFn, args }
  ├── PipeFuncDefTable    — PipeDefineId → { args, sequence: PipeStepBinding[] }
  └── CondFuncDefTable    — CondDefineId → { conditionId, trueBranchId, falseBranchId }

ExecutionTree (discriminated union)
  ├── ValueNode       — leaf, carries AnyValue
  ├── FunctionNode    — internal, combine|pipe
  └── ConditionalNode — internal, cond with lazy branches

ValidationResult (discriminated union)
  ├── { valid: true; context: ValidatedContext; warnings }
  └── { valid: false; errors; warnings }

ValidatedContext — ExecutionContext & { [_validatedBrand]: true }
```

The type hierarchy is well thought-out. The discriminated-union approach on `FuncTableEntry`, `ExecutionTree`, and `ConditionId` makes exhaustiveness checks possible throughout.

---

## 3. Function Relations

```
ctx(spec)                            ← main builder entry point
  ├── collectValues()                 → Phase 1: JS literals → AnyValue
  ├── processFunctions()              → Phase 2: builders → tables
  │   ├── validateFunctionReferences()
  │   ├── processCombineFunc()  ──────→ buildCombineArguments / buildCombineDefinition
  │   ├── processPipeFunc()     ──────→ buildPipeArguments / buildPipeSequence
  │   │                                  └── buildPipeStepBinding
  │   │                                       └── buildStepArgBindings / buildStepTransformMap
  │   └── processCondFunc()
  └── buildExecutionContext()         → Phase 3: assemble ExecutionContext

executeGraph(rootFuncId, ctx)
  ├── buildExecutionTree()            — DAG traversal with memoization + cycle detection
  └── executeTree()                   — post-order recursive evaluation
       ├── executeCombineFunc()       — resolves transform fns, binary fn, returns result
       ├── executePipeFunc()          — scoped context, sequential steps
       │    └── executeStep()         — creates temp FuncId, calls combine or pipe recursively
       └── executeCondFunc()          — lazy branch (only one evaluated)

validateContext(unvalidated)
  ├── checkRequiredTables()
  ├── buildTypeEnvironment()          — seed type map from valueTable
  ├── validateFuncEntry()             → validateCombineFuncTypes()
  ├── validateCombineDefEntry()       → validateBinaryFnCompatibility()
  ├── validatePipeDefEntry()          → validateBinding() (dispatch table)
  ├── validateCondDefEntry()
  └── checkUnreferencedValues()

Type inference chain:
  getBinaryFnReturnType / getBinaryFnParamTypes
  getTransformFnInputType / getTransformFnReturnType
    └── all driven by splitPair + namespace → meta*() lookup tables
```

---

## 4. Specific Contexts and Usages

**Creating and executing a graph:**

```typescript
const { exec, ids } = ctx({
  v1: 5,
  v2: 3,
  sum: combine('binaryFnNumber::add', { a: 'v1', b: 'v2' }),
});
const result = executeGraph(ids.sum, assertValidContext(exec));
// result.value = NumberValue { value: 8, tags: [] }
```

**Pipe (sequential composition):**

```typescript
pipe(
  { x: 'v1' },          // argBindings: pipe arg 'x' ← value 'v1'
  [
    combine('binaryFnNumber::multiply', { a: 'x', b: 'x' }),
    combine('binaryFnNumber::add', { a: ref.step(0), b: 'x' }),
  ]
)
// step 0 output flows into step 1 via ref.step(0)
```

**Conditional:**

```typescript
cond('someConditionFunc', { then: 'trueFunc', else: 'falseFunc' })
// only the selected branch is evaluated (lazy)
```

**Tag propagation:**

```typescript
const a = buildNumber(5, ['random'] as readonly TagSymbol[]);
const b = buildNumber(3, ['cached'] as readonly TagSymbol[]);
binaryNumberOp((x, y) => x + y, a, b)
// → NumberValue { value: 8, tags: ['random', 'cached'] }
```

---

## 5. Pitfalls (Status Update)

**P1. Resolved — `buildReturnIdToFuncIdMap` hoisted once per tree build**
`buildExecutionTree` now builds the return-ID map once and threads it through recursion, removing per-node rebuilds and eliminating the O(n²)-style behavior from repeated map construction.
Relevant code: `src/compute-graph/runtime/buildExecutionTree.ts`.

**P2. Resolved — `executePipeFunc` now chains scoped context from prior step**
After each step, `scopedContext` is now rebuilt from the previous scoped context (`createScopedContext(scopedContext, currentValueTable)`), making the state-threading model explicit and less fragile.
Relevant code: `src/compute-graph/runtime/exec/executePipeFunc.ts`.

**P3. Resolved — `inferFuncReturnType` handles both `CondFunc` branches**
Conditional return-type inference now evaluates both branches and returns:
- the shared type when both branches agree
- `null` when branches differ or cannot be inferred
This prevents silent mis-inference from true-branch-only behavior.
Relevant code: `src/compute-graph/runtime/typeInference.ts`.
Regression tests: `src/compute-graph/runtime/typeInference.test.ts`.

**P4. Resolved — pipe-step `funcOutput` refs are validated**
`validatePipeReferences` now validates `funcOutput` references in pipe-step arguments, including `TransformRef.valueId` when it is a `funcOutput`.
Relevant code: `src/compute-graph/builder/context.ts`.
Regression test: `src/compute-graph/builder/context.test.ts`.

**P5. Resolved — removed unreachable validation path in `createValueBuilder`**
The dead post-construction validation/throw branch in `createValueBuilder` was removed, and the builder now returns the constructed value directly under the established constructor invariant.
Relevant code: `src/state-control/value-builders.ts`.

**P6. Resolved — builder lookups switched to O(1) reverse maps**
`lookupReturnId`, `resolveFuncOutputRef`, and `resolveStepOutputRef` now use direct reverse lookup maps maintained in builder state:
- `funcId -> returnValueId`
- `(funcId, stepIndex) -> stepOutputId`
Relevant code: `src/compute-graph/builder/context.ts`.

**P7. Resolved — removed duplicated `PipeBuilder.args` representation**
`PipeBuilder` now uses `argBindings` as the single source of truth for pipe argument names/bindings. This removes manual sync risk between `args` and `argBindings`.
Relevant code: `src/compute-graph/builder/types.ts`, `src/compute-graph/builder/functions.ts`, `src/compute-graph/builder/context.ts`.

---

## 6. Improvement Points — Design Overview

**D1. No definition sharing: `ctx()` creates a fresh `CombineDefineId` per usage**
The builder creates one definition per `combine()` call even if the same function configuration is reused. A definition registry with structural equality could reduce `CombineFuncDefTable` size.

**D2. `ExecutionContext` is rebuilt via object spread on every state update**
During tree execution, every step spreads the context (`{ ...context, valueTable: ... }`). For large contexts this causes O(|context|) object allocations per step. A mutable accumulator or persistent map structure would be more efficient.

**D3. `ValidatedContext` brand is applied via double cast**
At `src/compute-graph/runtime/validateContext.ts:1023`, the brand is applied as `context as unknown as ValidatedContext`. While logically correct, this bypasses TypeScript's type system. An explicit constructor function or helper would make the intent clearer.

**D4. PipeFunc scoping is implicit at the type level**
The scoped context created in `executePipeFunc` is still typed as `ExecutionContext`. A dedicated `ScopedExecutionContext` type would make the invariant (restricted value visibility) explicit and statically checked.

---

## 7. Improvement Points — Types and Interfaces

**T1. Resolved: removed `InterfaceArgId` from function-definition args**
This issue was addressed. `CombineFuncDefTable.args` and `PipeFuncDefTable.args` are now key-presence markers (`true`) rather than branded interface-argument IDs, matching runtime behavior that only uses arg-name keys.
Relevant code: `src/compute-graph/types.ts:51`, `src/compute-graph/types.ts:97`, `src/compute-graph/builder/context.ts:724`, `src/compute-graph/builder/context.ts:779`.

**T2. `PipeArgBinding` source `'input'` uses unbranded `argName: string`**
The `argName` in `{ source: 'input'; argName: string }` is a plain string — invalid argument names are not caught at the type level, unlike the branded `ValueId` used in `{ source: 'value'; id: ValueId }`.

**T3. `AnyValue` includes untyped `ArrayValue` alongside typed array variants**
Having both `ArrayValue` (subSymbol `undefined`) and `ArrayNumberValue`, `ArrayStringValue`, etc. in the same union forces all consumers to handle the untyped case. A separate `TypedArrayValue` union would reduce branch handling in practice.

**T4. `TransformRef.valueId` is a three-way union requiring special-cased resolution**
The type `ValueRef | FuncOutputRef | StepOutputRef` in `src/compute-graph/builder/types.ts:82` causes branching in `resolveValueReference` and `buildStepArgBindings`. The string (`ValueRef`) branch takes a separate code path from the object refs, adding complexity.

---

## 8. Improvement Points — Implementations

**I1. Resolved — `buildReturnIdToFuncIdMap` hoisted**
Implemented by building the map once in `buildExecutionTree` and threading it through recursive calls.

**I2. Resolved — linear scans replaced in output-reference resolution**
Implemented via direct reverse lookup maps in builder state:
- `funcId -> returnValueId`
- `(funcId, stepIndex) -> stepOutputId`

**I3. Collapse the double-iteration in `validateFunctionReferences`**
The builder iterates the spec in `validateFunctionReferences` and again in `processFunctions`. A single-pass design that defers validation alongside processing would be more efficient and easier to reason about.

**I4. Resolved — unreachable throw removed in `createValueBuilder`**
`createValueBuilder` now directly returns the constructed value under the constructor invariant; the dead validation throw path was removed.

**I5. Simplify `executeCondFunc` call signature**
In `src/compute-graph/runtime/executeTree.ts:66-73`, `executeCondFunc` receives `branchResult.value` for both its `selectedValue` and `otherValue` parameters. The function signature should be simplified to accept only the single resolved branch value, removing the conceptually meaningless duplicate.

---

## 9. Learning Paths on Implementations

**Path 1 — Understand how values work**
1. `src/state-control/value.ts` — `Value<T,B,S,Tags>` interface, `AnyValue` union, type guards
2. `src/state-control/value-builders.ts` — `buildNumber`, `mergeTags`, `binaryNumberOp`
3. `src/state-control/preset-funcs/number/binaryFn.ts` — concrete implementations

**Path 2 — Understand the execution model**
1. `src/compute-graph/types.ts` — `ExecutionContext`, `FuncTable`, `FuncTableEntry`
2. `src/compute-graph/runtime/buildExecutionTree.ts` — how a graph becomes an `ExecutionTree`
3. `src/compute-graph/runtime/executeTree.ts` — post-order traversal
4. `src/compute-graph/runtime/exec/executeCombineFunc.ts` and `executePipeFunc.ts`

**Path 3 — Understand the builder API**
1. `src/compute-graph/builder/types.ts` — `CombineBuilder`, `PipeBuilder`, `CondBuilder`
2. `src/compute-graph/builder/functions.ts` — `combine()`, `pipe()`, `cond()` factories
3. `src/compute-graph/builder/context.ts` — `ctx()` and its three phases: `collectValues` → `processFunctions` → `buildExecutionContext`

**Path 4 — Understand validation**
1. `src/compute-graph/runtime/validateContext.ts` — `UnvalidatedContext`, `ValidatedContext` brand, `ValidationResult` discriminated union
2. `src/compute-graph/runtime/typeInference.ts` — `getBinaryFnReturnType`, `getTransformFnInputType`
3. `src/state-control/meta-chain/` — how metadata tables map function names to types

**Path 5 — Understand the ID system**
1. `src/util/brand.ts` — `Brand<K,T>` phantom type
2. `src/compute-graph/idValidation.ts` — creators vs. table-based guards
3. `src/util/idGenerator.ts` — UUID-based ID generation

# Code Analysis Report (2026-02-21)

## Scope and method
- Static review target: current workspace (`src/`), with focus on `compute-graph`, `state-control`, and shared utilities
- Dynamic checks run:
  - `npm test -- --run` -> **11/11 test files passed**, **137/137 tests passed**
  - `npm run lint` -> **35 ESLint errors** (no warnings), mainly in `builder/context.ts` and `runtime/validateContext.ts`

Project snapshot:
- `src/` TypeScript files: **59**
- Test files: **11**
- `compute-graph` files: **30**
- `state-control` files: **19**
- `util` files: **7**

## 1. Code organization and structure
- The codebase is split into three clear layers:
  - `state-control`: typed values, tagging, primitive/array transforms and binary operators.
  - `compute-graph`: graph model, builder DSL, validation, execution runtime.
  - `util`: typed object helpers, enum helper, ID generation, namespace parsing.
- Public entrypoints are cleanly re-exported via `src/index.ts` and `src/compute-graph/index.ts`.
- Runtime pipeline is logically separated:
  - build tree: `src/compute-graph/runtime/buildExecutionTree.ts`
  - execute tree: `src/compute-graph/runtime/executeTree.ts`
  - execute node kinds: `src/compute-graph/runtime/exec/*`
  - validate before execution: `src/compute-graph/runtime/validateContext.ts`
- Builder pipeline is intentionally staged:
  - phase 1 values -> phase 2 functions -> phase 3 context assembly in `src/compute-graph/builder/context.ts`.

## 2. Relations of implementations (types/interfaces)
- Core value typing:
  - Value algebra is centered on `Value<T, BaseType, SubType, Tags>` in `src/state-control/value.ts`.
  - Tags are first-class and propagated by value-builder helpers.
- Graph typing:
  - `ExecutionContext` tables are readonly at type-level (`src/compute-graph/types.ts:155`), encouraging pure execution semantics.
  - `ExecutionTree` discriminated union (`value` / `function` / `conditional`) is strong and readable (`src/compute-graph/runtime/tree-types.ts`).
- Validation typing:
  - `ValidatedContext` brand and discriminated `ValidationResult` are solid patterns (`src/compute-graph/runtime/validateContext.ts:74`, `src/compute-graph/runtime/validateContext.ts:96`).
- Builder typing:
  - User-facing builder API is ergonomic, but some typings are intentionally broad:
    - `combine(..., args: Record<string, ...>)` allows arbitrary arg keys (`src/compute-graph/builder/functions.ts:30`).
    - `buildCombineDefinition` assumes only `a` and `b` (`src/compute-graph/builder/context.ts:727`).

## 3. Relations of implementations (functions)
- Main runtime flow:
  1. `executeGraph` builds execution tree (`buildExecutionTree`).
  2. `executeTree` does post-order execution and state threading.
  3. Leaves/functions update `valueTable` immutably and return `ExecutionResult`.
- Builder flow:
  1. `ctx` collects literals (`inferValue`).
  2. Resolves function refs and emits `funcTable` + `*DefTable`s.
  3. Precomputes `returnIdToFuncId`.
- Validation flow:
  - `validateContext` is a single-pass state-accumulation validator and emits errors vs warnings distinctly.
  - Type rules use transform/binary meta registries from `runtime/typeInference.ts` + `state-control/meta-chain/*`.

## 4. Specific contexts and usages
- Supported graph patterns (confirmed by tests):
  - plain combine DAGs
  - pipe sequences
  - conditional branches including computed conditions and shared dependencies
- Builder usage in tests is practical and expressive (`src/compute-graph/builder/context.test.ts`), especially with `ref.output`, `ref.step`, and transform refs.
- Execution safety posture:
  - happy-path is strongly covered by tests.
  - runtime safety on malformed contexts relies on validation or `executeGraphSafe`.

## 5. Pitfalls (reliability and behavior risks)
1. **Validator/runtime contract mismatch for Pipe steps**
   - `PipeStepBinding.defId` allows `CondDefineId` (`src/compute-graph/types.ts:108`).
   - Validator accepts any existing def (`src/compute-graph/runtime/validateContext.ts:787`).
   - Runtime explicitly throws “not yet implemented” for cond step execution (`src/compute-graph/runtime/exec/executePipeFunc.ts:201`).
   - Risk: contexts pass validation but fail at runtime.

2. **`validateContext` can accept structurally incomplete contexts**
   - `UnvalidatedContext` tables are optional (`src/compute-graph/runtime/validateContext.ts:54`).
   - Missing tables are mostly skipped in validation loops (`src/compute-graph/runtime/validateContext.ts:931` onward).
   - Successful path casts to `ValidatedContext` (`src/compute-graph/runtime/validateContext.ts:966`).
   - Risk: false positives from validator, then runtime crashes.

3. **Builder function output resolution is order-sensitive**
   - Functions are processed in object iteration order (`src/compute-graph/builder/context.ts:281`).
   - `resolveFuncOutputRef` requires referenced function metadata already present (`src/compute-graph/builder/context.ts:641`).
   - Risk: forward references by `ref.output('someLaterFunc')` can fail depending on declaration order.

4. **Type inference shortcuts can misinfer transforms**
   - Generic namespace maps to `number` by default (`src/compute-graph/builder/context.ts:188`).
   - Step output fallback defaults to number (`src/compute-graph/builder/context.ts:1026`).
   - Risk: wrong implicit transforms on non-number flows.

5. **Combine arg shape is not constrained at builder boundary**
   - API permits arbitrary arg keys (`src/compute-graph/builder/functions.ts:32`).
   - Definition builder hardcodes `a` and `b` (`src/compute-graph/builder/context.ts:739`).
   - Risk: silent misuse until validation/runtime.

6. **ID design is permissive and collision-prone under scale**
   - Branded ID creators are unchecked casts (`src/compute-graph/idValidation.ts:50`).
   - Tests explicitly allow empty strings (`src/compute-graph/idValidation.test.ts:31`).
   - Generated IDs use 8 hex chars from `Math.random` (`src/util/idGenerator.ts:36`).
   - Risk: weak invariants and potential collision in large/long-lived contexts.

7. **Conversion/operation edge handling is lenient**
   - `transformFnString::toNumber` uses raw `parseInt` (`src/state-control/preset-funcs/string/transformFn.ts:16`).
   - `divide` has no zero/NaN guard (`src/state-control/preset-funcs/number/binaryFn.ts:23`).
   - Risk: `NaN`/`Infinity` values can propagate without explicit error paths.

8. **Lint gate currently fails**
   - `npm run lint` reports 35 errors (notably in `src/compute-graph/builder/context.ts`, `src/compute-graph/runtime/validateContext.ts`).
   - Risk: style/safety rules are not enforceable as CI quality gate today.

## 6. Improvement points 1 (design overview)
- Choose one contract for Pipe step capabilities:
  - Option A: allow only combine/pipe in `PipeStepBinding`.
  - Option B: fully implement cond step execution in pipe runtime.
- Make validation “structural first”:
  - require all execution tables to exist before deep semantic validation.
- Decouple builder resolution from declaration order:
  - first register function identities and return IDs, then resolve references.

## 7. Improvement points 2 (types/interfaces)
- Tighten builder typing:
  - `combine` args should be `{ a: ..., b: ... }` (or explicit generic arity strategy).
- Tighten ID boundaries:
  - reject empty IDs and possibly enforce prefix format where appropriate.
- Align static and runtime step typing:
  - if cond step is unsupported, remove `CondDefineId` from `PipeStepBinding.defId`.
- Replace broad `Record<string, unknown>` surfaces with narrower validated shapes once parsed.

## 8. Improvement points 3 (implementations)
- `validateContext`:
  - add mandatory table existence checks at start.
  - emit explicit errors for missing root structures.
- Builder:
  - two-pass function processing to eliminate forward-reference failures.
  - improve `inferPassTransform`/step inference to avoid number-default fallback.
- Runtime:
  - either implement cond-step execution in `executePipeFunc` or fail validation earlier.
  - make preset lookup failures explicit in `getBinaryFn`/`getTransformFn` (default throw with detail).
- Numeric conversions:
  - define strict policy for `toNumber`, divide-by-zero, and NaN handling.

## 9. Learning paths on implementations (entry points and goals)
1. **Execution fundamentals**
   - Start: `src/compute-graph/runtime/exec/executeGraph.ts`
   - Then: `src/compute-graph/runtime/buildExecutionTree.ts` + `src/compute-graph/runtime/executeTree.ts`
   - Goal: understand state threading and conditional execution strategy.

2. **Validation and type contracts**
   - Start: `src/compute-graph/runtime/validateContext.ts`
   - Then: `src/compute-graph/runtime/typeInference.ts` + `src/state-control/meta-chain/*`
   - Goal: understand compile-time-like checks and current inference limitations.

3. **Builder internals**
   - Start: `src/compute-graph/builder/functions.ts` + `src/compute-graph/builder/values.ts`
   - Then: `src/compute-graph/builder/context.ts`
   - Goal: understand DSL expansion into execution tables and reference resolution.

4. **Value system and preset operations**
   - Start: `src/state-control/value.ts` + `src/state-control/value-builders.ts`
   - Then: `src/state-control/preset-funcs/*`
   - Goal: understand tag propagation, transform/binary function semantics, and edge-case behavior.

## Reliability summary
- Runtime behavior on tested paths is currently strong (**137 passing tests**).
- Main reliability risk is not test instability but **contract drift** between type model, validator acceptance, and runtime support.
- Short-term priority: resolve validator/runtime mismatches and re-establish a green lint gate.

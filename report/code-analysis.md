# Code Analysis Report (2026-02-21 – 2026-02-22)

## Scope and method

- Static review target: current workspace (`src/`), with focus on `compute-graph`, `state-control`, and shared utilities
- Dynamic checks:

| Session | Tests | Lint |
|---------|-------|------|
| 2026-02-21 | **137/137** passed (11 files) | **35 ESLint errors** |
| 2026-02-22 | **143/143** passed (11 files, +6 from ID guards) | 35 errors (unchanged) |

Project snapshot:
- `src/` TypeScript files: **59**
- Test files: **11**
- `compute-graph` files: **30**
- `state-control` files: **19**
- `util` files: **7**

---

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

---

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
  - User-facing builder API is ergonomic, but some typings were intentionally broad (see Pitfalls 4 and 5 below for fixes applied).

---

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

---

## 4. Specific contexts and usages

- Supported graph patterns (confirmed by tests):
  - plain combine DAGs
  - pipe sequences
  - conditional branches including computed conditions and shared dependencies
- Builder usage in tests is practical and expressive (`src/compute-graph/builder/context.test.ts`), especially with `ref.output`, `ref.step`, and transform refs.
- Execution safety posture:
  - happy-path is strongly covered by tests.
  - runtime safety on malformed contexts relies on validation or `executeGraphSafe`.

---

## 5. Pitfalls

### Pitfall 1 — Validator/runtime contract mismatch for Pipe steps ✅ Fixed (2026-02-22)

**Was:** `PipeStepBinding.defId` allowed `CondDefineId` at the type level; validator accepted it; runtime threw "not yet implemented".

**Fix applied (Option A):**
- `src/compute-graph/types.ts:109` — `PipeStepBinding.defId` narrowed to `CombineDefineId | PipeDefineId`.
- `src/compute-graph/runtime/validateContext.ts` — Added `pipeStepDefIdExistsInContext` helper; `validatePipeDefEntry` now emits an explicit validation error when a cond def appears as a pipe step.
- `src/compute-graph/runtime/exec/executePipeFunc.ts` — Removed dead `isCondDefineId` branch and its import.

**Result:** A context that references a CondFunc in a pipe step is now rejected at validation time, not at execution time.

---

### Pitfall 2 — `validateContext` silently skipped missing tables ✅ Fixed (2026-02-22)

**Was:** All tables in `UnvalidatedContext` were optional; missing tables were silently skipped; the success path cast an incomplete object to `ValidatedContext`.

**Fix applied:**
- `src/compute-graph/runtime/validateContext.ts` — Added `checkRequiredTables` helper called at the very top of `validateContext`. If any of `valueTable`, `funcTable`, `combineFuncDefTable`, `pipeFuncDefTable`, or `condFuncDefTable` is absent, one `ValidationError` is pushed per missing table and the function returns `{ valid: false }` immediately.

**Result:** `validateContext({})` now returns `{ valid: false, errors: [5 errors] }` instead of `{ valid: true }`.

---

### Pitfall 3 — Builder function output resolution was order-sensitive ✅ Fixed (2026-02-22)

**Was:** `resolveFuncOutputRef` required the referenced function's return ID to already exist in `state.returnValueMetadata`. Functions were processed in object iteration order, so forward references (e.g. `ref.output('laterFunc')`) failed at build time.

**Fix applied:**
- `src/compute-graph/builder/context.ts` — Added `lookupReturnId` helper. `processFunctions` now runs two passes:
  1. **Registration pass** — `IdFactory.createReturnValue` is called for every function key, pre-populating `state.returnValueMetadata`.
  2. **Processing pass** — each function is fully processed using `lookupReturnId` instead of re-creating IDs.

**Result:** Declaration order in `ctx()` specs no longer affects whether `ref.output(…)` resolves successfully.

---

### Pitfall 4 — Type inference defaulted to `number` for generic/step-output refs ✅ Fixed (2026-02-22)

Two sub-issues:

**4a — `binaryFnGeneric` namespace hardcoded to `'number'`**

**Was:** `BinaryFnNamespaceToType` mapped `binaryFnGeneric → 'number'`; `inferTransformForBinaryFn` used this map, so e.g. `binaryFnGeneric::isEqual` (which returns `boolean`) was assigned a number pass-transform.

**Fix applied:**
- `src/compute-graph/builder/context.ts` — Removed `BinaryFnNamespaceToType` constant and the `splitPairBinaryFnNames` import. `inferTransformForBinaryFn` now calls `getBinaryFnReturnType` directly and throws if the return type is `null`.

**4b — Step output refs defaulted to `'number'`**

**Was:** `inferPassTransform` had a `// TODO` branch for `StepOutputRef` that unconditionally returned `getPassTransformFn('number')`.

**Fix applied:**
- `src/compute-graph/builder/types.ts` — Added `returnType?: BaseTypeSymbol` to `StepMetadataTable`.
- `src/compute-graph/builder/context.ts` — `buildPipeSequence` now captures and stores the return type from `getBinaryFnReturnType(step.name)`. `inferPassTransform` for `StepOutputRef` now looks up the stored type and throws an explicit error instead of defaulting.

**Result:** Pass-transform inference is now accurate for all supported binary function namespaces and for step output references.

---

### Pitfall 5 — Combine arg shape unconstrained at builder boundary ✅ Fixed (2026-02-22)

**Was:** `combine()` accepted `Record<string, …>` for args; `buildCombineDefinition` hard-coded `a` and `b`; arbitrary keys were silently accepted until runtime/validation.

**Fix applied:**
- `src/compute-graph/builder/types.ts` — `CombineBuilder.args` changed to `{ readonly a: …; readonly b: … }`.
- `src/compute-graph/builder/functions.ts` — `combine()` parameter mirrored to the same shape.

**Result:** TypeScript now rejects `combine(…, { x: 'v1', y: 'v2' })` at compile time.

---

### Pitfall 6 — ID creators accepted empty strings; generator was collision-prone ✅ Fixed (2026-02-22)

Two sub-issues:

**6a — Empty strings accepted**

**Fix applied:**
- `src/compute-graph/idValidation.ts` — All six `create*Id` functions now throw `Error('<Type> cannot be empty')` when passed `''`.
- `src/compute-graph/idValidation.test.ts` — Each "accepts empty string" assertion replaced with `expect(() => create*Id('')).toThrow(…)`. 6 new tests added (143 total).

**6b — 8-hex `Math.random` IDs were collision-prone**

**Fix applied:**
- `src/util/idGenerator.ts` — `generateRandomHex` replaced with a `crypto.getRandomValues`-based implementation producing 16 hex characters (64 bits of cryptographic randomness).
- `src/compute-graph/builder/context.test.ts` — Updated the returnId format regex from `{8}` to `{16}` hex chars.

**Result:** Empty IDs are caught at creation time; generated IDs have 64-bit cryptographic randomness.

---

### Pitfall 7 — Conversion/operation edge handling is lenient (open)

- `transformFnString::toNumber` uses raw `parseInt` (`src/state-control/preset-funcs/string/transformFn.ts:16`).
- `divide` has no zero/NaN guard (`src/state-control/preset-funcs/number/binaryFn.ts:23`).
- Risk: `NaN`/`Infinity` values can propagate without explicit error paths.

### Pitfall 8 — Lint gate fails (open)

- `npm run lint` reports 35 ESLint errors (notably in `src/compute-graph/builder/context.ts`, `src/compute-graph/runtime/validateContext.ts`).
- Risk: style/safety rules are not enforceable as CI quality gate today.

---

## 6. Improvement points 1 (design overview)

- ~~Choose one contract for Pipe step capabilities~~ — resolved (Pitfall 1).
- ~~Make validation "structural first"~~ — resolved (Pitfall 2).
- ~~Decouple builder resolution from declaration order~~ — resolved (Pitfall 3).
- Define strict numeric edge-case policy (Pitfall 7).
- Restore a green lint gate (Pitfall 8).

## 7. Improvement points 2 (types/interfaces)

- ~~Tighten builder typing for `combine` args~~ — resolved (Pitfall 5).
- ~~Tighten ID boundaries (reject empty, stronger generator)~~ — resolved (Pitfall 6).
- ~~Align static and runtime step typing for cond step~~ — resolved (Pitfall 1).
- Replace broad `Record<string, unknown>` surfaces with narrower validated shapes once parsed.

## 8. Improvement points 3 (implementations)

- ~~`validateContext`: add mandatory table existence checks~~ — resolved (Pitfall 2).
- ~~Builder: two-pass function processing~~ — resolved (Pitfall 3).
- ~~Builder: accurate step inference~~ — resolved (Pitfall 4).
- Runtime: either implement cond-step execution in `executePipeFunc` or continue enforcing rejection at validation (current state: rejection enforced).
- Numeric conversions: define strict policy for `toNumber`, divide-by-zero, and NaN handling (Pitfall 7).
- Make preset lookup failures explicit in `getBinaryFn`/`getTransformFn`.

---

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

---

## Reliability summary

| Area | 2026-02-21 | 2026-02-22 |
|------|-----------|-----------|
| Pipe step type contract | Mismatch (runtime throw) | Aligned (type + validation) |
| Validator structural check | False positives on missing tables | Fails fast on missing tables |
| Builder forward references | Order-dependent, fragile | Order-independent (two-pass) |
| Type inference accuracy | `number` default for generic/step | Accurate via `getBinaryFnReturnType` |
| Combine arg constraint | Unconstrained (`Record<string,…>`) | Enforced at compile time (`{a,b}`) |
| ID invariants | Empty allowed; 32-bit PRNG | Empty rejected; 64-bit crypto RNG |
| Numeric edge cases | Unguarded (`NaN`/`Infinity` risk) | **Open** |
| Test coverage | 137/137 (11 files) | 143/143 (11 files) |
| Lint gate | 35 errors | 35 errors (unchanged) |

**Short-term priorities:** resolve the 35 lint errors (Pitfall 8) and add numeric edge-case guards (Pitfall 7).

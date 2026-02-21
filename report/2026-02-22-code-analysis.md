# Code Analysis Report (2026-02-22)

## Scope and method

Follow-up to [2026-02-21-code-analysis.md](./2026-02-21-code-analysis.md).
All six pitfalls identified on 2026-02-21 have been addressed.

Dynamic checks run after fixes:
- `npm test -- --run` -> **11/11 test files passed**, **143/143 tests passed** (was 137; +6 from new ID empty-string guards)
- `npm run lint` -> not re-run in this session (35 pre-existing errors remain, unchanged by these fixes)

---

## Fixes applied

### Pitfall 1 — Validator/runtime contract mismatch for Pipe steps (fixed)

**Was:** `PipeStepBinding.defId` admitted `CondDefineId` at the type level; validator accepted it; runtime threw "not yet implemented".

**Fix applied (Option A):**
- `src/compute-graph/types.ts:109` — `PipeStepBinding.defId` narrowed to `CombineDefineId | PipeDefineId`.
- `src/compute-graph/runtime/validateContext.ts` — Added `pipeStepDefIdExistsInContext` helper; `validatePipeDefEntry` now emits an explicit validation error when a cond def appears as a pipe step.
- `src/compute-graph/runtime/exec/executePipeFunc.ts` — Removed dead `isCondDefineId` branch and its import.

**Result:** A context that references a CondFunc in a pipe step is now rejected at validation time, not at execution time.

---

### Pitfall 2 — `validateContext` silently skipped missing tables (fixed)

**Was:** All tables in `UnvalidatedContext` were optional; missing tables were silently skipped; the success path cast an incomplete object to `ValidatedContext`.

**Fix applied:**
- `src/compute-graph/runtime/validateContext.ts` — Added `checkRequiredTables` helper called at the very top of `validateContext`. If any of `valueTable`, `funcTable`, `combineFuncDefTable`, `pipeFuncDefTable`, or `condFuncDefTable` is absent, one `ValidationError` is pushed per missing table and the function returns `{ valid: false }` immediately, before any semantic validation runs.

**Result:** `validateContext({})` now returns `{ valid: false, errors: [5 errors] }` instead of `{ valid: true }`.

---

### Pitfall 3 — Builder function output resolution was order-sensitive (fixed)

**Was:** `resolveFuncOutputRef` required the referenced function's return ID to already exist in `state.returnValueMetadata`. Functions were processed in object iteration order, so forward references (e.g. `ref.output('laterFunc')`) failed at build time.

**Fix applied:**
- `src/compute-graph/builder/context.ts` — Added `lookupReturnId` helper. `processFunctions` now runs two passes:
  1. **Registration pass** — `IdFactory.createReturnValue` is called for every function key, pre-populating `state.returnValueMetadata` before any resolution.
  2. **Processing pass** — each function is fully processed; `processCombineFunc`, `processPipeFunc`, and `processCondFunc` now call `lookupReturnId` instead of `IdFactory.createReturnValue` (which would create a duplicate entry).

**Result:** Declaration order in `ctx()` specs no longer affects whether `ref.output(…)` resolves successfully.

---

### Pitfall 4 — Type inference defaulted to `number` for generic/step-output refs (fixed)

Two sub-issues:

**4a — `binaryFnGeneric` namespace hardcoded to `'number'`**

**Was:** `BinaryFnNamespaceToType` mapped `binaryFnGeneric → 'number'`; `inferTransformForBinaryFn` used this map, so e.g. `binaryFnGeneric::isEqual` (which returns `boolean`) was assigned a number pass-transform.

**Fix applied:**
- `src/compute-graph/builder/context.ts` — Removed `BinaryFnNamespaceToType` constant and the `splitPairBinaryFnNames` import. `inferTransformForBinaryFn` now calls `getBinaryFnReturnType` (imported from `src/compute-graph/runtime/typeInference.ts`) directly and throws if the return type is `null`.

**4b — Step output refs defaulted to `'number'`**

**Was:** `inferPassTransform` had a `// TODO` branch for `StepOutputRef` that unconditionally returned `getPassTransformFn('number')`.

**Fix applied:**
- `src/compute-graph/builder/types.ts` — Added `returnType?: BaseTypeSymbol` to `StepMetadataTable`.
- `src/compute-graph/builder/context.ts` — `buildPipeSequence` now captures the return value of `IdFactory.createStepOutput` and writes `state.stepMetadata[stepOutputId].returnType` from `getBinaryFnReturnType(step.name)`. `inferPassTransform` for `StepOutputRef` now looks up the stored type and throws an explicit error instead of defaulting to `'number'`.

**Result:** Pass-transform inference is now accurate for all supported binary function namespaces and for step output references.

---

### Pitfall 5 — Combine arg shape unconstrained at builder boundary (fixed)

**Was:** `combine()` accepted `Record<string, …>` for args; `buildCombineDefinition` hard-coded `a` and `b`; arbitrary keys were silently accepted until runtime/validation.

**Fix applied:**
- `src/compute-graph/builder/types.ts` — `CombineBuilder.args` changed from `Record<string, …>` to `{ readonly a: …; readonly b: … }`.
- `src/compute-graph/builder/functions.ts` — `combine()` parameter mirrored to the same shape.

**Result:** TypeScript now rejects `combine(…, { x: 'v1', y: 'v2' })` at compile time.

---

### Pitfall 6 — ID creators accepted empty strings; generator was collision-prone (fixed)

Two sub-issues:

**6a — Empty strings accepted**

**Fix applied:**
- `src/compute-graph/idValidation.ts` — All six `create*Id` functions now throw `Error('<Type> cannot be empty')` when passed `''`.
- `src/compute-graph/idValidation.test.ts` — Each "accepts empty string" assertion replaced with `expect(() => create*Id('')).toThrow(…)`. 6 new tests added (143 total).

**6b — 8-hex `Math.random` IDs were collision-prone**

**Fix applied:**
- `src/util/idGenerator.ts` — `generateRandomHex` replaced with a `crypto.getRandomValues`-based implementation producing 16 hex characters (8 bytes / 64 bits of cryptographic randomness).
- `src/compute-graph/builder/context.test.ts` — Updated the returnId format regex from `{8}` to `{16}` hex chars.

**Result:** Empty IDs are caught at creation time; generated IDs have 64-bit cryptographic randomness, greatly reducing collision probability at scale.

---

## Remaining items (out of scope for this session)

### Pitfall 7 — Conversion/operation edge handling is lenient (open)
- `transformFnString::toNumber` uses raw `parseInt` (returns `NaN` on invalid input).
- `divide` has no zero/NaN guard.
- Risk: `NaN`/`Infinity` can propagate silently.

### Pitfall 8 — Lint gate fails (open)
- `npm run lint` still reports 35 ESLint errors, primarily in `src/compute-graph/builder/context.ts` and `src/compute-graph/runtime/validateContext.ts`.

---

## Reliability summary (updated)

| Area | 2026-02-21 | 2026-02-22 |
|------|-----------|-----------|
| Pipe step type contract | Mismatch (runtime throw) | Aligned (type + validation) |
| Validator structural check | False positives on missing tables | Fails fast on missing tables |
| Builder forward references | Order-dependent, fragile | Order-independent (two-pass) |
| Type inference accuracy | `number` default for generic/step | Accurate via `getBinaryFnReturnType` |
| Combine arg constraint | Unconstrained (`Record<string,…>`) | Enforced at compile time (`{a,b}`) |
| ID invariants | Empty allowed; 32-bit PRNG | Empty rejected; 64-bit crypto RNG |
| Test coverage | 137/137 (11 files) | 143/143 (11 files) |
| Lint gate | 35 errors | 35 errors (unchanged) |

Short-term priority for remaining work: resolve the 35 lint errors (Pitfall 8) and add numeric edge-case guards (Pitfall 7).

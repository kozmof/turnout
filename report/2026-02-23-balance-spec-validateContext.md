# Balance Spec: `validateContext.ts`

- Date: 2026-02-23
- Target: `src/compute-graph/runtime/validateContext.ts`
- Evidence: implementation + unit/integration tests in `src/compute-graph/runtime/validateContext.test.ts` and `src/compute-graph/runtime/validateContext.integration.test.ts`

## CAN (OK)

1. Validation can accept `UnvalidatedContext` input and perform runtime shape checks before semantic checks (`checkRequiredTables`, `validateContext`).
2. Validation can return a discriminated result: `valid: true` includes branded `ValidatedContext`; `valid: false` includes structured errors and warnings (`ValidationResult`, `createValidatedContext`).
3. A `FuncTable` entry can be valid when `kind` is one of `combine | pipe | cond`, `defId` exists, and `returnId` is present (`validateFuncEntry`).
4. `combine`/`pipe` functions can reference IDs in `argMap` that are already in `valueTable` or are function return IDs collected ahead of time (forward references are allowed via `collectReturnIds` + `valueIdExistsInContext`).
5. A combine definition can be valid when it has a known binary function name plus valid `transformFn.a` and `transformFn.b` names (`validateCombineDefEntry`).
6. Type checks can pass when transform outputs match binary parameter types and function argument value types match transform input types (`validateBinaryFnCompatibility`, `validateCombineFuncTypes`).
7. Pipe definitions can be valid when sequence exists, is non-empty, each step has a valid `defId`, and each step binding uses supported sources with valid payloads (`validatePipeDefEntry`, `parseBinding`, `validateBinding`).
8. Pipe step bindings can use:
   - `input` when `argName` exists in pipe args.
   - `step` when `stepIndex` is an integer and strictly less than current step index.
   - `value` when `id` exists in `valueTable`.
9. Cond definitions can be valid when `conditionId` has `source` in `value | func`, referenced IDs exist, condition type is boolean (when inferable), and both branch IDs exist (`validateCondDefEntry`).
10. Cycle checks can run and contexts can pass when there are no dependency cycles in function graph and pipe-definition graph (`checkFunctionCycles`, `checkPipeDefinitionCycles`).
11. Contexts can still be `valid: true` with warnings (unused values/definitions); warnings do not block execution (`validateContext` integration tests).
12. Callers can use `assertValidContext` to throw on invalid context or `isValidContext` as a type guard for runtime narrowing.

## CAN'T (NG)

1. Context cannot be valid if any required table is missing or not an object (`valueTable`, `funcTable`, `combineFuncDefTable`, `pipeFuncDefTable`, `condFuncDefTable`).
2. `FuncTable` entries cannot be non-objects, cannot omit `kind/defId/returnId`, and cannot use unknown `kind`.
3. Function `kind` cannot point to the wrong definition table (e.g., `kind: "pipe"` with combine defId).
4. `combine`/`pipe` function entries cannot omit object `argMap`; `cond` cannot provide non-object `argMap`.
5. `argMap` argument IDs cannot be non-strings or reference IDs not found in value table / collected return IDs.
6. Combine definitions cannot have empty/unknown binary function names.
7. Combine definitions cannot omit transform function object or omit required transform keys (`a`, `b`).
8. Transform function names cannot be unknown/invalid namespaces.
9. Transform output types cannot mismatch expected binary parameter types.
10. Combine function argument actual types cannot mismatch transform input types.
11. Pipe definitions cannot be non-objects, cannot omit/invalid `sequence`, and cannot use empty sequence.
12. Pipe steps cannot be non-objects, cannot omit `defId`, cannot reference unknown definitions, and cannot reference Cond definitions as steps.
13. Pipe steps cannot omit/invalid `argBindings`.
14. Bindings cannot be malformed:
   - unknown binding `source` is invalid,
   - `input` without non-empty `argName` is invalid,
   - `step` without numeric integer `stepIndex` in range is invalid,
   - `value` without non-empty string `id` or with missing value ID is invalid.
15. Cond definitions cannot have malformed `conditionId`, unknown condition source, missing branch IDs, or branch IDs that do not exist.
16. Cond conditions cannot be non-boolean when type is inferable (both value-based and func-based conditions are checked).
17. Context cannot be valid when function dependency cycles or pipe-definition cycles are detected.

## CAN/CAN'T Correlations

1. Required table presence is the gate:
   - CAN: semantic validation runs only after all required tables pass structural checks.
   - CAN'T: missing/non-object required tables immediately produce invalid result.
2. Function identity and linkage:
   - CAN: `kind + defId + returnId` with correct table linkage.
   - CAN'T: unknown kind, missing IDs, or table mismatch.
3. Argument reference policy:
   - CAN: references to existing values and pre-collected function outputs.
   - CAN'T: non-string or unresolved references.
4. Combine type-safety policy:
   - CAN: valid transform names and compatible transform/binary/function argument types.
   - CAN'T: unknown names or any type mismatch at either compatibility layer.
5. Pipe step admissibility policy:
   - CAN: step definitions limited to combine/pipe and well-formed bindings.
   - CAN'T: cond-as-step, malformed steps, malformed bindings, out-of-range step references.
6. Cond control-flow policy:
   - CAN: value/func condition sources with existing IDs and boolean-compatible condition type, valid branches.
   - CAN'T: malformed condition payloads, non-boolean conditions, missing/invalid branch targets.
7. Graph safety policy:
   - CAN: acyclic function and pipe-definition dependency graphs.
   - CAN'T: cycles in either graph.
8. Lint-vs-error policy:
   - CAN: unused values/definitions produce warnings while remaining executable.
   - CAN'T: structural/semantic/type/cycle violations remain hard errors and block valid status.

## Notes on Current Enforcement Boundaries

1. Function return-type inference used during validation is intentionally partial; when a function type cannot be inferred, specific type constraints may be skipped rather than hard-failing (`inferFuncType` behavior).
2. Warning categories currently include unreferenced values and unreferenced definitions; these are non-blocking by design.

# Phase 1 behavior inventory

The TypeScript executor remains the reference implementation. This inventory maps the migration checklist to tests that freeze observable behavior.

## Test suites

| Area | Location |
| --- | --- |
| Tagged Values, builders, conversions, and presets | packages/ts/runtime/src/state-control |
| Compute construction, validation, limits, and execution | packages/ts/runtime/src/compute-graph |
| Actions and prepare, merge, and publish ordering | packages/ts/scene-runner/tests/action-executor.test.ts |
| STATE schema checks, unchecked STATE, and snapshots | packages/ts/scene-runner/tests/state-manager.test.ts |
| Next rules, queues, warnings, limits, and partial STATE | packages/ts/scene-runner/tests/scene-executor.test.ts |
| Routes, matching, transitions, and limits | packages/ts/scene-runner/tests/route-executor.test.ts and route-stepper.test.ts |
| Runner API, cancellation, snapshots, logs, and limits | packages/ts/scene-runner/tests/runner.test.ts |
| Model migration and version checks | packages/ts/scene-runner/tests/migration.test.ts and schema-conformance.test.ts |
| Compiler-to-runner behavior | packages/ts/scene-runner/tests/e2e |

## Required behavior

| Contract | Characterization |
| --- | --- |
| Tagged null reasons, arrays, records, conversions, and purity | value.test.ts, value-builders.test.ts, cross-language-value.test.ts |
| Every preset transform and combine function | preset-funcs.test.ts, templateExtract.test.ts, call-presets.test.ts |
| Binding declaration order and missing compute or root | action-executor.test.ts and compute runtime tests |
| STATE reads and asynchronous prepare hooks | prepare-resolver.test.ts |
| Batched merge writes and schema enforcement | action-executor.test.ts and state-manager.test.ts |
| Publish order, missing hooks, returned failures, and thrown failures | action-executor.test.ts |
| Merge committed before strict publish failure | action-executor.test.ts |
| First-match rules, duplicate enqueue warnings, and termination | scene-executor.test.ts |
| Route matching and transition limits | route-pattern.test.ts, route-stepper.test.ts, route-executor.test.ts |
| Cancellation, limits, and partial STATE | runner.test.ts, scene-executor.test.ts, route-executor.test.ts |
| Errors, warnings, traces, and logs | error-guards.test.ts, execution-warnings.test.ts, trace-utils.test.ts, runner.test.ts |
| Input snapshots prevent caller mutation | model-snapshot.test.ts and runner.test.ts |

## Baseline

Run the gates from a writable temporary directory when the agent sandbox owns the default temporary path.

    TMPDIR=/tmp pnpm run test:ts
    TMPDIR=/tmp pnpm run test:e2e

The baseline recorded on 2026-08-30 passed 1,002 TypeScript unit tests and 73 end-to-end tests. The unit count includes the five cross-language Value vectors added with this inventory.

# Zig runtime compatibility window

The scene runner used a compatibility window while Zig/WASM became the default. The window ended by explicit project decision on 2026-09-01 before a release cycle elapsed.

## Schedule

The window was announced on 2026-09-01. The public runner and harness entry points switched to Zig/WASM on 2026-09-01. The planned release-cycle observation was explicitly waived on 2026-09-01 so Phase 12 could begin.

## What remains stable

Public runner APIs, hook behavior, result shapes, logs, warnings, errors, state values, and execution order remain unchanged. Engine selection stays internal. Applications do not opt into the Zig engine and do not receive a new engine-selection option.

The shipped package continues to include the WASM artifact. Browser and server entry points must load the same validated artifact. Distribution smoke tests must cover both environments that the package supports.

## Rollback path

The deployment rollback control was removed when the window ended. `TURNOUT_SCENE_RUNNER_ENGINE` and `globalThis.__TURNOUT_SCENE_RUNNER_ENGINE__` no longer select the TypeScript executor. The remaining dual-engine seam is test-only and will be removed with the TypeScript executor.

Use the rollback path when a confirmed issue meets any of these conditions.

- Public results, state, hooks, logs, warnings, or errors differ from TypeScript.
- A supported environment cannot load or instantiate the packaged WASM artifact.
- A compiler-to-runner fixture fails only with Zig.
- Zig introduces an unbounded memory increase, host trap, or data corruption.

Record every confirmed issue as a regression test before restoring the Zig default. Benchmark variation alone does not trigger rollback unless it violates an adopted release threshold.

## Exit conditions

The original exit conditions were listed below. The release-cycle condition was waived by explicit project decision.

- The full root `check` passes with Zig as the default.
- Distribution smoke tests exercise the default public runner and server harness.
- No confirmed parity or deployment issue remains open.
- Every confirmed issue has regression coverage.
- Every `packages/ts/runtime` export has a recorded compatibility outcome.
- The rollback control has not been needed for one complete release cycle. Waived on 2026-09-01.

Remove the TypeScript executor and the test-only selector in Phase 12.

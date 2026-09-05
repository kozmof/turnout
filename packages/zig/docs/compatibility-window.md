# Zig runtime compatibility window

The scene runner used a compatibility window while Zig/WASM became the default. The window ended by explicit project decision on 2026-09-01 before a release cycle elapsed.

## Schedule

The window was announced on 2026-09-01. The public runner and harness entry points switched to Zig/WASM on 2026-09-01. The planned release-cycle observation was explicitly waived on 2026-09-01 so Phase 12 could begin.

## What remains stable

Public runner APIs, hook behavior, result shapes, logs, warnings, errors, state values, and execution order remain unchanged. Zig/WASM is the only engine. Applications do not receive an engine-selection option.

The shipped package continues to include the WASM artifact. The package now ships two: `turnout-runtime.wasm` built for speed and `turnout-runtime.compact.wasm` built for size, from the same source. Browser and server entry points may load different artifacts, but only ones built from that shared source and validated by the distribution smoke test, which instantiates each and runs a program through it. Distribution smoke tests must cover both environments that the package supports.

## Regression response

The deployment rollback control was removed when the window ended. `TURNOUT_SCENE_RUNNER_ENGINE` and `globalThis.__TURNOUT_SCENE_RUNNER_ENGINE__` no longer select the TypeScript executor. No internal engine selector remains.

Treat a confirmed issue as release-blocking when it meets any of these conditions.

- Public results, state, hooks, logs, warnings, or errors differ from TypeScript.
- A supported environment cannot load or instantiate the packaged WASM artifact.
- A compiler-to-runner fixture fails only with Zig.
- Zig introduces an unbounded memory increase, host trap, or data corruption.

Record every confirmed issue as a regression test before releasing a fix. Benchmark variation alone does not trigger rollback unless it violates an adopted release threshold.

## Exit conditions

The original exit conditions were listed below. The release-cycle condition was waived by explicit project decision.

- The full root `check` passes with Zig as the default.
- Distribution smoke tests exercise the default public runner and server harness.
- No confirmed parity or deployment issue remains open.
- Every confirmed issue has regression coverage.
- Every `packages/ts/runtime` export has a recorded compatibility outcome.
- The rollback control has not been needed for one complete release cycle. Waived on 2026-09-01.

The TypeScript executor was removed in Phase 12 on 2026-09-02. Public safe wrappers continue to use Zig/WASM.

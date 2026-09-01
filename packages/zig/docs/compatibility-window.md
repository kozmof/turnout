# Zig runtime compatibility window

The scene runner is entering a compatibility window for the Zig/WASM default. The TypeScript executor remains available only as an internal rollback path during this window.

## Schedule

The window was announced on 2026-09-01. The public runner and harness entry points switched to Zig/WASM on 2026-09-01. Keep the TypeScript executor through at least one release cycle after that switch. Remove it only after every exit condition below passes.

## What remains stable

Public runner APIs, hook behavior, result shapes, logs, warnings, errors, state values, and execution order remain unchanged. Engine selection stays internal. Applications do not opt into the Zig engine and do not receive a new engine-selection option.

The shipped package continues to include the WASM artifact. Browser and server entry points must load the same validated artifact. Distribution smoke tests must cover both environments that the package supports.

## Rollback path

The TypeScript executor remains compiled and testable during the window. The default-selection implementation provides an internal rollback control for deployments. It is not exported from the package entry point.

For Node, set `TURNOUT_SCENE_RUNNER_ENGINE=typescript` before importing the package. For browser hosts, set `globalThis.__TURNOUT_SCENE_RUNNER_ENGINE__ = "typescript"` before importing the package. The selector reads the control before loading WASM, so rollback still works when WASM loading or instantiation is the failure.

Use the rollback path when a confirmed issue meets any of these conditions.

- Public results, state, hooks, logs, warnings, or errors differ from TypeScript.
- A supported environment cannot load or instantiate the packaged WASM artifact.
- A compiler-to-runner fixture fails only with Zig.
- Zig introduces an unbounded memory increase, host trap, or data corruption.

Record every confirmed issue as a regression test before restoring the Zig default. Benchmark variation alone does not trigger rollback unless it violates an adopted release threshold.

## Exit conditions

End the compatibility window only when all of these conditions pass.

- The full root `check` passes with Zig as the default.
- Distribution smoke tests exercise the default public runner and server harness.
- No confirmed parity or deployment issue remains open.
- Every confirmed issue has regression coverage.
- Every `packages/ts/runtime` export has a recorded compatibility outcome.
- The rollback control has not been needed for one complete release cycle.

After the window, remove the TypeScript executor and the internal selector in Phase 12.

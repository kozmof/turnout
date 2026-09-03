# Zig scene runtime migration

The scene runner now executes scenes and routes only through Zig/WASM. The TypeScript package keeps the existing public runner, harness, hook, state, trace, warning, error, and safe-wrapper APIs.

## Removed implementation

- The TypeScript scene, action, compute, and route executors were removed.
- Internal engine selection and deployment rollback controls were removed.
- Reference-only executor tests and the TypeScript function-alias map were removed.
- The shared alias generator now produces only the Zig function-alias map.

## Compatibility

`createRunner`, `createSceneRunner`, `createRouteRunner`, `runHarness`, and `runServerHarness` retain their public contracts. `executeSceneSafe` and `executeRouteSafe` remain available and run through Zig/WASM. JavaScript state and error utilities required by the compatibility matrix remain in the package.

The packaged WASM path is `runtime/zig-runtime/turnout-runtime.wasm`. `turnout-scene-runner` consumes the client and default instance exported by `runtime/zig-runtime`.

## Verification

The expanded migration passed the root `pnpm check` gate with `TMPDIR=/tmp` on 2026-09-03. The verification included generated-code drift checks, 127 Zig tests, 408 TypeScript runtime tests, 391 scene-runner tests, Go vet and race checks, package builds, distribution smoke tests, and coverage gates. Runtime branch coverage was 90.61 percent. Scene-runner branch coverage was 90.70 percent.

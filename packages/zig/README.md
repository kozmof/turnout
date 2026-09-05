# Turnout Zig runtime

This package is the execution core for Turnout. The TypeScript runtime package loads the packaged Zig/WASM module, and the scene runner consumes that shared adapter for its public JavaScript API.

The first transport is the sanitized JSON emitted by the Go converter. Zig validates that boundary before it creates runtime state. Host work stays outside Zig and crosses the ordered prepare and publish effect interface.

Run the native and WASM core checks from the repository root.

    pnpm run check:zig

## Layers

The package splits into feature layers that mirror the TypeScript packages. Each layer is its own Zig module.

| Module | Path | TypeScript counterpart |
| --- | --- | --- |
| `turnout_runtime` | `runtime/src` | `packages/ts/runtime` |
| `turnout_scene_runner` | `scene-runner/src` | `packages/ts/scene-runner` |
| `turnout_wasm_abi` | `wasm/src` | the ABI both packages call through |

`turnout_runtime` holds Values, preset functions, the lowered program form, and the authoring engine that backs the TypeScript builder API. Execution reaches `preset/` and `program/`; `authoring/` is off that path. It never imports the scene-runner layer. `turnout_scene_runner` holds the model, STATE, and the action, scene, and route drivers, and it imports `turnout_runtime`. The dependency runs one way. `turnout_wasm_abi` composes both layers into the exported WASM surface.

Cross-layer code imports the module rather than the file. Inside `scene-runner/src`, reach a Value type through `@import("turnout_runtime").value`.

## Current scope

- JSON runtime projection and version validation
- Retained JSON model decoding with byte and nesting limits
- Tagged scalar, array, and record values
- Allocator-owned Value builders, cloning, guards, and cleanup
- Recursive protobuf JSON Value conversion
- Structural Value equality
- Stable tag union order
- JavaScript-compatible rounding and UTF-16 string length
- Generated function aliases from spec/fn-aliases.json
- Prepare and publish effect request types
- Stable effect IDs and resume misuse checks
- Cancellation as a terminal state
- Compute, action, scene, and route execution
- Model lowering: scenes, actions, routes, compute programs, and STATE schemas are resolved once when a model is created, and executed from that form
- Versioned WASM allocation, lifecycle, and effect-result APIs
- Native and WASM execution of the same 145 core tests

## WASM artifacts

The build produces freestanding WASM from one source in two shapes, because the two deployments want opposite things.

| Step | Output | Mode | Size | For |
| --- | --- | --- | ---: | --- |
| `wasm` | `zig-out/bin/turnout-runtime.wasm` | `Debug`, or `-Doptimize` | 3.3 MB | development and the test suites |
| `wasm-dist` | `zig-out/dist/turnout-runtime.wasm` | `ReleaseFast` | 2.8 MB | a server or CLI host |
| `wasm-dist` | `zig-out/dist/turnout-runtime.compact.wasm` | `ReleaseSmall` | 0.4 MB | a browser, which downloads it first |

The compact build is about a seventh of the size for about 14% less throughput. Both release builds are roughly 2.7x the debug one; see [docs/performance-redesign.md](./docs/performance-redesign.md).

The two output directories are separate so a development build cannot be packaged by mistake. `pnpm run build:zig` builds the development artifact; `pnpm run build:zig:dist` builds both distributed ones, and packaging reads only from `zig-out/dist`. The test suites load the development artifact, which keeps rebuilds fast and safety checks on.

The runtime package build validates and copies both artifacts into its distribution, and the distribution smoke test instantiates each and runs a program through it. `turnout-scene-runner` imports the shared client instead of shipping another copy.

## Test expectations

Add a Zig unit test for every public runtime operation, validation error, ownership path, and execution branch. Add a regression test for every parity gap. Run the same portable core suite natively and under WASM.

Zig discovers tests only inside the module under test, so every layer builds its own test binary. `pnpm run test:zig:wasm` builds one WASI artifact per module and runs all of them with Node.

Zig 0.16.0 does not provide the repository with a stable source-coverage report. The current gate requires passing tests and leak detection through std.testing. Add a numeric coverage threshold only after the chosen Zig coverage tool produces reproducible local and CI results.

JSON-first transport does not generate Zig model code. The shared function-alias specification generates a Zig lookup table, and the root drift check verifies it.

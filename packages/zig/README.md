# Turnout Zig runtime

This package is the execution core for Turnout. The TypeScript runtime package loads the packaged Zig/WASM module, and the scene runner consumes that shared adapter for its public JavaScript API.

The first transport is the sanitized JSON emitted by the Go converter. Zig validates that boundary before it creates runtime state. Host work stays outside Zig and crosses the ordered prepare and publish effect interface.

Run the native and WASM core checks from the repository root.

    pnpm run check:zig

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
- Versioned WASM allocation, lifecycle, and effect-result APIs
- Native and WASM execution of the same 127 core tests

The build produces the freestanding WASM module packaged by `runtime`. The runtime package build validates and copies that artifact into its distribution; `turnout-scene-runner` imports the shared client instead of shipping another copy.

## Test expectations

Add a Zig unit test for every public runtime operation, validation error, ownership path, and execution branch. Add a regression test for every parity gap. Run the same portable core suite natively and under WASM. `pnpm run test:zig:wasm` builds the WASI test artifact and runs it with Node.

Zig 0.16.0 does not provide the repository with a stable source-coverage report. The current gate requires passing tests and leak detection through std.testing. Add a numeric coverage threshold only after the chosen Zig coverage tool produces reproducible local and CI results.

JSON-first transport does not generate Zig model code. The shared function-alias specification generates a Zig lookup table, and the root drift check verifies it.

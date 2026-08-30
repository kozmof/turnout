# Turnout Zig runtime

This package is the new execution core for Turnout. The TypeScript executor remains the reference engine while the port moves through the conformance gates.

The first transport is the sanitized JSON emitted by the Go converter. Zig validates that boundary before it creates runtime state. Host work stays outside Zig and crosses the ordered prepare and publish effect interface.

Run the current native checks from the repository root.

    pnpm run check:zig

## Current scope

- JSON runtime projection and version validation
- Retained JSON model decoding with byte and nesting limits
- Tagged scalar, array, and record values
- Recursive protobuf JSON Value conversion
- Structural Value equality
- Stable tag union order
- JavaScript-compatible rounding and UTF-16 string length
- Prepare and publish effect request types
- Stable effect IDs and resume misuse checks
- Cancellation as a terminal state

Scene execution, compute execution, WASM packaging, and the TypeScript adapter are not implemented yet. Keep the TypeScript executor enabled until the matching migration phases pass.

## Test expectations

Add a Zig unit test for every public runtime operation, validation error, ownership path, and execution branch. Add a regression test for every parity gap. Run the same portable core vectors natively and under WASM once the WASM target exists.

Zig 0.16.0 does not provide the repository with a stable source-coverage report. The current gate requires passing tests and leak detection through std.testing. Add a numeric coverage threshold only after the chosen Zig coverage tool produces reproducible local and CI results.

JSON-first transport does not generate Zig model code. The protobuf generation and generated-code drift tasks are not applicable unless a later approved decision adds protobuf transport.

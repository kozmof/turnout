# Turnout Zig runtime

This package is the new execution core for Turnout. The TypeScript executor remains the reference engine while the port moves through the conformance gates.

The first transport is the sanitized JSON emitted by the Go converter. Zig validates that boundary before it creates runtime state. Host work stays outside Zig and crosses the ordered prepare and publish effect interface.

Run the current native checks from the repository root.

    pnpm run check:zig

## Current scope

- JSON runtime projection and version validation
- Tagged scalar, array, and record values
- Structural Value equality
- Stable tag union order
- JavaScript-compatible rounding and UTF-16 string length
- Prepare and publish effect request types
- Stable effect IDs and resume misuse checks
- Cancellation as a terminal state

Scene execution, compute execution, WASM packaging, and the TypeScript adapter are not implemented yet. Keep the TypeScript executor enabled until the matching migration phases pass.

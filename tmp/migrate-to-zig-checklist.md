# Turnout Zig runtime migration checklist

Use this checklist with [migrate-to-zig.md](./migrate-to-zig.md). Complete phases in order. Do not close a phase until its exit gate passes.

## Status

| Field | Value |
| --- | --- |
| Owner | Codex implementation agent |
| Current phase | 7 |
| Last verified commit | `c97a3b5` |
| Last updated | 2026-08-30 |
| Blocking issue | The prepare and publish effect state machine is incomplete |

- [x] Record the migration owner
- [x] Record the current phase
- [x] Link open decisions in [runtime-contract.md](../packages/zig/docs/runtime-contract.md)
- [x] Link active blockers in the status table above

## Phase 1. Freeze current behavior

- [x] Keep the TypeScript executor as the reference
- [x] Inventory existing `packages/ts/runtime` tests
- [x] Inventory existing `packages/ts/scene-runner` tests
- [x] Inventory compiler-to-runner tests under `tests/e2e`
- [x] Characterize tagged Values, null reasons, arrays, records, and conversions
- [x] Characterize every preset transform and combine function
- [x] Characterize compute binding order and missing compute or root behavior
- [x] Characterize STATE reads and asynchronous prepare hooks
- [x] Characterize batched merge writes and merge warnings
- [x] Characterize schema-managed and unchecked STATE
- [x] Characterize publish order, missing hooks, and failure modes
- [x] Verify merge remains committed after strict publish failure
- [x] Characterize first-match next rules and duplicate enqueue warnings
- [x] Characterize route matching and scene transitions
- [x] Characterize model migration and version rejection
- [x] Characterize cancellation, execution limits, and partial STATE
- [x] Characterize errors, warnings, traces, and log events
- [x] Characterize model and initial-state snapshots

### Phase 1 exit gate

- [x] `pnpm run test:ts` passes
- [x] `pnpm run test:e2e` passes
- [x] Observable behavior needed for parity is covered in [phase-1-inventory.md](../packages/zig/docs/phase-1-inventory.md)

## Phase 2. Define compatibility contracts

- [x] Inventory every export from `packages/ts/runtime/src/index.ts`
- [x] Inventory every export from `packages/ts/scene-runner/src/index.ts`
- [x] Inventory the server entry point
- [x] Assign each runtime export a retention, wrapper, deprecation, or removal outcome
- [x] Record the compatibility window for deprecated APIs. No API is currently approved for deprecation.
- [x] Freeze Runner factory signatures
- [x] Freeze `next()`, `run()`, `runAsync()`, `result()`, and `partialState()`
- [x] Freeze hook registration behavior
- [x] Freeze result, trace, warning, and error shapes
- [x] Freeze cancellation, logging, and limit behavior
- [x] Define IEEE-754 number behavior
- [x] Define integers, overflow, and non-finite numbers
- [x] Define JavaScript-compatible string behavior
- [x] Define Value equality and conversion
- [x] Define record ordering and serialization

### Phase 2 exit gate

- [x] Export compatibility matrix reviewed
- [x] Cross-language Value contract reviewed
- [x] No public API removal remains implicit

## Phase 3. Define the runtime model

- [x] List runtime fields retained from `TurnModel`
- [x] List compiler-only fields stripped from the runtime projection
- [x] Define model and runtime version checks
- [x] Define absent-field and unknown-field behavior
- [x] Define `google.protobuf.Value` conversion
- [x] Add Go tests for projection sanitization
- [x] Create representative full-schema fixtures
- [x] Cover optional fields, reserved fields, maps, and recursive messages
- [x] Spike `google.protobuf.Value` decoding in Zig
- [x] Evaluate candidate Zig protobuf generators
- [x] Choose JSON-first or protobuf transport
- [x] If selected, add Go `-format proto`. Not applicable because JSON was selected.
- [x] If selected, test JSON and protobuf projection equivalence. Not applicable because JSON was selected.
- [x] Pin the Zig compiler and selected generator. Zig 0.16.0 is pinned and no generator is selected.

### Phase 3 exit gate

- [x] Runtime projection approved
- [x] Zig decodes every representative fixture
- [x] Transport decision recorded
- [x] Generation is reproducible. JSON-first requires no generated Zig model.

## Phase 4. Scaffold Zig and root integration

- [x] Add `packages/zig/build.zig` and `build.zig.zon`
- [x] Add the initial `packages/zig/src` modules
- [x] Add Zig unit-test and formatting commands
- [x] Add reproducible Zig model generation. Not applicable for JSON-first transport.
- [x] Extend generated-code drift checks for the generated Zig function alias map.
- [x] Add Zig to the development container
- [x] Add Zig build and test steps to CI
- [x] Add Zig checks to root `check`, `build`, and `test`
- [x] Define Zig coverage expectations
- [x] Exclude generated Zig from formatting if needed. The alias generator emits formatter-stable Zig.

### Phase 4 exit gate

- [x] A clean checkout generates, builds, checks, and tests Zig
- [x] Root checks detect stale generated Zig. Not applicable while the runtime has no generated Zig.
- [x] Existing Go and TypeScript checks pass

## Phase 5. Port Values and compute execution

- [x] Implement tagged Values, null reasons, and purity tags
- [x] Implement arrays, records, builders, and guards
- [x] Implement Value conversion
- [x] Implement every preset transform and combine function
- [x] Implement function aliases
- [x] Implement compute model loading and validation
- [x] Implement binding execution in declaration order
- [x] Implement compute root resolution
- [x] Implement missing compute and root behavior
- [x] Add shared Value and preset-function vectors
- [x] Add compute parity fixtures
- [x] Add compute complexity and nesting limits

### Phase 5 exit gate

- [x] Shared Value vectors pass in TypeScript and Zig
- [x] Shared preset-function vectors pass in TypeScript and Zig
- [x] Compute results and errors match

## Phase 6. Port STATE, actions, scenes, and routes

- [x] Implement STATE initialization and snapshots
- [x] Implement STATE schema validation
- [x] Implement checked and unchecked STATE
- [x] Implement STATE reads and batch writes
- [x] Implement merge warnings
- [x] Implement action execution
- [x] Implement first-match next rules and action queueing
- [x] Implement duplicate enqueue warnings and scene termination
- [x] Implement partial STATE on failure
- [x] Implement route matching and scene transitions
- [x] Implement scene and route limits
- [x] Implement stable warnings and runtime errors
- [x] Implement execution traces and log events
- [x] Add scene and route parity fixtures

### Phase 6 exit gate

- [x] Hook-free models match the TypeScript executor
- [x] Final and partial STATE match
- [x] Traces, warnings, logs, and errors match

## Phase 7. Add the effect state machine

- [x] Define prepare and publish effect requests
- [x] Define stable effect IDs
- [ ] Include scene, action, hook, and callback context
- [ ] Implement `Runtime.step()`
- [ ] Implement `Runtime.resume()`
- [x] Define whether `resume()` advances execution
- [ ] Preserve prepare and publish declaration order
- [ ] Preserve missing-hook behavior
- [ ] Preserve returned and thrown publish failures
- [ ] Preserve `failOnPublishError`
- [ ] Preserve committed STATE after strict publish failure
- [x] Reject stale, duplicate, and wrong-kind results
- [x] Implement cancellation as a defined terminal state
- [ ] Add replay and malformed-effect tests

### Phase 7 exit gate

- [ ] Scripted effects reproduce TypeScript results
- [ ] Effect order and context match
- [ ] Replay, misuse, cancellation, and failure tests pass

## Phase 8. Add the WASM boundary

- [ ] Define byte-buffer request and response formats
- [ ] Define handle and buffer ownership
- [ ] Export allocation and release functions
- [ ] Export runtime create, destroy, step, and resume
- [ ] Return structured statuses instead of traps
- [ ] Enforce model, STATE, nesting, and effect-result limits
- [ ] Add malformed-input and lifecycle tests
- [ ] Add leak checks where tooling permits
- [ ] Run core tests under WASM
- [ ] Package the WASM artifact for `scene-runner`

### Phase 8 exit gate

- [ ] Native and WASM core tests agree
- [ ] Invalid input does not trap the host
- [ ] Ownership rules are documented and tested

## Phase 9. Integrate `scene-runner`

- [ ] Add `packages/ts/scene-runner/src/zig-runtime`
- [ ] Add the WASM loader and effect dispatcher
- [ ] Add internal engine selection with TypeScript as the initial default
- [ ] Adapt `Runner.next()` while preserving action-level stepping
- [ ] Preserve `run()`, `runAsync()`, `result()`, and `partialState()`
- [ ] Preserve hook registration
- [ ] Preserve abort signals, logging, and limits
- [ ] Preserve harness and server entry points
- [ ] Update distribution smoke tests
- [ ] Test WASM loading in supported environments

### Phase 9 exit gate

- [ ] Public API tests pass against both engines
- [ ] Distribution smoke tests pass with WASM
- [ ] No caller-facing difference remains unexplained

## Phase 10. Reach conformance

- [ ] Run every accepted fixture through both engines
- [ ] Compare `Runner.next()` results
- [ ] Compare final and partial STATE
- [ ] Compare traces and publish outcomes
- [ ] Compare warning kinds and order
- [ ] Compare structured log events
- [ ] Compare error codes and context
- [ ] Compare ordered effect requests
- [ ] Run compiler-to-runner tests through Zig
- [ ] Add a fixture for every discovered parity gap
- [ ] Document approved representation-only normalization
- [ ] Record performance and memory baselines
- [ ] Verify native and WASM limits

### Phase 10 exit gate

- [ ] The selected conformance suite passes
- [ ] Existing end-to-end fixtures pass through Zig
- [ ] No correctness or compatibility blocker remains
- [ ] Performance and memory results are recorded

## Phase 11. Switch the default

- [ ] Announce the compatibility window
- [ ] Make Zig/WASM the default engine
- [ ] Keep an internal rollback path during the window
- [ ] Run the full root `check`
- [ ] Run distribution smoke tests
- [ ] Monitor parity and deployment issues
- [ ] Add regression tests for every confirmed issue
- [ ] Implement all `packages/ts/runtime` compatibility outcomes

### Phase 11 exit gate

- [ ] Zig/WASM completes the compatibility window
- [ ] No unresolved rollback condition remains
- [ ] Root checks and distribution tests pass

## Phase 12. Remove duplicate execution

- [ ] Remove the TypeScript scene executor
- [ ] Remove internal engine selection
- [ ] Remove reference-only dependencies
- [ ] Remove obsolete tests only after equivalent conformance coverage exists
- [ ] Keep JavaScript utilities required by the compatibility matrix
- [ ] Update package and architecture documentation
- [ ] Run generated-code drift checks
- [ ] Run the full root `check`
- [ ] Run compiler-to-Zig end-to-end tests
- [ ] Verify no TypeScript scene or route semantics remain

### Phase 12 exit gate

- [ ] Zig is the only scene and route executor
- [ ] Every completion criterion in `migrate-to-zig.md` passes
- [ ] Migration release notes are ready

## Follow-up work

These items do not block removal of the TypeScript executor.

- [ ] Add native libraries when a host requires them
- [ ] Add a C ABI when a host requires it
- [ ] Add IPC when a deployment requires it
- [ ] Add a standalone Zig CLI when a workflow requires it

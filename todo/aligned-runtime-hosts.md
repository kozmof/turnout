# Align the two runtime paths: Go → TypeScript and Go → Zig

> Status: phases 0, 1a and 2 landed; 1b abandoned with reasons; 3-4 proposed
> Decisions taken: the direct path is a **native Zig host with a CLI**, and the
> **host half moves down into Zig** rather than being written once per host.
> Origin: the pipeline documented as `.tu → Go → model → TypeScript runtime` is
> actually `.tu → Go → model → TypeScript host → WASM ABI → Zig`, and the
> TypeScript leg executes nothing. Aligning "interface and ability" across two
> paths first requires admitting there is currently one path, with a host half
> that only one language has.

## Where the boundary sits today

```
.tu ──[Go]──> proto-JSON model ──[TS: re-project, encode]──> WASM ABI ──> Zig
                                                                          │
                          all execution: values, presets, compute,        │
                          action/scene/route drivers, STATE, merge  ──────┘
```

The TypeScript runtime package holds no engine. `executeGraph`
(`packages/ts/runtime/src/compute-graph/runtime/exec/executeGraph.ts:26`) calls
`defaultZigRuntimeClient.compute`. Every preset is a Proxy over `callZigPreset`
(`packages/ts/runtime/src/state-control/preset-funcs/zig-preset.ts:31`). What
TypeScript owns is the *host half*: the effect pump, hook dispatch, trace
assembly, warning ordering, the error taxonomy, and the stepping API.

Zig owns the engine and nothing else. `packages/zig/build.zig` produces native
test binaries, WASI test artifacts, and freestanding WASM — no executable, no
static library, no C ABI. Its only caller is a JavaScript host.

Go owns the compiler and nothing else. `go.mod` is protobuf and nothing else;
the CLI is `convert`, `validate`, `version`.

So the two paths named in the goal do not exist yet. There is one path, and the
second one needs the half of the runtime that currently lives in `.ts` files.

### Four misalignments, in the order they bite

**1. One projection rule, three implementations.** Go strips compiler-only
fields (`internal/emit/json.go:63`), TypeScript independently re-strips the same
fields (`packages/ts/scene-runner/src/model-encoding.ts:35`), and Zig rejects
them on arrival (`packages/zig/docs/runtime-contract.md`). Nothing ties the
three together. It is also the measured cost: per
`todo/zig-architecture-redesign.md` step 8, roughly 90% of the ~1240 µs a runner
costs to create is the TypeScript `toJson` → `structuredClone` → re-serialize
chain, per runner.

**2. The ability set is split at the host boundary and only TypeScript has the
host half.** Zig deliberately does not call hooks; it emits effect requests and
waits for `resume`. Everything between suspensions — what context a prepare hook
sees, when an extend merge lands, how warnings are ordered, what `next(steps)`
counts, which error code a failure gets — is TypeScript. A second host written
today would reimplement all of it and drift.

**3. The normative specs do not mention Zig.** `grep -i zig spec/*.md` returns
nothing. Every `CAN (OK)` / `CAN'T (NG)` ability table in `spec/` is written for
"the TypeScript runtime", while the engine's real contract sits in
`packages/zig/docs/runtime-contract.md` in a different vocabulary. Ability is
declared twice, cross-checked never.

**4. The version gate skips the compiler.** `scripts/check-runtime-versions.mjs`
pins the TypeScript and Zig model and ABI versions to
`spec/runtime-versions.json`. `internal/emit/json.go:19` hardcodes
`jsonModelVersion = 2` outside the gate — the one leg that *stamps* the version
is the one leg not checked.

## What "the host half" contains, piece by piece

Verdicts assume the two decisions above.

| Piece | Where it is now | Verdict |
| --- | --- | --- |
| Effect pump loop | `runner-adapter.ts:84` `advanceZigRuntime` | Policy moves down; suspension stays at the boundary |
| Prepare-context accumulation | `runner-adapter.ts:186` `recordPreparedValues` | **Moved down** (phase 1a) |
| Prepare binding index | `runner-adapter.ts:272` `buildPrepareIndex` | **Deleted** (phase 1a) |
| `from_state` context construction | `prepareInitialContext` callback | **Deleted** (phase 1a) |
| Extend ordering, multi-model pre-merge | `effect-dispatcher.ts:79` `dispatchExtend` | Moves down — `merge.zig` already holds the rules |
| Trace assembly, warning order | `runner-adapter.ts:347` `actionTrace` | **Stays** — already structured below the boundary; the host only renders it (1b) |
| Publish outcome collection | `runner-adapter.ts:207` | **Stays** — the engine sends the outcomes; collecting them is four lines (1b) |
| Error taxonomy | `errors.ts` (6 code enums) | Codes move down; message wording stays per host |
| `next`/`run`/`runAsync`/`isDone` and their guards | `runner-methods.ts` | **Stays** — counting actions, and guards against misuse of a JavaScript API (1b) |
| Model migration, validation, dispatch resolution | `migration.ts`, `validate-model.ts`, `dispatch.ts` | Moves down — Zig validates the same model again today |
| Model encoding / re-projection | `model-encoding.ts` | Deletes, replaced by the shared projection artifact |
| **Hook invocation itself** | `effect-dispatcher.ts` | **Stays in the host, by physics** — it is user code in the host's language |
| StateManager | `state/state-manager.ts` | Stays — already a thin binding over the Value ABI |

The last two rows are the whole shape of the answer. A host supplies hooks and
renders messages; everything else is engine.

## The ABI change: from event stream to runner

> Not taken. Phase 1b found the premise does not hold — see "Phase 1b:
> abandoned, and why". Kept as the record of what was proposed and rejected.

ABI v1 hands the host an event stream and expects it to run the state machine.
That is the reason the host half exists. ABI v2 raises the boundary:

- `turnout_runner_next(handle, steps)` and `turnout_runner_run(handle)` loop
  inside Zig, returning only when a hook must be called or the step budget is
  spent. The suspension mechanism is unchanged — `step`/`resume` semantics stay
  exactly as `runtime-contract.md` describes them — but the policy between
  suspensions becomes Zig's.
- The completion payload carries the assembled trace, ordered warnings, and
  publish outcomes, so no host reassembles them.
- Stepping guards (`LateHookRegistration`, `ConcurrentExecution`,
  `InvalidStepCount`, `IncompleteExecution`) become runtime states with codes,
  not per-host assertions.

This is a breaking ABI change: `spec/runtime-versions.json` `abi` goes 1 → 2
under the rules in `packages/zig/docs/compatibility-window.md`.

## The native host

With ABI v2 dropped, the native host's shape is simpler than this plan first
had it: the CLI is a second shell over the engine, alongside the WASM one, and
brings its own hook transport. Nothing moves out of `scene-runner/src` to make
room for it.

```
packages/zig/
  runtime/            unchanged
  scene-runner/src/
    runner.zig        + the state machine: stepping, guards, trace assembly
  host/src/           new — CLI, hook transport, argument parsing
  wasm/src/abi.zig    thinner — the same runner behind the WASM shell
```

`turnout-run model.json --scene vend --hooks ./hooks.sock` serves hooks over
newline-delimited JSON, using the *same* request and result envelopes the ABI
already defines for `needEffect` and `resume`. One effect protocol, two
framings: in-process across the WASM boundary, out-of-process across a socket.
That, rather than a second API, is what makes the two paths aligned.

The CLI verbs should mirror the compiler's, so the pair reads as one tool:
`turnout convert` then `turnout-run run`.

## Alignment artifacts

The repository already has the right mechanism — `spec/fn-aliases.json`,
`spec/field-types.json`, `spec/runtime-versions.json`, each with a drift check
that fails the build. It just does not yet cover the things that matter here.

1. **`spec/runtime-projection.json`** — the retained-field table from
   `runtime-contract.md` as data. Go's `stripNonRuntimeFields`, Zig's loader,
   and the TypeScript encoder all check against it; the TypeScript re-projection
   goes away entirely.
2. **`spec/capabilities.json`** — the ability set as rows (prepare hooks,
   publish hooks, extend merge, routes, scene stepping, snapshots, each limit),
   with a support flag per host. A host claiming a capability it does not
   implement fails the check.
3. **`spec/conformance/host/*.json`** — host-level vectors: one model plus one
   scripted hook set, expected trace, warning order, and error codes. Both hosts
   run them. This is what turns "aligned ability" from an assertion into a gate.
4. **Go joins `check-runtime-versions.mjs`** — `internal/emit/json.go:19`.
5. **The Zig ability tables move into `spec/`** — one normative document
   covering both hosts in the existing `CAN`/`CAN'T` vocabulary;
   `runtime-contract.md` narrows to ABI mechanics.

## Sequencing

Each phase is shippable and gated by the existing suites.

0. ~~**Groundwork, no behaviour change.**~~ Landed. See below.
1. ~~**Runner state machine into `scene-runner/src`, ABI v2.**~~ Partly done and
   partly abandoned. The prepare boundary moved (1a, below); the stepping state
   machine did not, and should not (1b, below).
2. ~~**Capability manifest and host conformance vectors.**~~ Landed. See below.
3. **`packages/zig/host` — the native CLI and hook transport.** It inherits the
   state machine from phase 1 and is validated by the vectors from phase 2.
4. **Go emits the runtime projection directly.** Removes the last re-encode; the
   measurement from `zig-architecture-redesign.md` step 8 says this is where the
   remaining creation cost is.

Phase 1 before 3 is the load-bearing ordering: build the native host first and
the state machine gets written twice, which is the failure this whole plan
exists to prevent.

## Phase 0: what landed

**`spec/runtime-projection.json`.** The projection rule as data: 13 compiler-only
field locations and the retained-field table. Three gates read it.

- Go: `internal/emit/json_projection_spec_test.go` populates every listed field,
  asserts the fixture reaches each one, then asserts `stripNonRuntimeFields`
  clears it. A field added to the spec fails the first assertion until the
  fixture covers it and the second until the emitter strips it.
- TypeScript and Zig: `tests/runtime-projection.test.ts` plants each field at its
  declared path, asserts `runtimeProjection` removes it, and hands the *unstripped*
  model to the runtime expecting `CompilerMetadata`. A control with the same
  shape and a harmless leaf must fail for some other reason, so the rejection is
  attributable to the field rather than the surrounding structure.
- `scripts/check-projection.mjs` pins both sections to the proto. This is the
  check no test can make: a field renamed in the schema would silently disable a
  strip rule matching nothing, and all three suites would still pass.

Verified by breaking each side and watching the right gate fail, not only by
watching them pass.

**The compiler joined the version gate.** `check-runtime-versions.mjs` now pins
`jsonModelVersion` (`internal/emit/json.go:19`) to `spec/runtime-versions.json`,
alongside the two runtimes it already covered. `minVersion` and `maxVersion` are
deliberately left out: they are a compatibility window the compiler may widen,
not a restatement of the model version.

**`spec/runtime-hosts.md`.** The normative documents described a Go compiler
feeding a TypeScript runtime and mentioned Zig zero times, while Zig is the
entire engine. The new document records the engine/host split, the ability lists
each side owns, and the two `CAN`/`CAN'T` tables that go with them, in the
vocabulary the other spec documents already use. `runtime-contract.md` now says
it covers mechanics and points here for abilities; the README's pipeline diagram
says what actually happens.

One thing to carry into phase 2: writing the ability lists down made it clear
they are still prose. `spec/capabilities.json` is what turns them into rows a
host can be checked against, and the projection artifact is the shape it should
copy.

## Phase 1a: the prepare boundary

The first slice of phase 1, and the one that needed no ABI break. Two things a
host had to work out for itself now arrive with the effect request.

**What a hook owes.** A hook supplying several bindings shapes its payload as a
record, and the request's `binding` goes null to say so — which left a host with
no way to know what the several were. `buildPrepareIndex` re-parsed the whole
model to recover them. The schedule builder in `model.zig` already groups
prepare entries by hook, so the list was there; `effect.Request.bindings` now
carries it.

**What a hook reads.** `contextJson` existed but was `"{}"` for every prepare
request: the context was entirely a TypeScript construction, seeded from a full
STATE snapshot per action and accumulated across hook results. The runtime now
builds it — the action's `from_state` bindings resolved through the same
`state.read` execution uses, with earlier hook results layered over them. It
resolves at the first prepare effect that binds values, so an `extend` merge
earlier in the same action can still introduce a field a `from_state` binding
reads, which is the ordering the host was careful about and the engine now keeps.

Net: 211 lines of TypeScript deleted for 39 added, one STATE round trip per
prepare effect gone, and one model parse per runner gone.

Two decisions worth recording. A prepare spec's `context_json` is no longer
honoured — the runtime overrides it — because a caller-supplied context cannot
be told apart from the default, and the runtime is the authority on what a hook
sees. And building a context tolerates a malformed earlier payload rather than
raising on it: execution reports that a moment later, against the hook that
caused it, and raising here would attribute an earlier hook's fault to this one.

The end-to-end test is the one that matters. Unit tests on either side of the
boundary would both pass with it broken, so `tests/e2e/prepare-context.test.ts`
compiles a `.tu` fixture and runs it through the real runtime, asserting what a
hook sees. Verified by disabling the resolution in Zig and watching all three
cases fail.

## Phase 1b: abandoned, and why

The rest of phase 1 — the stepping state machine into Zig, ABI v2 — was not
built. Inspecting what was actually left to move did not support it.

| What remains in the host | What it is |
| --- | --- |
| `actionTrace`, `sceneWarning` (~80 lines) | English wording over data the engine already sends structured: kind, binding, toState, conditionName, actualType, writtenPaths, targetActionId, fromActionId |
| `next`/`run`/`runAsync` (~40 lines) | Counting actions and collecting results into a JavaScript array |
| `LateHookRegistration`, `ConcurrentExecution`, `InvalidStepCount` | Misuse of a JavaScript API: hooks registered on a builder after it started, overlapping awaits, a non-integer argument |
| The effect pump (~60 lines) | Cannot move. Calling a hook is calling host code |

There is no engine logic left in the host. The warnings arrive fully
structured and the host renders them; the guards describe situations a native
CLI does not have; the loop is four lines of counting. Moving any of it down
would produce a worse API in both hosts and change no behaviour.

ABI v2 was justified by "each host writes the state machine, so they will
drift". They cannot drift on anything that matters, because everything that
matters is already below the boundary. What two hosts can still drift on is
what they *claim to do* — which is phase 2, and is where the effort went.

The same mistake was available here as in `zig-architecture-redesign.md` step 8:
optimising the part that was already fine. Recorded so ABI v2 is not
re-proposed without new evidence — a specific behaviour two hosts implement
differently would be that evidence.

## Phase 2: what landed

**`spec/capabilities.json`** lists the capabilities and which host supports
each. **`spec/conformance/host/`** holds 10 vectors across them, and
`scripts/check-capabilities.mjs` fails a capability that owns none: a capability
with no evidence is a claim, not a capability.

The vectors are data, not code in any host's language — a model, a STATE, what
each hook is handed and answers with, and what the run must produce, in the
canonical tagged-Value encoding the ABI already speaks. They assert on values,
ordering, outcomes and error codes, never on wording, because wording is the one
thing a host owns. `tests/e2e/host-conformance.test.ts` runs every one of them
through the TypeScript host; the native host will run the same files.

**They found a bug in phase 1a on their first run.** `requestEffectWithContext`
built the request field by field and never copied `bindings`, so the list
arrived empty at every host. Both the Zig unit tests and the TypeScript ones
passed, because the Zig tests asserted on the schedule and the TypeScript tests
supplied their own request fixtures — neither looked at what actually crossed
the boundary. That is the class of bug conformance vectors exist for, and it
is the argument for phase 2 over ABI v2 in one example.

## Risks

- **ABI v2 is breaking.** The compatibility window rules apply; hosts and
  artifacts must move together.
- **Async hooks.** TypeScript hooks return promises. The Zig runner must stay
  suspension-based and must never block waiting for one. This is already true of
  the ABI and must survive the move.
- **Mid-run merge retains a model per merge** (recorded in
  `zig-architecture-redesign.md`). The native host inherits that; merges happen
  at configuration boundaries, so it stays acceptable.
- **Measure before optimising the native path.** The previous redesign spent
  most of its effort on an execution path that was 2% of wall clock. The same
  mistake is available here.

## Non-goals

- **A Zig protobuf decoder.** Still rejected; JSON stays the transport.
- **Retiring the TypeScript package.** It becomes a binding, not a casualty.
- **A Go host over wazero.** Considered and set aside: the Go binary stays a
  compiler, and the native Zig host serves the no-JavaScript case directly.
- **Two engines.** Nothing here reintroduces execution into TypeScript.

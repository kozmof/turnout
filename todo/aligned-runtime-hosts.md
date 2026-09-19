# Align the two runtime paths: Go → TypeScript and Go → Zig

> Status: phases 0, 1a, 2 and 3 landed; 1b and 4 abandoned with reasons
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
3. ~~**`packages/zig/host` — the native CLI and hook transport.**~~ Landed. See below.
4. ~~**Go emits the runtime projection directly.**~~ Measured first, and the
   measurement said not to. See below.

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

## Phase 3: what landed

`packages/zig/host` is a second shell over the engine, built by
`zig build --build-file packages/zig/build.zig host`:

    turnout-run run flow.json --scene vend --state state.json --hooks answers.json

It loads the JSON the Go compiler emits and runs it in process. No WASM, no
JavaScript, no second engine — `run.zig` is the same pump `abi.zig` performs,
with the host on this side of the boundary instead of the far side.

**The hook transport is the ABI, reframed.** `--hook-program` spawns a program
and speaks newline-delimited JSON to it, one `needEffect` request per line out
and one answer per line back, in the same envelopes the WASM boundary uses. A
hook implementation written against the documented shapes works with either
host without knowing which is asking. `--hooks` reads the same answers from a
file, for a run whose hooks are fixed.

**It passes the shared vectors.** `pnpm run test:native-conformance` runs
`spec/conformance/host` through the native binary; all 10 pass, and the run
verifies `spec/capabilities.json`'s claims for this host rather than taking
them — claiming `supported` where a vector is skipped or failing fails the
check. The worked example of the protocol is `scripts/native-hook-program.mjs`,
which is also what serves the vectors' hooks.

### The taxonomy gap it opened, and how it closed

Two error vectors did not pass at first, and they failed on vocabulary rather
than behaviour: the engine raised `MissingPrepareHook` where the TypeScript host
reported `UnregisteredHook`, and `HookRequired` where it reported
`MissingHookField`. Same failure, same point, two names — so a vector could not
name one without pinning one host's vocabulary on the other.

Closed by moving both checks into the engine, under the vocabulary
`spec/hook-spec.md` already documented. `Runtime.resume` now rejects the answer
rather than waiting for execution to miss the binding:

- a prepare hook answering `missing` is `UnregisteredHook`, raised against the
  hook that did not answer;
- a hook owing several bindings must answer with a record naming all of them,
  or it is `MissingHookField` — the check the TypeScript host was making for
  itself and the native one was not making at all.

Both hosts now report what the engine raised, and both pass all ten vectors.

**Still duplicated, deliberately:** the TypeScript host keeps its own copies of
those two checks, because they fire before the round trip and word the failure
with the field name in it. They agree with the engine because the vectors make
them agree, not by construction. Removing them is the honest finish — it costs
message quality unless the engine carries the detail, which is the trade to
weigh when someone picks this up.

## Phase 4: measured, then abandoned

The plan said the last re-encode is where the remaining creation cost is, on the
authority of `zig-architecture-redesign.md` step 8: "roughly 90% of the ~1240 µs
that creating a runner still costs is TypeScript-side". That was true when it was
written. It is not true now — step 9's model handle landed, and phase 1a removed
a model parse per runner.

Measured before building, on the workload
`packages/zig/docs/performance-baseline.md` describes — 20-action scene, three
bindings per action, 1,000 iterations. The benchmark is
`packages/ts/scene-runner/bench/runner-creation.mjs`, kept so the next person can
re-run it rather than trust this table.

| | µs | share of creation |
| --- | ---: | ---: |
| `snapshotModel` — the defensive deep clone | 403 | 47% |
| `encodeZigRuntimeModel` — **what phase 4 deletes** | 219 | 26% |
| engine create from bytes: parse, validate, index, lower | 123 | 14% |
| `validateModel` | 6 | <1% |
| remainder | ~100 | 12% |
| **creation, unprepared** | **851** | |

And the number that decides it:

| | runs/s | µs/action |
| --- | ---: | ---: |
| created per run | 1,075 | 46.5 |
| against a prepared model | **10,183** | **4.9** |

Creation is 91% of an unprepared run, and preparing removes essentially all of
it — 851 µs becomes 13 µs. So phase 4 deletes 26% of a cost the caller is
already told how to avoid entirely, and **0% of the prepared path**, which is
what the README recommends and what any repeated-run caller should be on.

Two things worth carrying forward instead:

- **If the unprepared path ever needs to be faster, the target is the snapshot,
  not the projection.** It is nearly twice the size of what phase 4 aimed at.
  But it buys a documented property — callers cannot mutate a model out from
  under a running runner, and the identity caches downstream depend on it — so
  that is a design trade, not a cleanup.
- **The projection artifact from phase 0 already did the durable part.** Go, the
  TypeScript encoder and the engine now answer to one declaration of the rule.
  Making Go the only implementation was the performance half of that idea, and
  the performance half is the half that did not pay.

## Recheck: what the conformance vectors were not looking at

A pass over the two hosts after phase 4, asking what could differ without any
gate noticing. Twelve vectors passing on both hosts was true and still hid a
whole ability.

**The manifest's coverage is the manifest's blind spot.** `capabilities.json`
declared three capabilities, so three were checked. Nothing declared model
extension, and nothing therefore checked it — and the native host did not
implement it at all: `run.zig` answered the `extend_model` event with
`error.UnappliedExtend`. A documented language feature, working in one host,
absent in the other, invisible to every gate.

Now implemented natively and declared as `model-extension`, with two vectors.
The merge itself is `merge.zig`, the same implementation the WASM shell and
`mergeModels` call, so there is still one set of rules and one set of messages.

**Two more defects fell out of writing the vector.**

- `runHarness` registered prepare and publish hooks and silently dropped extend
  ones, so every model with an `extend` block was unrunnable through the
  harness — including `runServerHarness`, which is what the end-to-end tests and
  the README's server path use. Two lines missing, no test covering it, because
  no test ran an extend model through the harness.
- A missing extend hook was `UnregisteredHook` in TypeScript and
  `MissingExtendHook` in the engine: the same divergence closed for prepare
  hooks one commit earlier, still open one row down. The engine's name wins, as
  before.

**And one in a shipped example.** `spec/examples/07-plugin-scenes.tu` never
terminated: its `_ -> empty_cart` catchall matches again once `empty_cart`
itself reaches a terminal state, so the route bounced between them until it hit
`MaxRouteTransitionsExceeded`. Both hosts reported the same failure, which is
itself evidence they agree. The example predates `_ -> .`, the terminal
spelling `route-terminal-spelling.md` landed on 2026-09-08; it has an
`empty_cart.say_empty -> .` arm now and runs `triage -> checkout ->
empty_cart` on both hosts.

### Still open, and now written down

| Gap | Where |
| --- | --- |
| `mergeModels` ahead of a run — TypeScript has it, the native host has no CLI for it | undeclared capability |
| Cancellation — TypeScript takes an `AbortSignal`, the native host has none | undeclared capability |
| Prepared models — `prepareModel` amortises creation; the native host is one run per process | arguably not applicable |
| TypeScript's duplicate prepare-answer checks | recorded under phase 1a |
| `scene.executeScene` and `runtime_error.Code` — an engine surface no host reaches, carrying a second, snake_case vocabulary | dead relative to hosts |

The first two are the ones worth declaring next, because the lesson of this pass
is that an undeclared capability is an unchecked one. `todo/host-parity.md`
plans that work, starting with the coverage check that would have caught this
pass's gap before a vector had to.

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

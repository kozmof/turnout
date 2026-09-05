# Runtime redesign measurements

This records what the runtime redesign was measured to do, and what the
measurements showed about where the time in a Turnout run actually goes. It is a
local reference, not a release gate. The engine comparison that preceded it is in
[performance-baseline.md](./performance-baseline.md).

The design it measures is in `todo/zig-architecture-redesign.md`.

## Environment

Recorded on 2026-09-05. Zig 0.16.0, Node v25.9.0, Intel Core i7-14700,
`linux-x86_64` under WSL2. Every "before" figure comes from commit `30c2cfa`,
which is the runtime as a JSON tree interpreter.

Native benchmarks build with `-OReleaseFast` and allocate through
`std.heap.smp_allocator`. They are timed externally with `time`, so each figure
includes process start-up (about 3 ms, small against the totals below). Ranges
are the spread of three consecutive runs.

Benchmarks were written for these measurements and then removed. Nothing in the
tree runs them, so reproducing a figure means writing the benchmark again from
the description here.

## The short version

Inside the runtime, the redesign is worth between 2.5x and 7x depending on the
workload, and it makes execution cost independent of model size rather than
growing with it. End to end through the WASM host it is worth about 10%, because
the runtime was not where the time was going: runner creation dominates.

The larger finding came from checking how the artifact under test was built. The
WASM module that ships is compiled in `Debug`, and has been all along. Building it
in any release mode is worth about 2.7x -- more than everything else here
combined -- and puts the runtime roughly 2.4x ahead of the TypeScript engine it
replaced, rather than behind it.

## Native measurements

### Compute programs

A five-binding numeric program: two literals, an `add` over two references, a
`mul` over that and a literal, and a comparison. 300,000 executions.

| Path | Time |
| --- | ---: |
| Tree interpreter (`30c2cfa`) | 0.46 s |
| Lowered program, lowering on every execution | 0.85 s |
| Lowered program, lowered once | **0.12 s** |

Evaluating a lowered program is 3.8x faster than interpreting the JSON. The
middle row is the one worth keeping: lowering costs about 2.4 us, so a runtime
that lowers per execution is *slower* than one that interprets. The split only
pays once the lowering is hoisted, which is why the model lowers every program
when it is created.

### Full actions

One scene, one action, the same program, with a merge into STATE. 300,000
executions. Includes prepare, compute, merge, and the STATE snapshot.

| | Time |
| --- | ---: |
| `30c2cfa` | 0.38 s |
| After lowering once per model | **0.15 s** |

### Scene and action lookup

A model of 20 scenes with 20 actions each, every action carrying a four-binding
program. 200,000 executions of one action, chosen to be either the first or the
last in the model.

| Action executed | `30c2cfa` | Indexed |
| --- | ---: | ---: |
| First scene, first action | 0.19 s | **0.08 s** |
| Last scene, last action | 0.23 s | **0.08 s** |

The gap between the two rows was the linear scan: finding an action compared id
strings across the scenes array and then across that scene's actions, and the
scan ran again for the entry action, the effect schedule, and next-rule
selection. After indexing, position in the model does not affect execution cost,
which is the property worth holding onto — the previous cost grew with the
model.

### STATE schemas

A model whose single action writes one field, against a STATE schema of *N*
declared fields. 100,000 executions.

| | `30c2cfa` | Shared and pre-parsed |
| --- | ---: | ---: |
| 1 declared field | 0.10 s | **0.03 s** |
| 40 declared fields | 1.79 s | **0.26 s** |
| 40 entries, no schema | 0.21 s | 0.21 s |

The third row is the control: the same number of STATE entries in an unchecked
State, so the only difference is whether a schema is present. Schema handling
went from 8.5x the cost of everything else in an action to almost none of it.

Two things were being paid per action, both for a schema that never changes once
built. The snapshot every action takes before merging duplicated the whole schema
into the copy — a path dupe and a type-string dupe per declared field — and each
write re-parsed its declaration type, `"arr<number>"` and the like, from scratch.

A first attempt fixed neither: `parseSchemaType` returned a struct containing a
128-element node array by value, which looked expensive and was not. Removing
that copy moved 1.79 s to 1.63 s. The allocations were the cost.

### Model creation

Parsing, validating, indexing, and lowering a 20-action model, 10,000 times:
**0.55 s, or about 55 us per model.**

## The optimization mode

Everything below was first measured against the WASM artifact that `pnpm run
build:zig` produces, and that `packages/ts/runtime` packages for distribution.
That command passes no `-Doptimize`, and `std.Build.standardOptimizeOption`
defaults to `Debug`. **The artifact that ships, and every end-to-end figure
published before this document, is a debug build.**

Same workload, same code, four optimization modes:

| Mode | Artifact | runs/s | us/action |
| --- | ---: | ---: | ---: |
| `Debug` (what ships today) | 3.35 MB | 838-868 | 57.6-59.6 |
| `ReleaseSafe` | 2.81 MB | 2156-2237 | 22.4-23.2 |
| `ReleaseFast` | 2.77 MB | **2307-2380** | **21.0-21.7** |
| `ReleaseSmall` | **0.41 MB** | 2030-2060 | 24.3-24.6 |

A release mode is worth about 2.7x, which is more than everything else in this
document combined. `ReleaseSmall` is eight times smaller than the debug artifact
and within 14% of `ReleaseFast`, which matters for a module delivered to
browsers. `ReleaseSafe` keeps the runtime's bounds and overflow checks for about
6% against `ReleaseFast`.

The build now produces both release artifacts, since the trade lands differently
for a server and for a browser. `wasm-dist` builds `turnout-runtime.wasm`
(`ReleaseFast`) and `turnout-runtime.compact.wasm` (`ReleaseSmall`), and the
package ships both. The development build stays `Debug` so the test suites keep
fast rebuilds and safety checks. See the package README for which to load.

This also reframes the finding in [performance-baseline.md](./performance-baseline.md)
that prompted the whole redesign. That baseline recorded Zig/WASM at 533-553
runs/s against TypeScript at 956-996, and concluded TypeScript was 1.8x faster on
compute-heavy work. Reproducing it here with a debug build gives 535-572 runs/s,
matching it closely, which is good evidence the baseline measured a debug
artifact against optimized TypeScript. Built in any release mode, the runtime at
that same commit reaches 2063-2128 runs/s -- already twice the TypeScript figure,
before any of the work in this document.

## End-to-end measurements

The workload from `performance-baseline.md`: 1000 runners over one 20-action
scene, each action evaluating a three-binding numeric program, after 100 warm-up
runners. Runner creation and result decoding are inside the timed window; module
loading and WASM compilation are outside it. Run through the TypeScript host, so
this includes the ABI boundary and the host's model marshalling.

| | runs/s | us/action |
| --- | ---: | ---: |
| Documented Zig/WASM baseline (2026-09-01, different machine) | 533-553 | 90.4-93.8 |
| Documented TypeScript baseline (2026-09-01, different machine) | 956-996 | 50.2-52.3 |
| `30c2cfa`, debug | 535-572 | 87.4-93.4 |
| Redesigned runtime, debug | 575-624 | 80.1-87.0 |
| Redesigned runtime, debug, model parsed once | 838-868 | 57.6-59.6 |
| `30c2cfa`, `ReleaseFast` | 2063-2128 | 23.5-24.2 |
| Redesigned runtime, `ReleaseFast` | **2307-2380** | **21.0-21.7** |

The `30c2cfa` debug row reproduces the documented Zig/WASM baseline closely
enough to treat this machine and that one as comparable.

The fourth row spans two measurement sessions of the same binary, which gave
575-619 and 594-624. The spread between sessions is wider than within one, so
differences under about 10% in this benchmark are not meaningful. On that
standard the redesign is worth about 11% end to end at `ReleaseFast`
(2063-2128 to 2307-2380) and about 8% at debug -- real, and small next to the
build flag.

## Where the time goes

The redesign is worth 2.5x to 7x natively and about 10% end to end. Splitting
runner creation from stepping explains the gap. Same workload, timing the phases
separately:

| Phase | Debug | `ReleaseFast` |
| --- | ---: | ---: |
| `snapshotModel` (`structuredClone` + freeze) | ~161 us | ~155 us |
| `migrateModel` | ~4 us | ~3 us |
| `validateModel` | ~4 us | ~4 us |
| `encodeZigRuntimeModel` | ~56 us | ~51 us |
| Everything else, mostly `turnout_runtime_create` | ~900 us | ~210 us |
| **Creating a runner** | **~1129 us** | **~420 us** |
| Running all twenty actions | ~7-15 us | small |

Execution is a rounding error either way. At debug, creation is about 80% WASM;
at `ReleaseFast` the two sides are roughly even, and `structuredClone` of the
model becomes the largest single identified phase.

One caveat: the run figure is the difference between two measurements of similar
magnitude, and one trial produced a small negative value. Treat it as "small and
hard to measure", not as an exact number.

`RuntimeModel.init` also parsed the model JSON twice, once to validate and once
to keep. Fixing that took creation from ~1604 us to ~1240 us at debug, and the
benchmark from 575-624 to 838-868 runs/s.

## What this means

Built in a release mode, the redesigned runtime runs the baseline workload at
2307-2380 runs/s against the documented TypeScript baseline's 956-996. The goal
this work set out to meet is met, roughly 2.4x over. It would have been met
without the redesign, by the build flag alone.

The redesign is still worth what it measures natively, and it is what makes the
runtime's cost independent of model size rather than growing with it. But its end
-to-end contribution is about 10%, because runner creation dominates and always
did.

The next bottleneck is that creation, and it is now split evenly between the two
languages: `structuredClone` of the model plus three serialization passes on the
TypeScript side, and a full parse, validate, index, and lower on the Zig side --
all of it per runner, for a model that does not change. Both halves are fixed by
the same change: prepare a model once and create many runtimes against it. That
is also the shape of the registry that dynamic scene merging needs.

## What went wrong in measuring this

Recorded because each cost real work.

- **Lowering per execution is slower than interpreting.** The program split only
  pays once lowering is hoisted to model creation. Measuring the intermediate
  state caught a 1.85x regression that reasoning had not predicted.
- **The schema parser's by-value struct copy looked expensive and was not.**
  A 128-element node array returned by value is an obvious suspect; removing the
  copy moved 1.79 s to 1.63 s. The allocations around it were the cost.
- **Runner creation was assumed to be mostly TypeScript. It was not.** An earlier
  revision of this document put roughly 90% of creation on the TypeScript side,
  inferred by subtracting a native measurement from an end-to-end one. Measuring
  the phases directly gave about 20% at debug and about 50% at `ReleaseFast`.
- **Every end-to-end figure was measured against a debug build for most of this
  work,** including the baseline that motivated the redesign. Checking how the
  artifact under test was built should have come before optimising anything
  inside it.

The pattern is the same each time: end-to-end measurement first, and measure the
thing rather than inferring it from two other numbers.

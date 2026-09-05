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
workload. End to end through the WASM host it was worth about 8%, because the
runtime was not where the time was going. Model marshalling was, and still is.

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

## End-to-end measurements

The workload from `performance-baseline.md`: 1000 runners over one 20-action
scene, each action evaluating a three-binding numeric program, after 100 warm-up
runners. Runner creation and result decoding are inside the timed window; module
loading and WASM compilation are outside it. Run through the TypeScript host, so
this includes the ABI boundary and the host's model marshalling.

| | runs/s | us/action |
| --- | ---: | ---: |
| Documented Zig/WASM baseline (2026-09-01, different machine) | 533–553 | 90.4–93.8 |
| Documented TypeScript baseline (2026-09-01, different machine) | 956–996 | 50.2–52.3 |
| `30c2cfa`, this machine | 535–572 | 87.4–93.4 |
| Redesigned runtime | 575–624 | 80.1–87.0 |
| Redesigned runtime, model parsed once | **838–868** | **57.6–59.6** |

The `30c2cfa` row reproduces the documented Zig/WASM baseline closely enough to
treat this machine and that one as comparable.

The fourth row spans two measurement sessions of the same binary, which gave
575–619 and 594–624. The spread between sessions is wider than within one, so
differences under about 10% in this benchmark are not meaningful.

## Where the time goes

The redesign was worth 2.5x to 7x natively and about 8% here. Splitting runner
creation from stepping explains the gap. Same workload, timing the two phases
separately:

| | Creating a runner | Running 20 actions |
| --- | ---: | ---: |
| Redesigned runtime | ~1604 us | ~30 us |
| Model parsed once | ~1240 us | ~7–15 us |

Over 98% of the benchmark is model marshalling. The execution path that the
redesign made several times faster was about 2% of the wall clock.

One caveat on those figures: the run column is the difference between two
measurements of similar magnitude, and one trial of the first row produced a
small negative value. Treat it as "small and hard to measure", not as an exact
number.

`RuntimeModel.init` parsed the model JSON twice — once to validate it, once to
keep it. Fixing that was worth more on this workload than the whole redesign
before it: creation fell from ~1604 us to ~1240 us and the benchmark went from
575–624 to 838–868 runs/s.

The rest is not in Zig. A 20-action model costs about 55 us to parse, validate,
index, and lower natively, so roughly 90% of the ~1240 us that creating a runner
still costs is on the TypeScript side. `encodeZigRuntimeModel` in
`packages/ts/scene-runner/src/runner.ts` serializes the model three times per
runner: `toJson` over the protobuf schema, a `JSON.parse(JSON.stringify(...))`
deep clone inside `runtimeProjection`, and a final serialization to bytes.

## What this means

The redesign did what it set out to do inside the runtime, and the
`performance-baseline.md` finding that prompted it — Zig/WASM running slower than
the TypeScript it replaced — is no longer explained by the execution path.

It does not meet the goal of beating the TypeScript baseline: 838–868 runs/s
against 956–996. That goal cannot be reached by making execution faster, because
execution is not the cost. Reaching it means marshalling and lowering a model
once and creating many runtimes against it, rather than re-encoding and
re-parsing it per runner. That is a change across the ABI and the TypeScript
host, and it is the same shape as the model registry that dynamic scene merging
needs.

The process lesson is worth recording with the numbers. Measuring end to end
first would have found the marshalling cost before any of this work, and would
have reordered the plan around it.

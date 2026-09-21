# Remaining from the Zig runtime redesign

> Status: steps 1-3 and 5-9 landed, step 4 in part; two items deferred with the
> evidence that would justify them. Merging scenes landed on top, in the host
> rather than the runtime.
> Origin: two observations — the Zig code barely used comptime, and the types it
> needs at runtime were already decided by the Go converter. Shaped by three
> constraints: the program is a derived runtime entity and never a wire format,
> the action is the atomic execution unit, and scenes are merged dynamically.

## What landed

`preset.zig` split into `preset/kernel.zig`, `preset/table.zig` and a facade,
with dispatch through a comptime-generated integer and a `StaticStringMap`.
`runtime/src/program/` holds the IR (`ir.zig`), the loader (`load.zig`, the only
`std.json` on the execution path), and the evaluator (`eval.zig`); `compute.zig`
is a facade over them. Every action compute and next-rule compute is lowered once
when `RuntimeModel` is created, into a single arena, cached by scene, action and
rule index. Scenes, actions and routes are indexed by id at creation, route match
patterns lower to typed data, route history owns its ids, STATE schemas are
shared across snapshots, and the authoring engine moved to
`runtime/src/authoring/`.

Full figures, method and environment are in
`packages/zig/docs/performance-redesign.md`.

Merge rules live in `packages/zig/scene-runner/src/merge.zig`. `mergeModels`
reaches them through `turnout_model_merge`, and an action's `extend` hooks reach
them directly, mid-run — one implementation, so one set of rules and messages
whichever way a merge arrives. Collisions are always rejected, never overridden;
STATE schema entries must be declared identically by every input or the merge
fails; routes merge like scenes, with the version window narrowed to satisfy every
input.

**The reject-every-collision policy is what made mid-run merging tractable.** A
merge can only *add*, so the scene a driver is inside and every id in its route
history still exist, unchanged, in the merged model. What moves is the address of
every string, because the merged model is a fresh parsed tree — so the old model
is retained rather than freed for the life of the runtime instance, which
`ModelEntry`'s reference count already supported. The cost is one retained model
per merge, for the life of the run.

## The measurement that gates the rest

Re-measuring the `performance-baseline.md` workload through the WASM host — 1000
runners, one 20-action scene, three bindings per action — found that creating a
runner cost ~1604 µs while running all twenty actions cost ~30 µs. **Over 98% of
that workload was model marshalling, not execution.** Steps 1 to 7 bought about
8% end to end, against 2.5x to 7x measured natively, because they optimised 2% of
the wall clock.

The two fixes that actually moved it were not in the execution path: parsing the
model once in `RuntimeModel.init` instead of twice, and then a model handle
(`prepareModel`) so marshalling and lowering are paid once for many runners. The
WASM artifact that ships is also a release build now (`wasm-dist` builds
`ReleaseSafe` and `ReleaseSmall`), which was worth more than everything else
combined; the baseline that motivated the redesign had been measuring `Debug`.

`packages/ts/scene-runner/bench/runner-creation.mjs` exists so the next proposal
can be checked against a measurement instead of an intuition.

## Remaining

- **Per-action scratch arena.** Evaluation still allocates each value
  individually; there is no arena scoped to an action in `action.zig` or
  `program/eval.zig`. Worth little while execution is a rounding error end to
  end, so this needs a workload where it is not.

- **Scene units with their own arenas.** Only needed if merging becomes
  incremental. Merging is deliberately not incremental: a mid-run merge
  serialises the merged tree and re-loads it, reusing validation, indexing and
  lowering untouched. Preparing a 20-action model costs about 55 µs, so
  re-preparing on merge is only worth avoiding if merges are frequent relative to
  runs, and the expected shape is the opposite — models are composed at
  configuration time and run many times after.

  The threshold for building the incremental path is evidence that merging is
  hot: a measured workload where merge cost is a meaningful fraction of the
  whole. The redesign already spent most of its effort optimising a path that
  turned out to be 2% of wall clock; the same mistake is available here.

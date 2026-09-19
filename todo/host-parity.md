# Closing the host parity gaps

> Status: proposal
> Origin: the recheck at the end of `aligned-runtime-hosts.md` found a whole
> ability — model extension — that no gate was looking at, because no capability
> declared it. Twelve vectors passed on both hosts while one of them could not
> run a documented language feature at all.
> This plan is about making that class of gap impossible first, and closing the
> ones currently open second. In that order, because the first is what names the
> second.

## The principle, and what it does not demand

`spec/runtime-hosts.md` already draws the line: engine-owned abilities must
match across hosts, host-owned surface need not. A native CLI has no reason to
grow `runAsync` or an async generator, and that asymmetry is correct.

So "aligned" means something precise: **for every ability the engine owns, every
host either implements it or declares that it does not.** Silence is the failure
mode. The extend gap was not a host that declared it lacked something — it was a
host, a manifest, and four gates that between them never raised the question.

## Step 1: check coverage against the engine's own surface

`spec/capabilities.json` rows are hand-written, and nothing ties them to what
the engine actually exposes. That is the whole defect: a capability nobody
writes down is a capability nobody checks, and no amount of passing vectors
tells you what is missing from the list.

The engine already enumerates itself twice, in two machine-readable places:

- `export fn` in `packages/zig/wasm/src/abi.zig` — 14 operations, including
  `turnout_model_merge`, which nothing declared;
- the `runner.Event` union in `runner.zig` — including `extend_model`, which
  nothing declared either.

Give each capability an `engineSurface` naming what it covers, and have
`check-capabilities.mjs` assert both directions: every exported operation and
every event kind is claimed by exactly one capability, and every claim names
something that exists. An unclaimed export fails the build.

That check, written before the recheck, would have failed on
`turnout_model_merge` and `event:extend_model` and pointed straight at the gap.

Two nuances worth building in rather than discovering later:

- **Some abilities already have evidence elsewhere.** Values, presets and
  compute are pinned by `value_vectors.zig`, `preset_vectors.zig`,
  `compute_vectors.zig` and their TypeScript counterparts, run natively and
  under WASM. The manifest should point at that evidence, not duplicate it as
  host vectors.
- **Some abilities are legitimately not a host's business.** See step 2.

## Step 2: close or declare what step 1 names

Three are known today. The point of step 1 is that this list stops being one I
assembled by reading code.

**Merge ahead of a run.** `turnout_model_merge` backs TypeScript's
`mergeModels`; the native host has no way to reach it. Add `--merge <model>`,
repeatable, composing before the run starts — the same `merge.zig` the mid-run
path already uses in both hosts. Two vectors: models that compose, and models
that collide, the second asserting the conflict is reported rather than
resolved.

**Cancellation, which neither host can actually do.** The engine has
`Runtime.cancel`, `SceneDriver.cancel`, `RouteDriver.cancel` and a `cancelled`
event. The ABI exports no cancel operation, and the native host never calls one:
`grep` finds only internal delegation and tests. TypeScript's `AbortSignal` path
does something else entirely — it snapshots partial STATE and destroys the
handle.

So `spec/runtime-hosts.md`'s "A host can cancel a run; cancellation is terminal"
is not true of either host today. Two honest options:

- export `turnout_runtime_cancel`, route TypeScript's abort path through it, and
  give the native host `SIGINT` → cancel → print the partial STATE; or
- delete `cancel()` and the `cancelled` event, and correct the spec.

The first is better. A CLI that hands back partial STATE on Ctrl-C is worth
having, and it makes an engine path that currently cannot be reached reachable —
which is the only way it stays honest.

**Prepared models, which are not the CLI's business.** `turnout_model_create`
and `turnout_runtime_create_with_model` back `prepareModel`, which exists to
amortise creation across many runs. A process that runs one model once has
nothing to amortise. This needs a `not-applicable` host status that the checker
accepts without vectors — distinct from `planned`, which promises the work, and
from `unsupported`, which admits a gap.

## Step 3: one error vocabulary, written down

Both hosts now report the same names for a failed hook answer, and they agree
because I renamed things until they did. Nothing checks it. The repository
already has the right mechanism for exactly this — `fn-aliases.json`,
`field-types.json`, `runtime-projection.json`, each with a drift gate.

`spec/error-codes.json`: every code, which side raises it, and what it means. The
check asserts the engine's error set and TypeScript's code unions agree with it,
the same way the projection artifact gates three implementations of one rule.

That artifact is what makes the last piece of phase 1a safe to finish.
TypeScript still keeps its own copies of the two prepare-answer checks, and the
reason they have not been deleted is message quality: the engine returns a bare
code, while the host names the field that was missing. Fix that first — let the
ABI error response carry the detail (`{"error":"MissingHookField","binding":"height"}`)
— and the duplicate checks can go, leaving one implementation and one
vocabulary.

## Step 4: delete the surface no host can reach

`scene.execute` and `scene.executeSafe` have no callers outside their own file.
`route.execute` and `route.executeSafe` are called only by `route_vectors.zig`
and `route_error_vectors.zig`, which exist to test them. `runtime_error.Code` —
a second, snake_case vocabulary alongside the `@errorName` strings the ABI
actually sends — is used only on those paths.

Both hosts drive `SceneDriver` and `RouteDriver` step by step instead, and
TypeScript's `executeSceneSafe` is a wrapper over the driver path rather than a
second implementation. So this is roughly a thousand lines of engine surface
that cannot drift into a host, because no host can reach it — which also means
nothing keeps it honest, and it carries a competing vocabulary while doing so.

Delete it, or route `executeSceneSafe` through it. Deleting is better: the
one-shot shape is a convenience, and both hosts already build theirs from the
driver.

## Sequencing

1. **Coverage check.** It names the rest of the work and would have caught the
   bug that prompted this plan.
2. **Merge CLI, cancellation, `not-applicable` status.** The gaps step 1 names.
3. **`spec/error-codes.json`, then delete TypeScript's duplicate checks.** The
   artifact has to exist before the deletion is safe.
4. **Delete the unreachable one-shot surface.** Independent of the rest; last
   because deletions are easiest to justify once nothing new needs them.

Step 1 before 2 is the load-bearing order, and for the same reason phase 2 came
before phase 3 in the parent plan: build the thing that says what is missing
before building what is missing, or you will find out by writing a vector and
watching it fail — which is how this plan came to exist.

## Risks

- **Exporting cancel is an ABI addition**, so the version window in
  `compatibility-window.md` applies. Additive, not breaking.
- **Error detail on the ABI response changes a payload shape.** Additive, and
  the TypeScript adapter already tolerates unknown fields.
- **The coverage check can be satisfied dishonestly** by claiming a surface in a
  capability that does not really cover it. The defence is the same one the
  manifest already has: a capability with no vectors fails, and a host's claimed
  status must match what its run earned.

## Non-goals

- **Parity of host-shaped API.** `next(steps)`, `runAsync`, hook-registration
  builders, and error classes are each host's own.
- **A second engine anywhere.** Everything here is either an export, a CLI flag,
  an artifact, or a deletion.
- **Declaring capabilities that have no evidence.** A row without vectors, or
  without other pinned evidence the checker accepts, is the failure this plan
  exists to prevent — not a way to make the table look complete.

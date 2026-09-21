# Closing the host parity gaps

> Status: step 1 landed; step 2 partly landed; steps 3 and 4 open
> Origin: a recheck of the two runtime hosts found a whole ability — model
> extension — that no gate was looking at, because no capability declared it.
> Twelve vectors passed on both hosts while one of them could not run a
> documented language feature at all.
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

## Step 1: coverage against the engine's own surface — landed

`spec/capabilities.json` rows now carry an `engineSurface`, and
`scripts/check-capabilities.mjs` asserts both directions: every `export fn` in
`packages/zig/wasm/src/abi.zig` and every `runner.Event` kind is claimed by
exactly one capability, and every claim names something that exists. An
unclaimed export fails the build, which is what would have caught
`turnout_model_merge` and `event:extend_model` before a vector had to.

Two nuances that were built in rather than discovered later:

- **Some abilities already have evidence elsewhere.** Values, presets and
  compute are pinned by `value_vectors.zig`, `preset_vectors.zig`,
  `compute_vectors.zig` and their TypeScript counterparts, run natively and
  under WASM. The manifest points at that evidence rather than duplicating it as
  host vectors.
- **Some abilities are legitimately not a host's business**, which is what the
  `not-applicable` status in step 2 is for.

## Step 2: close or declare what step 1 names

**Prepared models — landed as `not-applicable`.** `turnout_model_create` and
`turnout_runtime_create_with_model` back `prepareModel`, which exists to amortise
creation across many runs; a process that runs one model once has nothing to
amortise. `spec/capabilities.json` carries a `not-applicable` host status the
checker accepts without vectors — distinct from `planned`, which promises the
work, and from `unsupported`, which admits a gap.

**Merge ahead of a run — open.** `turnout_model_merge` backs TypeScript's
`mergeModels`; the native host can only merge mid-run, through an `extend` hook,
and has no CLI for composing before a run starts (`--max-model-merges` caps the
mid-run path, it does not open the pre-run one). Add `--merge <model>`,
repeatable, composing before the run starts — the same `merge.zig` both hosts
already use. Two vectors: models that compose, and models that collide, the
second asserting the conflict is reported rather than resolved.

**Cancellation, which neither host can actually do — open.** The engine has
`Runtime.cancel`, `SceneDriver.cancel`, `RouteDriver.cancel` and a `cancelled`
event. The ABI exports no cancel operation, and the native host never calls one:
`grep` finds only internal delegation, the `cancelled` event arm, and tests.
TypeScript's `AbortSignal` path does something else entirely — it snapshots
partial STATE and destroys the handle.

So `spec/runtime-hosts.md`'s "A host can cancel a run; cancellation is terminal"
is not true of either host today. Two honest options:

- export `turnout_runtime_cancel`, route TypeScript's abort path through it, and
  give the native host `SIGINT` → cancel → print the partial STATE; or
- delete `cancel()` and the `cancelled` event, and correct the spec.

The first is better. A CLI that hands back partial STATE on Ctrl-C is worth
having, and it makes an engine path that currently cannot be reached reachable —
which is the only way it stays honest.

## Step 3: one error vocabulary — the artifact landed, the deletion did not

`spec/error-codes.json` exists and classifies every code in the gated host
unions as `shared` or `renamed`, with a drift gate, the same way
`fn-aliases.json`, `field-types.json` and `runtime-projection.json` gate their
own shared names.

What it was meant to make safe is still undone. TypeScript keeps its own copies
of the two prepare-answer checks — `MissingHookField` and `InvalidHookValue` in
`packages/ts/scene-runner/src/zig-runtime/effect-dispatcher.ts:187,197,204`, beside
the engine's own `error.MissingHookField` in
`packages/zig/scene-runner/src/runner.zig:615` — and the reason they have not
been deleted is message quality: the engine returns a bare code, while the host
names the field that was missing. Fix that first — let the ABI error response
carry the detail (`{"error":"MissingHookField","binding":"height"}`) — and the
duplicate checks can go, leaving one implementation and one vocabulary.

## Step 4: delete the surface no host can reach — open

`scene.execute` and `scene.executeSafe`
(`packages/zig/scene-runner/src/scene.zig:121,136`) have no callers outside their
own file. `route.execute` and `route.executeSafe` (`route.zig:128,153`) are
called only by `route_vectors.zig` and `route_error_vectors.zig`, which exist to
test them. `runtime_error.Code` — a second, snake_case vocabulary alongside the
`@errorName` strings the ABI actually sends — is used only on those paths.

Both hosts drive `SceneDriver` and `RouteDriver` step by step instead, and
TypeScript's `executeSceneSafe` is a wrapper over the driver path rather than a
second implementation. So this is roughly a thousand lines of engine surface
that cannot drift into a host, because no host can reach it — which also means
nothing keeps it honest, and it carries a competing vocabulary while doing so.

Delete it, or route `executeSceneSafe` through it. Deleting is better: the
one-shot shape is a convenience, and both hosts already build theirs from the
driver.

## Sequencing

1. **Merge CLI and cancellation.** The two gaps step 1 named and nothing has
   closed.
2. **ABI error detail, then delete TypeScript's duplicate checks.** The detail
   has to arrive before the deletion is safe.
3. **Delete the unreachable one-shot surface.** Independent of the rest; last
   because deletions are easiest to justify once nothing new needs them.

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

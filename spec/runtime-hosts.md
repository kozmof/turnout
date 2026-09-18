# Runtime Hosts Specification

> Status: Draft for implementation
> Scope: The boundary between the execution engine and the host that drives it,
> and the abilities each side owns. Companion to `convert-runtime-spec.md`,
> which covers the compiler and the model it emits.

---

## Overview

The other documents in this directory describe the pipeline as two phases, a Go
compiler and a TypeScript runtime. That is one phase short. What executes a
model is a Zig engine; TypeScript is a *host* that drives it.

```
.tu  ──[Go compiler]──>  model  ──[host]──>  engine  ──>  STATE mutations
```

The distinction matters because the abilities divide along it, not along the
language boundary the earlier documents imply. Nothing in `packages/ts/runtime`
computes a value: `executeGraph` and every preset function cross into the engine
and back. What TypeScript owns is the host half.

| Layer | Owns |
| --- | --- |
| compiler | parsing, type checking, lowering, the emitted model |
| host | hook invocation, message wording, the public API of one language |
| engine | values, presets, compute, STATE, drivers, model merge, limits |

### Hosts

| Host | Status | Reaches the engine through |
| --- | --- | --- |
| `packages/ts/scene-runner` | shipping | the WASM ABI, in process |
| native Zig host | proposed (`todo/aligned-runtime-hosts.md`) | direct calls |

A host is not a port of the engine. Two hosts execute the same model the same
way because they drive the same engine, not because they agree to.

---

## Transport

The compiler's sanitized JSON is the only transport. Protobuf bytes are not
accepted. See `packages/zig/docs/runtime-contract.md` for the wire mechanics and
the record of why a second wire format was rejected.

Which fields cross is declared once, in `spec/runtime-projection.json`. The
compiler strips the compiler-only fields listed there, and the engine rejects a
model that still carries any of them. Both directions are gated by tests that
execute the implementations rather than inspect them.

### CAN (OK)

- A host can hand the engine exactly what the compiler emitted.
- A host can hand the engine a model assembled from several compiled models,
  provided every collision is reported rather than resolved.
- The engine can accept unknown fields, so a newer compiler does not break an
  older engine.

### CAN'T (NG)

- A host cannot add fields the compiler does not emit.
- A host cannot pass a model carrying compiler-only fields; the engine rejects
  it rather than ignoring them, so the mistake surfaces at the boundary.
- A host cannot negotiate a model version. A model outside the engine's window
  is rejected.

---

## Effects

The engine never calls a hook. It emits a prepare or publish request with a
stable ID and suspends; the host answers with one result and calls step again.

This is the one division that is physics rather than policy: a hook is code
written in the host's language, so only the host can run it. Everything
between suspensions — what context a prepare hook receives, when an extend
merge lands, how results are bound — belongs to the engine.

### CAN (OK)

- A host can run hooks in its own language, synchronously or asynchronously.
- A host can cancel a run; cancellation is terminal.
- A host can answer a request with success, failure, or missing.
- A host can word the error it raises for a failed hook however its language's
  conventions want.

### CAN'T (NG)

- A host cannot answer a request it was not given, answer one twice, or answer
  with the wrong effect kind. The engine rejects all three.
- A host cannot advance execution with `resume`; it records a result, and `step`
  advances.
- A host cannot decide what a hook's result binds to, or in what order hooks
  fire. Both are fixed by the compiled model and scheduled by the engine.
- A host cannot build the context a hook reads, or work out which bindings a
  hook owes. The engine sends both with the request, because it holds the model
  and STATE that answer them; a host computing its own could disagree with the
  engine that executes the action.
- A host cannot mutate STATE directly. STATE is written only through the merge
  points the source declared.

---

## Abilities the engine owns

Recorded here so that a second host is written against a list rather than
against the first host's source. The mechanics of each are in
`packages/zig/docs/runtime-contract.md`.

- Value representation, tags, null reasons, and structural equality
- Preset functions, and the JavaScript-compatible behaviour they are pinned to
- Compute program lowering and evaluation
- Action, scene, and route execution, including step and transition limits
- STATE schema resolution, write validation, and snapshots
- Model merge, whether ahead of a run or mid-run through an `extend` hook
- Every resource limit, and the structured status each violation returns

### CAN'T (NG)

- The engine cannot call into the host except by suspending with an effect
  request.
- The engine cannot resolve a collision during a merge. Every collision is an
  error; two models that both define a scene have no defensible winner.
- The engine cannot report a source position. Type errors are the compiler's to
  report, against the file it parsed.

---

## Abilities a host owns

### CAN (OK)

- A host can present whatever stepping API suits its language, provided each
  step is one engine step.
- A host can own model lifetime, including preparing a model once and running it
  many times.
- A host can translate engine status codes into its own error types.

### CAN'T (NG)

- A host cannot implement an ability from the engine list above. Two
  implementations of one rule is the failure this separation exists to prevent.
- A host cannot re-type-check a model. The compiler did, and the engine trusts
  its output.
- A host cannot reorder warnings, traces, or publish outcomes. Their order is
  part of what the engine returns.
- A host cannot present an ability the engine does not have. An ability missing
  from one host and present in another is a gap to close in the engine.

# Batch the value ABI

> Status: proposal, not implemented
> Origin: code analysis, 2026-09-20. Measured on the built `dist`, Node 26,
> `turnout-runtime.wasm` (ReleaseSafe).

## The problem

Every value the TypeScript builder API constructs crosses into the engine and
back, one value per crossing. `buildNumber(1)` becomes:

```
JSON.stringify → turnout_alloc → memcpy into WASM memory → JSON parse in Zig
→ normalize → allocate response → memcpy out → JSON.parse → turnout_free
```

`value-builders.ts:204-212` is the whole of it:

```ts
function normalize(value: unknown): AnyValue {
  return operate({ operation: "normalize", value });
}
function operate(request: unknown): AnyValue {
  const response = defaultZigRuntimeClient.value(request);
  ...
}
```

This is not an accident and it is not wrong: it is what guarantees TypeScript
and Zig cannot disagree about what a value is, which is the same reason
`executeGraph` and every preset function cross too (`spec/runtime-hosts.md`:
"Nothing in `packages/ts/runtime` computes a value"). The cost is the point of
this note, not the design.

## What it costs

| Operation | Crossings | Measured |
| --- | --- | --- |
| `buildNumber(i)` | 1 | **3.27 µs** |
| plain JS object literal | 0 | 0.008 µs |
| `buildArrayNumber(10 prebuilt)` | 1 | 14.0 µs |
| `buildArrayNumber(100 prebuilt)` | 1 | 90.7 µs |
| ten numbers **then** the array | 11 | **41.4 µs** |

Two framings, both worth keeping in mind:

- A single value construction costs about 400× a plain object literal.
- The README puts a prepared 20-action scene run at **13 µs**. So four
  `buildNumber` calls cost more than running an entire scene. A caller
  assembling a thousand values pays ~3.3 ms before any flow executes.

The eleven-crossing row is the one a batch API addresses: building a
ten-element array from scratch spends 27 µs of its 41 µs on the ten element
crossings, each of which allocates, copies, parses and frees a JSON document
holding one number.

## The shape

A `turnout_value_operate_batch` export taking an array of the requests
`turnout_value_operate` already accepts, returning an array of responses in the
same order, with one status for the batch and a per-entry status inside it.
The encode/decode machinery on both sides is already array-shaped — the value
codec maps over collections and `makeResponse` (`abi.zig:290`) writes one
header over an arbitrary payload — so the work is dispatch and error
attribution, not new serialization.

On the TypeScript side the natural consumers are the composite builders:
`buildArrayNumber`, `buildArrayString`, `buildArrayBoolean`, `buildArrayNull`,
`buildRecord`, and `buildArrayWithSymbol` (`value-builders.ts:183`), each of
which today normalizes its elements one at a time before normalizing the
container.

## Why this is a feature, not a fix

It adds an export to the ABI, which is a surface with its own rules:

- `scripts/engine-surface.mjs` enumerates the exports, and
  `check-capabilities.mjs` fails on an export no capability claims — the script
  records that `turnout_model_merge` shipped unclaimed and twelve vectors
  passed on both hosts while one could not run a documented feature.
- So a new export needs a row in `spec/capabilities.json` and at least one
  vector in `spec/conformance/host/`, run by both the TypeScript host and
  `turnout-run`.
- `spec/limits.json` needs a bound on batch size, in both languages, for the
  same reason `stateTypeNodes` is there: a limit the host and the engine each
  chose alone is how a request the host sent became one the engine refused.
- The ABI version (`runtime-versions.json`) is a compatibility window, and
  adding an export is the kind of change that has to decide whether it widens.

None of that is an objection. It is the reason this is a scheduled piece of
work rather than a cleanup, and the reason it should be sized with the
capability and the vectors included.

## Open questions

- **Partial failure.** If entry 7 of 10 is invalid, does the batch fail whole
  or return nine values and one error? Whole-batch is simpler to reason about
  and matches how the compiler treats a file. Per-entry is what a builder
  wants, since it knows which of its elements was bad. The answer determines
  the response shape, so it comes first.
- **Is `normalize` the only operation worth batching?** `preset` is the other
  hot one (`combineNumberOp` and friends all route through `callZigPreset`),
  and a batch that accepts mixed operations is barely harder than one that does
  not. A batch of one operation kind is easier to bound and to explain.
- **Does the builder API keep its current signatures?** It must —
  `buildArrayNumber(values)` is already the batch boundary. This is an internal
  change to how it is served, which is what makes it safe to do later.

## Verification

- The measured table above, re-run after the change. The eleven-crossing row is
  the one that must move; the single-crossing rows should not regress.
- A batch and the equivalent sequence of individual calls must produce
  identical values, tags included, for every operation the batch accepts.
- `abi.test` already asserts "native WASM ABI lifecycle has no outstanding
  allocations". A batch that leaks one entry's response on a partial failure is
  exactly the bug that test exists to catch, so it must cover the failure path,
  not just the happy one.
- Both hosts run the new vectors — `pnpm run test:native-conformance` covers
  `turnout-run`, and the TypeScript host runs the same files from its suite.

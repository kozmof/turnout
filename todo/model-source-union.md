# Collapse the `Uint8Array | RuntimeModelSource` parameter

> Status: proposal, declined for now
> Origin: code analysis, 2026-09-20. Raised as a cleanup, then costed and left
> alone. Recorded so the next person to notice it does not re-derive the cost.

## What it is

`createZigSceneRunner` and `createZigRouteRunner`
(`packages/ts/scene-runner/src/zig-runtime/runner-adapter.ts:588,694`) take
their model as a union:

```ts
model: Uint8Array | RuntimeModelSource
```

and `toModelSource` (`:350`) resolves it with a type test:

```ts
function toModelSource(
  client: ZigRuntimeLifecycleTransport,
  model: Uint8Array | RuntimeModelSource,
): RuntimeModelSource {
  return model instanceof Uint8Array ? modelSourceFromBytes(client, model) : model;
}
```

`RuntimeModelSource` (`:331`) is the real abstraction — "where a runner gets its
Zig runtime from" — with two constructors already exported,
`modelSourceFromBytes` and `modelSourceFromHandle`. The union is a convenience
for the common case: an unprepared model is bytes, and a prepared one is a
handle.

## The proposal

Require `RuntimeModelSource`, delete `toModelSource`, and have callers wrap:

```ts
createZigSceneRunner(client, modelSourceFromBytes(client, encodeZigRuntimeModel(model)), id, opts)
```

One fewer type test, one fewer union, and the two paths become symmetrical
instead of one being spelled two ways.

## Why it was declined

The parameter has **4 call sites in `src/`** and **17 in
`runner-adapter.test.ts`**, every one of the latter passing a `Uint8Array`
directly:

```ts
const runner = createZigSceneRunner(client, new Uint8Array([1, 2]), "main", {...});
```

So the change is four real edits and seventeen mechanical ones, in the test
file that covers the handle-lifecycle paths — `closeHandle`, the abort path,
the destroy-failure warning — which is precisely the code whose tests you least
want to churn for a cosmetic reason. `runner-adapter.ts` is also the file whose
own doc comment says those are "the paths where two copies drifting apart would
leak a handle without any test noticing".

Against that: `instanceof Uint8Array` is one line, it is correct, and the
convenience it buys is used by every caller in the codebase. Removing a
well-behaved overload at the cost of seventeen test edits is churn, not a fix.

## When to revisit

Fold it into a change that is already touching these signatures — a third model
source (streamed bytes, a shared-memory handle, a remote engine) would make the
union three-wide, and that is the point at which the type test stops being one
line and the abstraction has to be the only way in.

If it is done on its own, do it as a pure rename-and-wrap with no other change
in the commit, so the diff is reviewable as mechanical.

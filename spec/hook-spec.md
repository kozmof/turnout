# Hook Specification — Turn DSL

> Status: Draft for implementation
> Scope: Turn DSL `<~ hook(...)` ingress, `extend.model` and `publish.hook` declarations, their lowering to canonical HCL, the runtime execution model, and the TypeScript registration API

---

## Overview

A hook is a named extension point. It lets consumers inject TypeScript logic at fixed points in the action execution lifecycle.

- Prepare hooks (`<binding>:<type> <~ hook("<name>")`) — fire before the compute graph runs. The hook returns an object whose fields are mapped into runtime state bindings.
- Extend hooks (`extend { model = "<name>" }`) — fire before anything else in the action. The hook returns a model, which is merged into the running model before any binding is resolved.
- Publish hooks (`publish { hook = "<name>" }`) — fire after merge. The hook receives the entire final state snapshot and cannot mutate it.

Hooks are declared at convert time (Turn DSL → canonical HCL) and implemented at runtime by the consumer through the runner hook registry. Missing implementations are handled by phase. An unregistered prepare or extend hook fails the action with `UnregisteredHook`, while an unregistered publish hook is silently skipped.

```hcl
action "process_order" {
  compute "order_graph" {
    raw_payload:str <~ hook("payload_input")
    user_id:str <~ @session.user_id
    receipt:str := (build_receipt(raw_payload, user_id)) ~> @orders.last_receipt
  }

  publish {
    hook = "audit_export"
  }
}
```

```typescript
const runner = createRunner(model, { entryId: "checkout", initialState: {} })
  .usePrepareHook("payload_input", async (ctx, signal) => {
    return { raw_payload: await fetchPayload({ signal }) }
  })
  .usePublishHook("audit_export", (ctx) => {
    audit.log(ctx.state())
  })
```

---

## 1. DSL Syntax

### 1.1 Prepare hooks

A prepare hook is declared with a `hook(...)` ingress clause on the binding that receives its value:

```
action "<actionId>" {
  compute "<label>" {
    <bindingName>:<type> <~ @<namespace>.<field>   # STATE input
    <bindingName>:<type> <~ hook("<hookName>")     # hook input
    ...
  }
}
```

A binding has exactly one source, either STATE or a hook, never both.

Hook invocation and result mapping:

1. The runtime invokes the hook, obtaining a result object.
2. For each binding that declared `<~ hook("<hookName>")`, the runtime assigns:

```
state[bindingName] = hookResult[bindingName]
```

The hook implementation is responsible for returning a field with the correct binding name.

### 1.2 Hook deduplication (multiple bindings, same hook name)

If multiple bindings in the same action reference the same hook name, the runtime invokes the hook once and reuses the returned object for all matching bindings:

```hcl
raw_payload:str <~ hook("request_context")
user_agent:str  <~ hook("request_context")
```

Mapping:

```
state.raw_payload = result.raw_payload
state.user_agent  = result.user_agent
```

### 1.3 Publish hooks

Publish hooks are declared in the `publish` section using `hook = "<name>"`:

```hcl
publish {
  hook = "audit_export"
  hook = "metrics_emit"
}
```

Multiple `hook` entries are allowed. Publish hooks fire in declaration order after the merge step. Each receives the entire final action state.

### 1.4 Extend hooks

An extend hook is declared in the `extend` section using `model = "<name>"`:

```hcl
extend {
  model = "fetch_checkout_scenes"
  model = "fetch_returns_scenes"
}
```

Each value names a hook; the attribute is `model` because a model is what the hook yields. `model` is contextual, not a reserved word, so a binding may still be called `model` elsewhere.

Multiple entries are allowed. Extend hooks fire in declaration order and each returned model is merged into the running model, left to right, before any binding in the action is resolved. A hook may return one model or several; several is the same as listing several hooks.

Merging rejects every collision rather than overriding, and reports all of them together. A field declared identically by two inputs is agreement, not a conflict. The running model is named `model` in those messages; every other input is named by the hook it came from.

Because a model can grow, a route arm may name a scene that is not in the model yet. That is not a validation error. Reaching a target that never arrives still is.

### 1.5 Execution order within an action

```
0. Invoke extend hooks (declaration order); merge each returned model
1. Resolve prepare.from_state bindings from STATE
2. Invoke prepare hooks (declaration order); collect returned objects
3. Map hook result fields into state bindings
4. Execute compute graph
5. Apply merge.to_state
6. Invoke publish hooks (declaration order) with final state
```

Extend comes first so that a STATE field the merge introduces is readable by a `from_state` binding in the same action.

### 1.6 Complete example

```hcl
action "process_order" {
  extend {
    model = "fetch_payment_scenes"
  }

  compute "order_graph" {
    raw_payload:str <~ hook("payload_input")
    user_id:str <~ @session.user_id
    receipt:str := (build_receipt(raw_payload, user_id)) ~> @orders.last_receipt
  }

  publish {
    hook = "audit_export"
    hook = "metrics_emit"
  }
}
```

---

## 2. HCL Lowering

Hook ingress, `extend`, and `publish` sections are lowered to sub-blocks or list attributes inside the action block in the emitted canonical HCL. The `compute` block uses plain canonical `binding` declarations. Inline IO has already been hoisted into `prepare` and `merge`, which exist only in the emitted model and are never author-written.

### 2.1 Shape

```hcl
action "process_order" {
  extend = ["fetch_payment_scenes"]

  compute {
    root = "receipt"
    prog "order_graph" {
      binding "raw_payload" { type = "str" value = "" }
      binding "user_id"     { type = "str" value = "" }
      binding "receipt"     {
        type = "str"
        expr = { combine = { fn = "build_receipt" args = [{ ref = "raw_payload" }, { ref = "user_id" }] } }
      }
    }
  }

  prepare {
    binding "user_id"     { from_state = "session.user_id" }
    binding "raw_payload" { from_hook  = "payload_input" }
  }

  merge {
    binding "receipt" { to_state = "orders.last_receipt" }
  }

  publish {
    hook = "audit_export"
    hook = "metrics_emit"
  }
}
```

Rules:
- Inline clauses are stripped from the `compute` block. Direction is encoded structurally by membership in `prepare` or `merge`.
- Each `<~` clause becomes `binding "<name>" { from_state = ... }` or `binding "<name>" { from_hook = ... }` under `prepare`.
- Each `~>` clause becomes `binding "<name>" { to_state = ... }` under `merge`.
- Each `publish` hook entry becomes a `hook = "<name>"` attribute (repeated for multiple hooks).
- The `extend` block becomes an `extend = ["<name>", ...]` list attribute, in declaration order, which is the order the models merge in.
- Binding names inside `prepare` and `merge` name the binding the clause was written on, so they always match a `compute` binding.

---

## 3. Runtime Execution Model

### 3.1 Hook registration API (TypeScript)

```typescript
interface PrepareHookContext {
  readonly actionId: string;
  readonly hookName: string;
  /** Read the current value of a state binding (e.g. from a prior from_state resolution).
   *  Returns `undefined` if the binding name does not correspond to a resolved state binding. */
  get(binding: string): unknown;
}

interface ExtendHookContext {
  readonly actionId: string;
  readonly hookName: string;
  // No get(): extend hooks run before any binding is resolved.
}

interface PublishHookContext {
  readonly actionId: string;
  readonly hookName: string;
  /** Read the entire final state snapshot. */
  state(): Record<string, unknown>;
}

type PrepareHookImpl = (ctx: PrepareHookContext, signal: AbortSignal) => Record<string, unknown> | Promise<Record<string, unknown>>;
type ExtendHookImpl = (ctx: ExtendHookContext, signal: AbortSignal) => TurnModel | readonly TurnModel[] | Promise<TurnModel | readonly TurnModel[]>;
type PublishHookImpl = (ctx: PublishHookContext, signal: AbortSignal) => PublishHookOutcome | void | Promise<PublishHookOutcome | void>;

// Registration on Runner
runner.usePrepareHook(hookName: string, impl: PrepareHookImpl): Runner;
runner.useExtendHook(hookName: string, impl: ExtendHookImpl): Runner;
runner.usePublishHook(hookName: string, impl: PublishHookImpl): Runner;
```

Consumers register hook implementations before execution begins, using the runner's prepare/extend/publish hook registration API.

```typescript
runner.usePrepareHook("payload_input", async (ctx, signal) => {
  return { raw_payload: await fetchPayload({ signal }) }
})

runner.useExtendHook("fetch_payment_scenes", async (ctx, signal) => {
  return await loadModel("payment", { signal })
})

runner.usePublishHook("audit_export", (ctx) => {
  audit.log(ctx.state())
})
```

### 3.2 Prepare hook mapping

After a prepare hook returns its result object, the runtime maps each declared binding:

```
state[bindingName] = hookResult[bindingName]
```

If the result object is missing a declared binding field, the runtime emits `MissingHookField`.

### 3.3 Extend hook merging

The models an action's extend hooks return are merged onto the running model in declaration order, before any binding is resolved. It is the same merge `mergeModels` performs, so the rules and the messages are identical whichever way it is reached.

A collision is never an override. Every conflict is collected and the action fails with all of them:

```
scene "review" is declared by model and fetch_checkout_scenes
STATE field "app.total" is declared as str="" by fetch_checkout_scenes and as number=0 by model
```

A scene, route or STATE field the merge adds is usable from that point on, including by a route arm that named it before it existed. What a merge cannot do is change anything the model already has, which is what keeps a run that is already inside a scene coherent.

### 3.4 Publish hook state

Publish hooks receive the complete final state after the merge step:

```
{
  raw_payload: "...",
  user_id: "u123",
  receipt: "..."
}
```

Publish hooks cannot mutate this state. Any return value is ignored.

### 3.5 Unregistered hooks

If no prepare hook implementation has been registered for a hook name when the action executes, prepare resolution fails with `UnregisteredHook` and the action does not run. An unregistered extend hook fails the same way, for the same reason: an action that asked for a model and did not get one cannot run. If no publish hook implementation has been registered for a `publish.hook` name, the runtime silently skips that publish hook.

### 3.6 Multiple prepare hooks, same name

When multiple bindings reference the same prepare hook name, the hook executes once and the returned object is reused for all matching bindings.

### 3.7 Hook isolation

- Prepare hooks: can read runtime context and optionally read current state via `ctx.get()`. They cannot write state directly. Writes occur only through the returned object mapped by the runtime.
- Extend hooks: can read nothing from the run. What they return changes the model, not the state.
- Publish hooks: can read the full final state via `ctx.state()`. They cannot write state.

---

## 4. CAN (OK)

- `<binding>:<type> <~ hook("<name>")` declares a prepare-phase hook for that binding.
- `publish { hook = "<name>" }` declares a publish-phase hook for the action.
- An action binding may read from STATE or from a hook. Both are valid sources.
- The same hook name may appear on multiple bindings. All matching bindings are collected from the single hook invocation result.
- Multiple `hook` entries in a `publish` block are valid and execute in declaration order.
- Two distinct hook names may be declared in the same action.
- If no publish hook implementation is registered for a publish hook name, the runtime silently skips that publish hook.
- Prepare hooks fire before the compute graph. The compute graph observes the mapped values.
- Publish hooks fire after merge. They receive the complete final state.
- `extend { model = "<name>" }` declares an extend-phase hook for the action. Multiple entries are valid and merge in declaration order.
- An extend hook may return one model or several.
- An extend hook may add scenes, routes, types and STATE fields, and a route arm may name a scene before it arrives.
- A STATE field or named type an extend hook redeclares identically is agreement, not a conflict.
- `model` remains usable as an ordinary binding name; it is contextual to the `extend` block.

---

## 5. CAN'T (NG)

- A binding cannot carry two ingress clauses: a second `<~` does not parse.
- `hook()` cannot appear in a transition `compute` block (`TransitionHook`).
- A prepare hook implementation cannot write to state directly. It can only return values via the result object.
- A publish hook cannot mutate state. Return values are ignored.
- Hook execution order cannot be changed at runtime. It is fixed by declaration order in the emitted HCL.
- A prepare hook cannot observe compute graph results (the graph has not run yet). Only STATE-resolved and default binding values are available via `ctx.get()`.
- An extend hook cannot redefine anything the running model already has: a colliding scene, route or type id, or a STATE field declared differently, fails the action.
- An extend hook cannot remove anything from the model. A merge only adds.
- An extend hook cannot read state or bindings. It runs before either exists for the action.

---

## 6. Error Catalogue

| Error code | Condition |
|------------|-----------|
| `UnregisteredHook` | A `<~ hook(...)` ingress references a hook name with no registered prepare hook implementation |
| `MissingHookField` | Prepare hook result object is missing a field required by a declared binding |
| `UnregisteredHook` | An `extend { model = "<name>" }` entry names a hook with no registered extend hook implementation |
| `InvalidHookValue` | An extend hook returned something that is not a model |
| `ModelMergeError` | A model an extend hook returned collides with the running model; carries every conflict |

For `TransitionHook` and the other IO codes, see `effect-dsl-spec.md §7`.

---

## 7. Test Plan

### Domain categories

| Domain | Coverage target |
|--------|----------------|
| A. DSL parsing | `<~ hook(...)` ingress correctly parsed; `publish` `hook` and `extend` `model` entries collected |
| B. HCL lowering | `prepare`/`merge`/`publish` sub-blocks and the `extend` list emitted in declaration order |
| C. Binding validation | Hoisted `prepare` and `merge` entries name the binding their clause was written on |
| D. Prepare hook execution | Hook fires before graph; returned field value visible to compute graph |
| E. Hook deduplication | Multiple bindings on same hook name → hook called once; all fields mapped |
| F. Publish hook execution | Hook fires after merge; receives full final state; cannot mutate |
| G. Declaration order | Multiple publish hooks execute in declaration order |
| H. Unregistered hooks | Prepare and extend hooks fail with `UnregisteredHook`; publish hook is silently skipped |
| I. Extend hook execution | Returned model merges before any binding resolves; a scene it brings in is reachable |
| J. Extend merge conflicts | A colliding scene, route, type or STATE field fails the action, reporting every conflict |
| K. Error paths | All error codes trigger correctly and abort without partial output |

### Critical paths (idempotency)

| # | Path | Idempotency check |
|---|------|------------------|
| 1 | `<~ hook(...)` → emitted HCL `prepare` sub-block with `from_hook` | Re-lower same DSL source; emitted HCL is byte-identical |
| 2 | Prepare hook return value → compute graph observes mapped binding | Same hook impl + same STATE state → identical graph result both runs |
| 3 | Publish hook receives state after merge | Same action state → identical state delivered to publish hook both runs |
| 4 | Unregistered publish hook → no state change | Execute with publish hook unregistered; assert final STATE is unchanged by the missing hook |

### Edge cases

| Case | Expected behaviour |
|------|--------------------|
| Same hook name on multiple bindings | Hook called once; result fields mapped to all declaring bindings |
| Hook result missing a declared binding field | `MissingHookField` error; action execution aborted |
| `x:str <~ hook("h")` inside a transition `compute` block | `TransitionHook` error at convert time |
| `publish { hook = "h1"; hook = "h2" }` | Both hooks fire; h1 before h2 |
| Publish hook impl returns a value | Return value ignored; no state mutation |
| Prepare hook impl is async and rejects | Runtime error propagated; action execution aborted; STATE not mutated |
| Publish hook impl is async and rejects | Publish outcome records an error; merge remains committed |
| Prepare hook unregistered; publish hook registered | `UnregisteredHook`; action execution aborted before compute/merge/publish |
| Publish hook unregistered | Publish hook skipped silently after merge |

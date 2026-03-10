# Hook Specification — Turn DSL

> **Status**: Draft for implementation
> **Scope**: Turn DSL `prepare.from_hook` and `publish.hook` declarations, their lowering to canonical HCL, the runtime execution model, and the TypeScript registration API

---

## Overview

A hook is a named extension point declared inside an action's `prepare` or `publish` section. It lets consumers inject TypeScript logic at fixed points in the action execution lifecycle.

- **Prepare hooks** (`prepare { <binding> { from_hook = "<name>" } }`) — fire before the compute graph runs; the hook returns an object whose fields are mapped into runtime state bindings.
- **Publish hooks** (`publish { hook = "<name>" }`) — fire after merge; the hook receives the entire final state snapshot and cannot mutate it.

Hooks are **declared at convert time** (Turn DSL → canonical HCL) and **implemented at runtime** by the consumer via `runtime.hook()`. If no implementation is registered for a hook name, the runtime silently skips it.

```hcl
action "process_order" {
  compute {
    root = receipt
    prog "order_graph" {
      ~>raw_payload:string = ""
      ~>user_id:string     = ""
      <~receipt:string     = build_receipt(raw_payload, user_id)
    }
  }

  prepare {
    user_id     { from_ssot = session.user_id }
    raw_payload { from_hook = "payload_input" }
  }

  merge {
    receipt { to_ssot = orders.last_receipt }
  }

  publish {
    hook = "audit_export"
  }
}
```

```typescript
runtime.hook("payload_input", (ctx) => {
  return { raw_payload: ctx.requestBody() }
})

runtime.hook("audit_export", (ctx) => {
  audit.log(ctx.state())
})
```

---

## 1. DSL Syntax

### 1.1 Prepare hooks

A prepare hook is declared by setting `from_hook` on a binding entry inside the `prepare` section:

```
action "<actionId>" {
  compute { ... }

  prepare {
    <bindingName> { from_ssot = <path> }         # SSOT input
    <bindingName> { from_hook = "<hookName>" }   # hook input
  }
}
```

Each `prepare` entry must define exactly one source (`from_ssot` or `from_hook`). They cannot be combined on the same binding.

**Hook invocation and result mapping:**

1. The runtime invokes the hook, obtaining a result object.
2. For each binding that declared `from_hook = "<hookName>"`, the runtime assigns:

```
state[bindingName] = hookResult[bindingName]
```

The hook implementation is responsible for returning a field with the correct binding name.

### 1.2 Hook deduplication (multiple bindings, same hook name)

If multiple bindings in the same `prepare` section reference the same hook name, the runtime **invokes the hook once** and reuses the returned object for all matching bindings:

```hcl
prepare {
  raw_payload { from_hook = "request_context" }
  user_agent  { from_hook = "request_context" }
}
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

Multiple `hook` entries are allowed. Publish hooks fire in declaration order after the merge step. Each receives the **entire final action state**.

### 1.4 Execution order within an action

```
1. Resolve prepare.from_ssot bindings from SSOT
2. Invoke prepare hooks (declaration order); collect returned objects
3. Map hook result fields into state bindings
4. Execute compute graph
5. Apply merge.to_ssot
6. Invoke publish hooks (declaration order) with final state
```

### 1.5 Complete example

```hcl
action "process_order" {
  compute {
    root = receipt
    prog "order_graph" {
      ~>raw_payload:string = ""
      ~>user_id:string     = ""
      <~receipt:string     = build_receipt(raw_payload, user_id)
    }
  }

  prepare {
    user_id     { from_ssot = session.user_id }
    raw_payload { from_hook = "payload_input" }
  }

  merge {
    receipt { to_ssot = orders.last_receipt }
  }

  publish {
    hook = "audit_export"
    hook = "metrics_emit"
  }
}
```

---

## 2. HCL Lowering

`prepare.from_hook` entries and `publish` sections are lowered to sub-blocks inside the action block in the emitted canonical HCL. The `compute` block continues to use plain `binding` declarations (sigils stripped).

### 2.1 Shape

```hcl
action "process_order" {
  compute {
    root = "receipt"
    prog "order_graph" {
      binding "raw_payload" { type = "string" value = "" }
      binding "user_id"     { type = "string" value = "" }
      binding "receipt"     {
        type = "string"
        expr = { combine = { fn = "build_receipt" args = [{ ref = "raw_payload" }, { ref = "user_id" }] } }
      }
    }
  }

  prepare {
    binding "user_id"     { from_ssot = "session.user_id" }
    binding "raw_payload" { from_hook  = "payload_input" }
  }

  merge {
    binding "receipt" { to_ssot = "orders.last_receipt" }
  }

  publish {
    hook = "audit_export"
    hook = "metrics_emit"
  }
}
```

Rules:
- Sigils are stripped from binding names in the `prog` block; direction is encoded structurally by membership in `prepare` or `merge`.
- Each `prepare` entry becomes `binding "<name>" { from_ssot = ... }` or `binding "<name>" { from_hook = ... }`.
- Each `merge` entry becomes `binding "<name>" { to_ssot = ... }`.
- Each `publish` hook entry becomes a `hook = "<name>"` attribute (repeated for multiple hooks).
- Binding names inside `prepare` and `merge` must match an existing binding declared in the `prog` block.

---

## 3. Runtime Execution Model

### 3.1 Hook registration API (TypeScript)

```typescript
interface PrepareHookContext {
  readonly actionId: string;
  readonly hookName: string;
  /** Read the current value of a state binding (e.g. from a prior from_ssot resolution). */
  get(binding: string): unknown;
}

interface PublishHookContext {
  readonly actionId: string;
  readonly hookName: string;
  /** Read the entire final state snapshot. */
  state(): Record<string, unknown>;
}

type PrepareHookImpl = (ctx: PrepareHookContext) => Record<string, unknown> | Promise<Record<string, unknown>>;
type PublishHookImpl = (ctx: PublishHookContext) => void | Promise<void>;

// Registration
runtime.hook(hookName: string, impl: PrepareHookImpl | PublishHookImpl): void;
```

Consumers call `runtime.hook()` once per hook name before execution begins.

```typescript
runtime.hook("payload_input", async (ctx) => {
  return { raw_payload: await fetchPayload() }
})

runtime.hook("audit_export", (ctx) => {
  audit.log(ctx.state())
})
```

### 3.2 Prepare hook mapping

After a prepare hook returns its result object, the runtime maps each declared binding:

```
state[bindingName] = hookResult[bindingName]
```

If the result object is missing a declared binding field, the runtime emits `MissingHookField`.

### 3.3 Publish hook state

Publish hooks receive the complete final state after the merge step:

```
{
  raw_payload: "...",
  user_id: "u123",
  receipt: "..."
}
```

Publish hooks cannot mutate this state. Any return value is ignored.

### 3.4 Unregistered hooks

If no implementation has been registered for a hook name when the action executes, the runtime **silently skips** that hook. No error or warning is emitted.

- For a skipped prepare hook, the binding value remains unchanged (whatever was resolved from SSOT or the default).
- For a skipped publish hook, nothing is emitted.

### 3.5 Multiple prepare hooks, same name

When multiple bindings reference the same prepare hook name, the hook executes **once** and the returned object is reused for all matching bindings.

### 3.6 Hook isolation

- Prepare hooks: can read runtime context and optionally read current state via `ctx.get()`. They cannot write state directly; writes occur only through the returned object mapped by the runtime.
- Publish hooks: can read the full final state via `ctx.state()`. They cannot write state.

---

## 4. CAN (OK)

- `prepare { <binding> { from_hook = "<name>" } }` declares a prepare-phase hook for that binding.
- `publish { hook = "<name>" }` declares a publish-phase hook for the action.
- An `prepare` entry may carry `from_ssot` or `from_hook`; both are valid sources.
- The same hook name may appear on multiple `prepare` entries; all matching bindings are collected from the single hook invocation result.
- Multiple `hook` entries in a `publish` block are valid and execute in declaration order.
- Two distinct hook names may be declared in the same action.
- If no implementation is registered for a hook name, the runtime silently skips it.
- Prepare hooks fire before the compute graph; the compute graph observes the mapped values.
- Publish hooks fire after merge; they receive the complete final state.

---

## 5. CAN'T (NG)

- A `prepare` entry cannot carry both `from_ssot` and `from_hook` on the same binding (`InvalidPrepareSource`).
- A `from_hook` binding name cannot be absent from the action's `prog` block (`MissingHookField` at runtime; `UnresolvedPrepareBinding` at convert time).
- A prepare hook implementation cannot write to state directly; it can only return values via the result object.
- A publish hook cannot mutate state; return values are ignored.
- Hook execution order cannot be changed at runtime; it is fixed by declaration order in the emitted HCL.
- A prepare hook cannot observe compute graph results (the graph has not run yet); only SSOT-resolved and default binding values are available via `ctx.get()`.

---

## 6. Error Catalogue

| Error code | Condition |
|------------|-----------|
| `MissingHookField` | Prepare hook result object is missing a field required by a declared binding |
| `InvalidPrepareSource` | A `prepare` entry carries both `from_ssot` and `from_hook` |
| `UnresolvedPrepareBinding` | A `prepare` `from_hook` binding name has no matching binding in the `prog` block |
| `UnresolvedMergeBinding` | A `merge` binding name has no matching binding in the `prog` block |

---

## 7. Test Plan

### Domain categories

| Domain | Coverage target |
|--------|----------------|
| A. DSL parsing | `prepare` entries with `from_hook` correctly parsed; `publish` `hook` entries collected |
| B. HCL lowering | `prepare`/`merge`/`publish` sub-blocks emitted in declaration order |
| C. Binding validation | `from_hook` and `merge` binding names validated against `prog` bindings at convert time |
| D. Prepare hook execution | Hook fires before graph; returned field value visible to compute graph |
| E. Hook deduplication | Multiple bindings on same hook name → hook called once; all fields mapped |
| F. Publish hook execution | Hook fires after merge; receives full final state; cannot mutate |
| G. Declaration order | Multiple publish hooks execute in declaration order |
| H. Unregistered hook | Silently skipped; no error, binding values unchanged |
| I. Error paths | All error codes trigger correctly and abort without partial output |

### Critical paths (idempotency)

| # | Path | Idempotency check |
|---|------|------------------|
| 1 | `prepare.from_hook` → emitted HCL `prepare` sub-block | Re-lower same DSL source; emitted HCL is byte-identical |
| 2 | Prepare hook return value → compute graph observes mapped binding | Same hook impl + same SSOT state → identical graph result both runs |
| 3 | Publish hook receives state after merge | Same action state → identical state delivered to publish hook both runs |
| 4 | Unregistered hook → no state change | Execute with hook unregistered; assert binding values identical to no-hook run |

### Edge cases

| Case | Expected behaviour |
|------|--------------------|
| Same hook name on multiple `prepare` entries | Hook called once; result fields mapped to all declaring bindings |
| Hook result missing a declared binding field | `MissingHookField` error; action execution aborted |
| `prepare { x { from_ssot = p, from_hook = "h" } }` | `InvalidPrepareSource` error at convert time |
| `prepare { x { from_hook = "h" } }` where `x` not in `prog` | `UnresolvedPrepareBinding` error at convert time |
| `publish { hook = "h1"; hook = "h2" }` | Both hooks fire; h1 before h2 |
| Publish hook impl returns a value | Return value ignored; no state mutation |
| Hook impl is async and rejects | Runtime error propagated; action execution aborted; SSOT not mutated |
| Prepare hook unregistered; publish hook registered | Prepare skipped silently; publish fires normally |

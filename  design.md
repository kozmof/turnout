# Hook Integration Specification (Prepare / Merge / Publish)

**Status:** Draft
**Scope:** Defines how actions integrate with SSOT and external hooks.

This specification replaces the previous `io.in` / `io.out` model with explicit lifecycle phases.

---

# 1. Overview

An action execution consists of four ordered phases:

```
prepare → compute → merge → publish
```

| phase   | purpose                              |
| ------- | ------------------------------------ |
| prepare | populate bindings before computation |
| compute | execute the program graph            |
| merge   | write selected bindings to SSOT      |
| publish | emit final state snapshot to hooks   |

The model intentionally avoids symmetric `in/out` semantics.

* `prepare` operates on **bindings**
* `merge` operates on **bindings**
* `publish` operates on the **whole state**

---

# 2. Runtime State

During execution the runtime maintains a state map:

```
State S = { binding_name → value }
```

Binding names are defined by the `prog` section.

Example state:

```
{
  raw_payload: "...",
  user_id: "u123",
  receipt: "..."
}
```

---

# 3. Binding Names and Sigils

Bindings inside `prog` may carry sigils:

| sigil | meaning                        |
| ----- | ------------------------------ |
| `~>`  | value prepared before compute  |
| `<~`  | value merged after compute     |
| `<~>` | value both prepared and merged |

Example:

```hcl
prog "score_graph" {
  ~>income:int = 0
  <~decision:bool = bool_and(income_ok, debt_ok)
}
```

Sigils are **direction metadata only**.

The canonical binding names are:

```
income
decision
```

not:

```
~>income
<~decision
```

All references in `prepare` and `merge` use the **plain canonical binding name**.

---

# 4. Action Structure

An action may contain the following sections:

```hcl
action "<name>" {

  compute { ... }

  prepare { ... }

  merge { ... }

  publish { ... }

}
```

Only `compute` is required.

---

# 5. Compute Section

Defines the computational graph and binding schema.

Example:

```hcl
compute {
  root = receipt

  prog "order_graph" {

    ~>raw_payload:string = ""
    ~>user_id:string     = ""

    <~receipt:string =
      build_receipt(raw_payload, user_id)

  }
}
```

Bindings declared here form the **runtime state schema**.

---

# 6. Prepare Section

`prepare` populates bindings before computation.

Example:

```hcl
prepare {

  user_id {
    from_ssot = session.user_id
  }

  raw_payload {
    from_hook = "payload_input"
  }

}
```

Each entry must define exactly one source.

### 6.1 `from_ssot`

Reads a value from SSOT.

```
binding { from_ssot = <path> }
```

Example:

```hcl
user_id { from_ssot = session.user_id }
```

### 6.2 `from_hook`

Reads a value from a hook event result.

```
binding { from_hook = "<hook_event_name>" }
```

Runtime behavior:

1. invoke the hook event
2. obtain an object result
3. assign

```
state[binding_name] = hook_result[binding_name]
```

Example:

```hcl
raw_payload {
  from_hook = "payload_input"
}
```

Hook:

```ts
runtime.registerHook("payload_input", () => {
  return {
    raw_payload: "...data..."
  }
})
```

---

# 7. Hook Result Mapping

If multiple bindings reference the same hook:

```hcl
prepare {
  raw_payload { from_hook = "request_context" }
  user_agent  { from_hook = "request_context" }
}
```

the runtime:

1. executes the hook **once**
2. reuses the returned object

Mapping:

```
state.raw_payload = result.raw_payload
state.user_agent  = result.user_agent
```

---

# 8. Merge Section

`merge` persists selected bindings to SSOT.

Example:

```hcl
merge {

  receipt {
    to_ssot = orders.last_receipt
  }

}
```

Rule:

```
SSOT[path] = state[binding]
```

---

# 9. Publish Section

`publish` emits the final state snapshot to hook events.

Example:

```hcl
publish {
  hook = "audit_export"
}
```

Multiple hooks are allowed:

```hcl
publish {
  hook = "audit_export"
  hook = "metrics_emit"
}
```

Publish hooks receive the **entire action state**.

Example payload:

```
{
  raw_payload: "...",
  user_id: "u123",
  receipt: "..."
}
```

---

# 10. Hook Capabilities

Hooks are read-only with respect to action state.

| phase   | read runtime context | read state | write state |
| ------- | -------------------- | ---------- | ----------- |
| prepare | yes                  | optional   | no          |
| publish | no                   | yes        | no          |

Hooks cannot mutate bindings.

State mutation occurs only through `prepare` mappings.

---

# 11. Execution Order

Action execution proceeds in this order:

```
1 resolve prepare.from_ssot
2 invoke prepare hooks
3 map hook results into bindings
4 execute compute graph
5 apply merge.to_ssot
6 invoke publish hooks with final state
```

---

# 12. Correspondence Rules

Binding declarations must correspond to prepare/merge entries.

| sigil | required section |
| ----- | ---------------- |
| `~>`  | prepare          |
| `<~`  | merge            |
| `<~>` | both             |

Invalid cases include:

* sigiled binding without corresponding section
* prepare entry for non-prepare binding
* merge entry for non-merge binding
* duplicate binding entries
* prepare entry with multiple sources

---

# 13. Errors

| error                   | condition                                  |
| ----------------------- | ------------------------------------------ |
| `MissingPrepareEntry`   | `~>` or `<~>` binding missing prepare      |
| `MissingMergeEntry`     | `<~` or `<~>` binding missing merge        |
| `DuplicatePrepareEntry` | binding appears twice in prepare           |
| `DuplicateMergeEntry`   | binding appears twice in merge             |
| `InvalidPrepareSource`  | prepare entry has multiple or zero sources |
| `MissingHookField`      | hook result lacks required field           |
| `InvalidSsotPath`       | invalid SSOT path syntax                   |

---

# 14. Complete Example

```hcl
action "process_order" {

  compute {
    root = receipt

    prog "order_graph" {

      ~>raw_payload:string = ""
      ~>user_id:string     = ""

      <~receipt:string =
        build_receipt(raw_payload, user_id)

    }
  }

  prepare {

    user_id {
      from_ssot = session.user_id
    }

    raw_payload {
      from_hook = "payload_input"
    }

  }

  merge {

    receipt {
      to_ssot = orders.last_receipt
    }

  }

  publish {

    hook = "audit_export"
    hook = "metrics_emit"

  }

}
```

Example hooks:

```ts
runtime.registerHook("payload_input", (ctx) => {
  return {
    raw_payload: ctx.requestBody()
  }
})
```

```ts
runtime.registerHook("audit_export", (ctx) => {
  audit.log(ctx.state())
})
```

---

# 15. Design Summary

The model separates responsibilities clearly:

| layer   | responsibility                   |
| ------- | -------------------------------- |
| prog    | declare computation and bindings |
| prepare | construct input state            |
| merge   | persist results                  |
| publish | expose final state               |

Key properties:

* sigils define directional intent
* binding names remain canonical identifiers
* hooks never mutate state
* state mappings are declared explicitly in the spec

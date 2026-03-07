# Hook Specification — Turn DSL

> **Status**: Draft for implementation
> **Scope**: Turn DSL `hook` block syntax inside `action` blocks, their lowering to canonical HCL, the runtime execution model, and the TypeScript registration API

---

## Overview

A `hook` is a named extension point declared inside an `action` block. It lets consumers inject TypeScript logic at a fixed point in the action execution lifecycle — either before the compute graph runs (`pre`) or after it completes (`post`) — and selectively read or write specific prog binding values.

Hooks are **declared at convert time** (Turn DSL → canonical HCL) and **implemented at runtime** by the consumer via `runtime.registerHook()`. If no implementation is registered for a hook name, the runtime silently skips it.

```
action "foo" {
  compute {
    root = result
    prog "foo_graph" {
      name:string   = ""
      result:string = process(name)
    }
  }

  hook "user_input" {
    timing = "pre"
    affect {
      name { binding = "name" }
    }
  }
}
```

---

## 1. DSL Syntax

### 1.1 Structure

```
action "<actionId>" {
  compute { ... }
  io { ... }            # optional — SSOT effects

  hook "<hookName>" {
    timing = "<pre|post>"
    affect {
      <alias> { binding = "<bindingName>" }
      ...
    }
  }

  hook "<hookName2>" {  # multiple hooks allowed
    ...
  }
}
```

- `hook` is a sibling of `compute` and `io` inside an `action` block.
- `<hookName>` is the label the consumer uses to register their TypeScript implementation.
- `timing` is required and must be exactly `"pre"` or `"post"`.
- `affect` declares which prog bindings this hook implementation may read and write. Each entry maps a local alias (used inside the hook implementation) to a binding name in the action's `prog` block.
- An action can declare multiple `hook` blocks; each must have a distinct name label.
- Multiple hooks with the same `timing` execute in declaration order.

### 1.2 Timing semantics

| `timing` | Fires | Can write to `affect` bindings | Can read `affect` bindings |
|----------|-------|-------------------------------|---------------------------|
| `"pre"`  | Before `executeGraph` | Yes — values injected before compute graph runs | Yes — reads initial/ssot-resolved values |
| `"post"` | After `executeGraph` | Yes — values override result bindings before merge | Yes — reads compute graph output |

- A `pre` hook that `set()`s a binding overrides whatever value was resolved (from SSOT or default) before the compute graph sees it.
- A `post` hook that `set()`s a binding overrides the compute graph's output before the merge delta `D_n` is built. The overridden value goes through the normal atomic merge.

### 1.3 Execution order within an action

```
1. Resolve ssot_input bindings from S_n
2. Execute "pre" hooks (declaration order); each registered hook may set() affect bindings
3. executeGraph — compute graph runs with current binding values
4. Execute "post" hooks (declaration order); each registered hook may set() affect bindings
5. Build merge delta D_n from result bindings
6. Atomically apply D_n to SSOT → S_{n+1}
7. Evaluate transitions
```

### 1.4 Complete example

```
action "enrich" {
  compute {
    root = enriched_payload
    prog "enrich_graph" {
      ~>raw_payload:string = ""
      extra_field:string   = ""
      enriched_payload:string = concat(raw_payload, extra_field)
    }
  }

  hook "inject_extra" {
    timing = "pre"
    affect {
      extra_field { binding = "extra_field" }
    }
  }

  hook "audit_log" {
    timing = "post"
    affect {
      enriched_payload { binding = "enriched_payload" }
    }
  }

  io {
    in { raw_payload { from_ssot = request.payload } }
  }
}
```

---

## 2. HCL Lowering

Hook declarations are lowered to `hook` sub-blocks inside the action's `prog` block in the emitted canonical HCL. They appear alongside `ssot_input` and `ssot_output` sub-blocks.

### 2.1 Shape

```hcl
prog "enrich_graph" {
  ssot_input {
    binding "raw_payload" { ssot_path = "request.payload" }
  }

  hook "inject_extra" {
    timing = "pre"
    binding "extra_field" { }
  }

  hook "audit_log" {
    timing   = "post"
    binding "enriched_payload" { }
  }

  binding "raw_payload" {
    type  = "string"
    value = ""
  }
  binding "extra_field" {
    type  = "string"
    value = ""
  }
  binding "enriched_payload" {
    type = "string"
    expr = { combine = { fn = "concat" args = [{ ref = "raw_payload" }, { ref = "extra_field" }] } }
  }
}
```

Rules:
- Each `hook "<name>"` sub-block contains `timing` and one `binding "<name>" { }` entry per `affect` entry.
- The alias from `affect { <alias> { binding = "..." } }` is not preserved in HCL — only the target binding name is emitted.
- Multiple `hook` sub-blocks are emitted in declaration order.
- The binding name inside a `hook` sub-block must match an existing `binding` block in the same `prog`.

---

## 3. Runtime Execution Model

### 3.1 Hook registration API (TypeScript)

```typescript
interface HookContext {
  readonly actionId: string;
  readonly hookName: string;
  readonly timing: "pre" | "post";
  /** Read the current value of a binding declared in the hook's affect block. */
  get(binding: string): unknown;
  /** Override the value of a binding declared in the hook's affect block. */
  set(binding: string, value: unknown): void;
}

type HookImpl = (ctx: HookContext) => void | Promise<void>;

// Registration
runtime.registerHook(hookName: string, impl: HookImpl): void;
```

Consumers call `runtime.registerHook()` once per hook name before execution begins. The hook name must match the label declared in the Turn DSL.

```typescript
runtime.registerHook("inject_extra", async (ctx) => {
  ctx.set("extra_field", await fetchExtra(ctx.get("raw_payload")));
});

runtime.registerHook("audit_log", async (ctx) => {
  console.log(ctx.actionId, ctx.get("enriched_payload"));
});
```

### 3.2 Unregistered hooks

If no implementation has been registered for a hook name when the action executes, the runtime **silently skips** that hook. No error or warning is emitted. Binding values are left unchanged.

### 3.3 Multiple hooks, same timing

When multiple hooks share the same `timing`, they execute in declaration order. Each hook sees the binding values as left by the previous hook — i.e., `set()` by an earlier hook is visible to a later hook's `get()` for the same binding.

### 3.4 Hook isolation

- A hook implementation can only `get()` and `set()` bindings declared in its own `affect` block in the DSL. Attempting to access a binding outside the `affect` block throws a runtime error.
- A `post` hook cannot write to SSOT directly. Values written via `set()` feed into `D_n` through the normal merge step.

---

## 4. CAN (OK)

- A `hook` block can appear as a sibling of `compute` and `io` inside an `action`.
- An action can declare multiple `hook` blocks with distinct name labels.
- Multiple hooks can share the same `timing` value; they execute in declaration order.
- Two hooks in the same action can affect overlapping or identical bindings.
- A `pre` hook can `set()` a binding before the compute graph runs; the compute graph observes the updated value.
- A `post` hook can `set()` a result binding; the updated value enters `D_n` and is merged into SSOT.
- A `post` hook can `get()` any binding declared in its `affect` block, including non-SSOT bindings computed by the graph.
- If no implementation is registered for a hook name, the runtime silently skips it.
- The converter can emit multiple `hook` sub-blocks inside a single `prog` block, in declaration order.
- A hook can coexist with `ssot_input` / `ssot_output` sub-blocks in the same `prog` block.

---

## 5. CAN'T (NG)

- Two `hook` blocks in the same action cannot share the same name label (`DuplicateHookLabel`).
- A `hook` block cannot have a `timing` value other than `"pre"` or `"post"` (`InvalidHookTiming`).
- A `hook.affect` entry cannot reference a binding name not present in the action's `prog` block (`UnresolvedHookAffectBinding`).
- A hook implementation cannot `get()` or `set()` a binding not declared in its `affect` block (runtime error).
- A `hook` block cannot appear inside a `next { }` transition block (`TransitionHook`).
- A `post` hook cannot write to SSOT directly; all writes must go through the declared merge step.
- Hook execution order cannot be changed at runtime; it is fixed by declaration order in the emitted HCL.
- A `pre` hook cannot observe compute graph results (graph has not run yet); only initial/ssot-resolved binding values are available.

---

## 6. Error Catalogue

| Error code | Trigger condition |
|------------|------------------|
| `DuplicateHookLabel` | Two `hook` blocks with the same name label in one `action` |
| `InvalidHookTiming` | `timing` value is not `"pre"` or `"post"` |
| `UnresolvedHookAffectBinding` | A `hook.affect` binding name has no matching `binding` block in the same `prog` |
| `TransitionHook` | A `hook` block appears inside a `next { }` transition block |

---

## 7. Test Plan

### Domain categories

| Domain | Coverage target |
|--------|----------------|
| A. DSL parsing | `hook` block with `timing` and `affect` correctly parsed |
| B. HCL lowering | `hook` sub-blocks emitted inside `prog` in declaration order |
| C. Binding validation | `affect` binding names validated against `prog` bindings at convert time |
| D. Pre-hook execution | Hook fires before graph; `set()` value visible to compute graph |
| E. Post-hook execution | Hook fires after graph; `set()` value enters `D_n` and merges to SSOT |
| F. Declaration order | Multiple hooks with same timing execute in declaration order |
| G. Unregistered hook | Silently skipped; no error, binding values unchanged |
| H. Hook isolation | `get()`/`set()` outside `affect` block raises runtime error |
| I. Error paths | All 4 error codes trigger correctly and abort without partial output |

### Critical paths (idempotency)

| # | Path | Idempotency check |
|---|------|------------------|
| 1 | DSL hook declaration → emitted HCL `hook` sub-block | Re-lower same DSL source; emitted HCL is byte-identical |
| 2 | Pre-hook `set()` → compute graph observes value | Same hook impl + same initial state → identical graph result both runs |
| 3 | Post-hook `set()` → value in `D_n` → SSOT | Same hook impl + same graph output → identical SSOT after merge both runs |
| 4 | Unregistered hook → no state change | Execute with hook unregistered; assert binding values identical to no-hook run |

### Edge cases

| Case | Expected behaviour |
|------|--------------------|
| Two `hook` blocks with the same name in one action | `DuplicateHookLabel` error at convert time |
| `timing = "around"` | `InvalidHookTiming` error |
| `affect { x { binding = "nonexistent" } }` | `UnresolvedHookAffectBinding` error at convert time |
| `hook` inside a `next { }` block | `TransitionHook` error |
| Hook registered but `set()` called on binding not in `affect` | Runtime error; execution aborted |
| Two `pre` hooks both `set()` the same binding | Second hook's value wins (declaration order); compute graph sees second value |
| Hook impl is async and rejects | Runtime error propagated; action execution aborted; SSOT not mutated |
| No `affect` entries declared in hook | Valid — hook can observe nothing and set nothing; effectively a no-op |
| Action has `pre` and `post` hooks; `pre` hook unregistered | Pre hook silently skipped; post hook executes normally |

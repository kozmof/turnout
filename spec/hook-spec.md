# Hook Specification — Turn DSL

> **Status**: Draft for implementation
> **Scope**: Turn DSL `hook` declarations inside `io` blocks, their lowering to canonical HCL, the runtime execution model, and the TypeScript registration API

---

## Overview

A hook is a named extension point declared inside an `io` block. It lets consumers inject TypeScript logic at a fixed point in the action execution lifecycle — either before the compute graph runs (`pre`) or after it completes (`post`) — and selectively read or write specific prog binding values.

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

  io {
    in {
      name { from_hook = "user_input" }
    }
  }
}
```

---

## 1. DSL Syntax

### 1.1 Structure

Hooks are declared inline inside the `io` block using `from_hook`:

```
action "<actionId>" {
  compute { ... }

  io {
    in {
      <bindingName> { from_ssot = <path> }                              # SSOT input
      <bindingName> { from_hook = "<hookName>" }                        # pre-hook input
    }
    out {
      <bindingName> { to_ssot = <path> }                                # SSOT output
      <bindingName> { from_hook = "<hookName>" }                        # post-hook output
      <bindingName> { to_ssot = <path>, from_hook = "<hookName>" }      # both
    }
  }
}
```

**Direction → timing mapping:**

| `io` direction | Implied hook timing |
|---------------|---------------------|
| `in`          | `pre`               |
| `out`         | `post`              |

**`in` block** — each entry may carry one of:
- `from_ssot = <path>` — read binding from SSOT before the compute graph
- `from_hook = "<hookName>"` — register a `pre` hook that may `set()` this binding

**`out` block** — each entry may carry:
- `to_ssot = <path>` — write binding to SSOT after the compute graph
- `from_hook = "<hookName>"` — register a `post` hook that may `set()` this binding
- both `to_ssot` and `from_hook` may appear together on the same binding

**Multiple bindings, same hook name:** The same `hookName` may appear on multiple `in` entries (or multiple `out` entries). All matching bindings are aggregated — the hook implementation can `get()`/`set()` all of them.

### 1.2 Timing semantics

| Implied timing | Fires | Can write bindings | Can read bindings |
|----------------|-------|-------------------|------------------|
| `pre` (from `in`) | Before `executeGraph` | Yes — values injected before compute graph runs | Yes — reads initial/ssot-resolved values |
| `post` (from `out`) | After `executeGraph` | Yes — values override result bindings before merge | Yes — reads compute graph output |

- A `pre` hook that `set()`s a binding overrides whatever value was resolved (from SSOT or default) before the compute graph sees it.
- A `post` hook that `set()`s a binding overrides the compute graph's output before the merge delta `D_n` is built. The overridden value goes through the normal atomic merge.

### 1.3 Execution order within an action

```
1. Resolve from_ssot bindings from S_n
2. Execute "pre" hooks (io.in declaration order); each registered hook may set() its bindings
3. executeGraph — compute graph runs with current binding values
4. Execute "post" hooks (io.out declaration order); each registered hook may set() its bindings
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
      raw_payload:string      = ""
      extra_field:string      = ""
      enriched_payload:string = concat(raw_payload, extra_field)
    }
  }

  io {
    in {
      raw_payload { from_ssot = request.payload }
      extra_field { from_hook = "inject_extra" }
    }
    out {
      enriched_payload { from_hook = "audit_log" }
    }
  }
}
```

---

## 2. HCL Lowering

`from_hook` entries are lowered to `hook` sub-blocks inside the action's `prog` block in the emitted canonical HCL. They appear alongside `ssot_input` and `ssot_output` sub-blocks.

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
- Each `hook "<name>"` sub-block contains `timing` and one `binding "<name>" { }` entry per `from_hook` entry that shares that name.
- `timing` is derived from the `io` direction: `in` → `"pre"`, `out` → `"post"`.
- Multiple `hook` sub-blocks are emitted in declaration order within their respective `in`/`out` groups (`in` entries before `out` entries).
- The binding name inside a `hook` sub-block must match an existing `binding` block in the same `prog`.

---

## 3. Runtime Execution Model

### 3.1 Hook registration API (TypeScript)

```typescript
interface HookContext {
  readonly actionId: string;
  readonly hookName: string;
  readonly timing: "pre" | "post";
  /** Read the current value of a binding declared with this hook's name in io. */
  get(binding: string): unknown;
  /** Override the value of a binding declared with this hook's name in io. */
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

When multiple hooks share the same timing (`pre` or `post`), they execute in declaration order within the `in`/`out` block. Each hook sees the binding values as left by the previous hook — i.e., `set()` by an earlier hook is visible to a later hook's `get()` for the same binding.

### 3.4 Hook isolation

- A hook implementation can only `get()` and `set()` bindings declared with its name in the `io` block. Attempting to access any other binding throws a runtime error.
- A `post` hook cannot write to SSOT directly. Values written via `set()` feed into `D_n` through the normal merge step.

---

## 4. CAN (OK)

- `io.in { <binding> { from_hook = "<name>" } }` declares a `pre` hook for that binding.
- `io.out { <binding> { from_hook = "<name>" } }` declares a `post` hook for that binding.
- An `io.out` entry may carry both `to_ssot` and `from_hook` on the same binding; both effects are applied.
- The same hook name may appear on multiple `in` entries (or multiple `out` entries); all matching bindings are aggregated into one hook.
- Multiple distinct hook names may be declared in the same `io` block.
- Multiple hooks with the same timing execute in declaration order.
- Two hooks in the same action can affect overlapping or identical bindings.
- A `pre` hook can `set()` a binding before the compute graph runs; the compute graph observes the updated value.
- A `post` hook can `set()` a result binding; the updated value enters `D_n` and is merged into SSOT.
- A `post` hook can `get()` any binding declared with its name in `io.out`, including non-SSOT bindings computed by the graph.
- If no implementation is registered for a hook name, the runtime silently skips it.
- The converter can emit multiple `hook` sub-blocks inside a single `prog` block, in declaration order.
- A hook can coexist with `ssot_input` / `ssot_output` sub-blocks in the same `prog` block.

---

## 5. CAN'T (NG)

- The same hook name cannot appear in both `io.in` and `io.out` (`HookTimingConflict`); a hook has exactly one timing.
- `from_hook` cannot appear on an `io.in` entry together with `from_ssot` on the same binding (`ConflictingIoSources`); an `in` binding has exactly one source.
- A `from_hook` binding name cannot be absent from the action's `prog` block (`UnresolvedHookBinding`).
- A hook implementation cannot `get()` or `set()` a binding not declared with its name in the `io` block (runtime error).
- A `post` hook cannot write to SSOT directly; all writes must go through the declared merge step.
- Hook execution order cannot be changed at runtime; it is fixed by declaration order in the emitted HCL.
- A `pre` hook cannot observe compute graph results (graph has not run yet); only initial/ssot-resolved binding values are available.

---

## 6. Error Catalogue

| Error code | Trigger condition |
|------------|------------------|
| `HookTimingConflict` | The same hook name appears in both `io.in` and `io.out` in one `action` |
| `UnresolvedHookBinding` | A `from_hook` binding name has no matching `binding` block in the same `prog` |
| `ConflictingIoSources` | An `io.in` binding entry carries both `from_ssot` and `from_hook` |

---

## 7. Test Plan

### Domain categories

| Domain | Coverage target |
|--------|----------------|
| A. DSL parsing | `io.in/out` with `from_hook` correctly parsed; timing inferred from direction |
| B. HCL lowering | `hook` sub-blocks emitted inside `prog` in declaration order |
| C. Binding validation | `from_hook` binding names validated against `prog` bindings at convert time |
| D. Pre-hook execution | Hook fires before graph; `set()` value visible to compute graph |
| E. Post-hook execution | Hook fires after graph; `set()` value enters `D_n` and merges to SSOT |
| E2. Post-hook + SSOT output | `io.out` binding with both `from_hook` and `to_ssot`; hook value goes through merge |
| F. Declaration order | Multiple hooks with same timing execute in declaration order |
| G. Unregistered hook | Silently skipped; no error, binding values unchanged |
| H. Hook isolation | `get()`/`set()` outside declared bindings raises runtime error |
| I. Error paths | All 3 error codes trigger correctly and abort without partial output |

### Critical paths (idempotency)

| # | Path | Idempotency check |
|---|------|------------------|
| 1 | `io`-inline `from_hook` → emitted HCL `hook` sub-block | Re-lower same DSL source; emitted HCL is byte-identical |
| 2 | Pre-hook `set()` → compute graph observes value | Same hook impl + same initial state → identical graph result both runs |
| 3 | Post-hook `set()` → value in `D_n` → SSOT | Same hook impl + same graph output → identical SSOT after merge both runs |
| 4 | Unregistered hook → no state change | Execute with hook unregistered; assert binding values identical to no-hook run |

### Edge cases

| Case | Expected behaviour |
|------|--------------------|
| Same hook name in `io.in` and `io.out` | `HookTimingConflict` error at convert time |
| `io.in { x { from_ssot = p, from_hook = "h" } }` | `ConflictingIoSources` error at convert time |
| `io.in { x { from_hook = "h" } }` where `x` is not in `prog` | `UnresolvedHookBinding` error at convert time |
| `io.out { x { to_ssot = p, from_hook = "h" } }` | Valid — post hook runs, then value (possibly overridden) enters merge |
| Same hook name on multiple `in` entries | Valid — bindings are aggregated; hook impl can get/set all of them |
| Hook registered but `set()` called on binding not in `io` | Runtime error; execution aborted |
| Two `pre` hooks both `set()` the same binding | Second hook's value wins (declaration order); compute graph sees second value |
| Hook impl is async and rejects | Runtime error propagated; action execution aborted; SSOT not mutated |
| Action has `pre` and `post` hooks; `pre` hook unregistered | Pre hook silently skipped; post hook executes normally |

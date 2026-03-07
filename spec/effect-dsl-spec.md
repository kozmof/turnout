# Effect DSL Specification — Turn DSL

> **Status**: Draft for implementation
> **Scope**: Turn DSL syntax for SSOT effect declarations (sigils + `io` block) and transition ingress declarations, and their lowering to canonical HCL

---

## Overview

SSOT effects in Turn DSL are expressed through two complementary parts that must always appear together:

1. **Sigil** — a directional prefix on a binding declaration inside a `prog` block, marking it as SSOT-connected and specifying the direction.
2. **`io` block** — a sibling block to `compute` inside an `action`, mapping sigiled binding names to concrete SSOT dotted paths.

```
action "score" {
  compute {
    root = decision
    prog "score_graph" {
      ~>income:int   = 0                          # ← sigil: input from SSOT
      <~decision:bool = bool_and(income_ok, debt_ok) # ← sigil: output to SSOT
      income_ok:bool  =| income >= 50000          # plain compute binding
    }
  }

  io {
    in  { income   { from_ssot = applicant.income  } }  # ← SSOT path for ~>income
    out { decision { to_ssot   = decision.approved } }  # ← SSOT path for <~decision
  }
}
```

Each part is required when the other is present — a sigiled binding with no `io` entry is an error, and an `io` entry with no matching sigil is an error.

---

## 1. Sigil Syntax

### 1.1 Sigil forms

| Sigil | Direction | `io` requirement |
|-------|-----------|-----------------|
| `~>` | Pre-action input: SSOT → binding | Must appear in `io.in` exactly once |
| `<~` | Post-action output: binding → SSOT | Must appear in `io.out` exactly once |
| `<~>` | Bidirectional: SSOT→binding pre-action **and** binding→SSOT post-action | Must appear in both `io.in` and `io.out` exactly once each |

### 1.2 Grammar

```
sigil-decl   ::= sigil IDENT ':' type '=' (literal | expr)
sigil        ::= '~>' | '<~' | '<~>'
```

The sigil is written immediately before the binding name — no whitespace between sigil and name:

```
~>income:int = 0        # OK
~ > income:int = 0      # NG — space not allowed
```

### 1.3 Semantics of the default value

The value or expression on the right-hand side of a sigiled binding is a **type-system sentinel** — it exists to satisfy the binding type declaration and serves as the compute-graph's structural value. It has **no effect on SSOT resolution**.

- All `from_ssot` entries are `required = true`. A missing SSOT path at runtime is an error regardless of the binding's default value.
- The sentinel value is still lowered into the canonical `binding` block as `value` or `expr`, so the compute graph remains well-typed.

```
# The '0' is a type sentinel only.
# If applicant.income is absent in S_n, runtime error — not fallback to 0.
~>income:int = 0
io { in { income { from_ssot = applicant.income } } }
```

### 1.4 Bidirectional sigil

`<~>` signals that the binding is populated from SSOT before execution **and** written back to SSOT after merge — potentially at **different SSOT paths**:

```
<~>income:int = 0
io {
  in  { income { from_ssot = applicant.income      } }   # reads from applicant.income
  out { income { to_ssot   = decision.input_income } }   # writes to decision.input_income
}
```

---

## 2. `io` Block — Action Level

### 2.1 Structure

```
io {
  in {
    <binding_name> {
      from_ssot = <dotted.path>
    }
    ...
  }
  out {
    <binding_name> {
      to_ssot = <dotted.path>
    }
    ...
  }
}
```

- `io` is a sibling of `compute` inside `action`.
- `io.in` and `io.out` are each optional; an `io` block with only `in` or only `out` is valid.
- The `io` block itself may be omitted entirely for pure-compute actions that have no SSOT effects.

### 2.2 SSOT path format

`from_ssot` and `to_ssot` values are **dotted paths**:

```
dotted-path ::= IDENT ('.' IDENT)*
IDENT       ::= [A-Za-z_][A-Za-z0-9_]*
```

Examples: `applicant.income`, `workflow.stage`, `request.flags.need_grounding`.

An empty segment (e.g. `foo..bar`) or a path starting/ending with `.` is invalid (`InvalidSsotPath`).

### 2.3 Complete action-level example

```
action "score" {
  compute {
    root = decision
    prog "score_graph" {
      <~>income:int    = 0
      ~>debt:int       = 0
      min_income:int   = 50000
      max_debt:int     = 20000

      income_ok:bool   =| income >= min_income
      debt_ok:bool     =| debt <= max_debt
      <~decision:bool  = bool_and(income_ok, debt_ok)
    }
  }

  io {
    in {
      income { from_ssot = applicant.income }   # ~> and <~> income
      debt   { from_ssot = applicant.debt   }   # ~> debt
    }
    out {
      income   { to_ssot = decision.input_income }  # <~> income (different path)
      decision { to_ssot = decision.approved     }  # <~ decision
    }
  }
}
```

---

## 3. `io` Block — Transition Level

### 3.1 Structure

Inside a `next { }` block, the `io` block declares **ingress bindings** for the transition's compute program. Only `io.in` is valid; `io.out` is prohibited (transitions cannot write to SSOT).

```
next {
  compute {
    condition = go
    prog "to_approve" {
      ~>decision:bool  = false
      ~>income_ok:bool = false
      go:bool =| decision & income_ok
    }
  }
  io {
    in {
      decision  { from_action = decision  }   # from action output R_n
      income_ok { from_action = income_ok }   # from action output R_n
    }
  }
  action = approve
}
```

### 3.2 Ingress source attributes

Each entry inside `io.in` (transition level) must have exactly one of:

| Attribute | Source | Maps to |
|-----------|--------|---------|
| `from_action = <binding>` | Action output `R_n` — value of the named binding from the action's result | `TransitionIngressBinding.fromAction` |
| `from_ssot = <dotted.path>` | Post-merge SSOT `S_{n+1}` — the SSOT state after the action's merge | `TransitionIngressBinding.fromSsot` |

Both `from_action` and `from_ssot` may be used in the same transition `io.in` block, one per entry.

### 3.3 Sigil on transition `prog` bindings

The `~>` sigil inside a transition `prog` block marks a binding as an ingress binding — one that will be populated from the transition `io.in` entries. The sigil semantics are the same as at action level: the default value is a type-system sentinel.

`<~` and `<~>` sigils are **not valid** in transition `prog` blocks (transitions cannot output to SSOT).

### 3.4 Complete transition example

```
next {
  compute {
    condition = go_publish
    prog "to_publish_response" {
      ~>approved:bool = false     # ingress from action output
      go_publish:bool = bool_and(approved, true)
    }
  }
  io {
    in {
      approved { from_action = approved }
    }
  }
  action = publish_response
}
```

---

## 4. Correspondence Rules

### CAN (OK)

- A `~>` binding can appear in `io.in` with a `from_ssot` path.
- A `<~` binding can appear in `io.out` with a `to_ssot` path.
- A `<~>` binding can appear in both `io.in` and `io.out` with different SSOT paths.
- The `io` block can be omitted entirely when no sigiled bindings are declared.
- `io.in` and `io.out` are each optional within an `io` block.
- A transition `io.in` entry can use `from_action` and another entry in the same block can use `from_ssot`.
- A `~>` binding in a transition `prog` block can have its ingress declared via `from_action` or `from_ssot`.

### CAN'T (NG)

- A sigiled binding (`~>`, `<~`, `<~>`) cannot lack a corresponding `io` entry — the sigil and `io` entry must both be present.
- An `io` entry cannot reference a binding name that has no sigil in the corresponding `prog` block.
- The same binding name cannot appear twice in `io.in` or twice in `io.out`.
- A `<~>` binding cannot be present in `io.in` but absent from `io.out`, or vice versa.
- `io.out` cannot appear inside a `next { }` transition block.
- A transition `io.in` entry cannot have neither `from_action` nor `from_ssot`.
- A transition `io.in` entry cannot have both `from_action` and `from_ssot` simultaneously.
- `<~` or `<~>` sigils cannot appear inside a transition `prog` block.
- A plain (no-sigil) binding cannot appear in any `io` sub-block.

---

## 5. Lowering Rules (Turn DSL → Canonical HCL)

Sigils are stripped from the canonical binding name during lowering. The sigil information is encoded structurally in `ssot_input` / `ssot_output` sub-blocks inside the emitted `prog` block (per `convert-runtime-spec.md`).

### 5.1 Action-level lowering

**Turn DSL source:**
```
prog "score_graph" {
  ~>income:int   = 0
  <~decision:bool = bool_and(income_ok, debt_ok)
  income_ok:bool  =| income >= min_income
  min_income:int  = 50000
}
io {
  in  { income   { from_ssot = applicant.income  } }
  out { decision { to_ssot   = decision.approved } }
}
```

**Emitted canonical HCL:**
```hcl
prog "score_graph" {
  ssot_input {
    binding "income" { ssot_path = "applicant.income" }
  }
  ssot_output {
    binding "decision" { ssot_path = "decision.approved" }
  }

  binding "income" {
    type  = "int"
    value = 0
  }
  binding "decision" {
    type = "bool"
    expr = { combine = { fn = "bool_and" args = [{ ref = "income_ok" }, { ref = "debt_ok" }] } }
  }
  binding "income_ok" {
    type = "bool"
    expr = { combine = { fn = "gte" args = [{ ref = "income" }, { ref = "min_income" }] } }
  }
  binding "min_income" {
    type  = "int"
    value = 50000
  }
}
```

### 5.2 Bidirectional (`<~>`) lowering

A `<~>` binding appears in **both** `ssot_input` and `ssot_output` with their respective paths:

**Turn DSL:**
```
<~>income:int = 0
io {
  in  { income { from_ssot = applicant.income      } }
  out { income { to_ssot   = decision.input_income } }
}
```

**Emitted HCL:**
```hcl
ssot_input  { binding "income" { ssot_path = "applicant.income"      } }
ssot_output { binding "income" { ssot_path = "decision.input_income" } }
binding "income" { type = "int" value = 0 }
```

### 5.3 Transition-level lowering

Transition `io.in` entries lower to `TransitionIngressBinding` records in the scene model — they do **not** produce `ssot_input`/`ssot_output` blocks (those are action-only). The transition `prog` block is lowered to canonical HCL the same as an action prog (sigils stripped, bindings emitted), but with no `ssot_*` sub-blocks.

---

## 6. Error Catalogue

| Error code | Trigger condition |
|------------|------------------|
| `MissingSsotIoEntry` | A `~>`, `<~`, or `<~>` binding has no matching entry in the action `io` block |
| `SpuriousIoEntry` | An `io.in` or `io.out` entry references a binding that has no sigil in the `prog` block |
| `DuplicateIoEntry` | The same binding name appears more than once in `io.in` or more than once in `io.out` |
| `BidirMissingInEntry` | A `<~>` binding appears in `io.out` but not in `io.in` |
| `BidirMissingOutEntry` | A `<~>` binding appears in `io.in` but not in `io.out` |
| `TransitionIoOut` | An `io.out` block is present inside a `next { }` transition |
| `InvalidTransitionIngress` | A transition `io.in` entry has neither `from_action` nor `from_ssot`, or has both |
| `TransitionOutputSigil` | A `<~` or `<~>` sigil appears in a transition `prog` block |
| `InvalidSsotPath` | A `from_ssot` or `to_ssot` value is not a valid dotted identifier path |
| `UnresolvedSsotBinding` | An `ssot_input`/`ssot_output` binding name has no matching `binding` block in the same `prog` (emitted HCL level) |

---

## 7. Test Plan

### Domain categories

| Domain | Coverage target |
|--------|----------------|
| A. Sigil parsing | All three sigil forms (`~>`, `<~`, `<~>`) correctly identified |
| B. `io` correspondence | Sigil ↔ `io` entry matching validated at convert time |
| C. Bidirectional lowering | `<~>` produces entries in both `ssot_input` and `ssot_output` |
| D. Sentinel value | Binding default lowered as `value`/`expr`; no effect on SSOT resolution |
| E. Transition `io.in` | `from_action` and `from_ssot` entries lower to correct `TransitionIngressBinding` fields |
| F. Error paths | All 10 error codes trigger correctly and abort without partial output |

### Critical paths (idempotency)

| # | Path | Idempotency check |
|---|------|------------------|
| 1 | `~>` binding + `io.in` → `ssot_input` block | Re-lower same DSL source; emitted HCL is byte-identical |
| 2 | `<~` binding + `io.out` → `ssot_output` block | Re-lower same DSL source; emitted HCL is byte-identical |
| 3 | `<~>` binding + `io.in` + `io.out` (different paths) → both sub-blocks | Both paths preserved; independent of declaration order |
| 4 | Action with no `io` block → no `ssot_input`/`ssot_output` sub-blocks emitted | Pure-compute action emits clean `prog` block |
| 5 | Transition `io.in { from_action }` → `TransitionIngressBinding.fromAction` | Field mapping is deterministic for identical input |
| 6 | Transition `io.in { from_ssot }` → `TransitionIngressBinding.fromSsot` | Field mapping is deterministic for identical input |

### Edge cases

| Case | Expected behaviour |
|------|--------------------|
| `~>income:int = 0` with no `io` block at all | `MissingSsotIoEntry` |
| `io.in { income { from_ssot = ... } }` where `income` has no sigil | `SpuriousIoEntry` |
| `<~>income` appears in `io.out` but not in `io.in` | `BidirMissingInEntry` |
| `<~>income` appears in `io.in` but not in `io.out` | `BidirMissingOutEntry` |
| `io.out` present inside a `next { }` block | `TransitionIoOut` |
| Transition `io.in` entry with no `from_action` and no `from_ssot` | `InvalidTransitionIngress` |
| Transition `io.in` entry with both `from_action` and `from_ssot` | `InvalidTransitionIngress` |
| `<~phase` sigil inside a transition `prog` block | `TransitionOutputSigil` |
| `from_ssot = "applicant..income"` (empty segment) | `InvalidSsotPath` |
| `from_ssot = ".income"` (leading dot) | `InvalidSsotPath` |
| Same binding name twice in `io.in` | `DuplicateIoEntry` |
| `~>` binding with `to_ssot` (wrong attribute) in `io.in` | `SpuriousIoEntry` or parse error |
| Action with `io.in` only and no `io.out` | Valid — only `ssot_input` sub-block emitted |
| Action with `io.out` only and no `io.in` | Valid — only `ssot_output` sub-block emitted |

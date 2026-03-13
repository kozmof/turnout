# Effect DSL Specification — Turn DSL

> **Status**: Draft for implementation
> **Scope**: Turn DSL syntax for STATE effect declarations (sigils + `prepare`/`merge` sections) and their lowering to canonical HCL

---

## Overview

STATE effects in Turn DSL are expressed through two complementary parts that must always appear together:

1. **Sigil** — a directional prefix on a binding declaration inside a `prog` block, marking it as STATE-connected and specifying the direction.
2. **`prepare` / `merge` sections** — sibling blocks to `compute` inside an `action`, declaring the concrete STATE dotted paths for sigiled bindings.

```
action "score" {
  compute {
    root = decision
    prog "score_graph" {
      ~>income:int    = _                              # ← sigil: input from STATE
      <~decision:bool = income_ok & debt_ok           # ← sigil: output to STATE
      income_ok:bool  = income >= 50000              # plain compute binding
    }
  }

  prepare {
    income { from_state = applicant.income }    # ← STATE path for ~>income
  }

  merge {
    decision { to_state = decision.approved }   # ← STATE path for <~decision
  }
}
```

Each part is required when the other is present — a sigiled binding with no corresponding `prepare`/`merge` entry is an error, and a `prepare`/`merge` entry with no matching sigil is an error.

Sigils are **direction metadata only**. Canonical binding names do not include sigils:

```
income    # canonical name (not ~>income)
decision  # canonical name (not <~decision)
```

All references in `prepare` and `merge` use plain canonical binding names.

---

## 1. Sigil Syntax

### 1.1 Sigil forms

| Sigil | Direction | Required section |
|-------|-----------|-----------------|
| `~>`  | Pre-action input: STATE → binding | Must appear in `prepare` exactly once |
| `<~`  | Post-action output: binding → STATE | Must appear in `merge` exactly once |
| `<~>` | Bidirectional: STATE→binding pre-action **and** binding→STATE post-action | Must appear in both `prepare` and `merge` exactly once each |

### 1.2 Grammar

```
sigil-decl   ::= sigil IDENT ':' type '=' ('_' | literal | expr)
sigil        ::= '~>' | '<~' | '<~>'
```

The sigil is written immediately before the binding name — no whitespace between sigil and name:

```
~>income:int = _        # OK
~ > income:int = _      # NG — space not allowed
```

### 1.3 Semantics of `_`

The `_` placeholder on the right-hand side of a `~>` or `<~>` binding delegates the default value to the STATE declaration. It avoids repeating the default value that is already authoritative in the `state` block.

- All `from_state` entries are `required = true`. A missing STATE path at runtime is an error; `_` is not a fallback value.
- The converter resolves `_` from the STATE schema and emits the state-declared default in the canonical `binding` block as `value`, so the compute graph remains well-typed.

```
# '_' delegates to the STATE-declared default.
# If applicant.income is absent in STATE, runtime error — not fallback to state default.
~>income:int = _
prepare { income { from_state = applicant.income } }
```

### 1.4 Bidirectional sigil

`<~>` signals that the binding is populated from STATE before execution **and** written back to STATE after merge — potentially at **different STATE paths**:

```
<~>income:int = _
prepare { income { from_state = applicant.income      } }   # reads from applicant.income
merge   { income { to_state   = decision.input_income } }   # writes to decision.input_income
```

---

## 2. `prepare` Section — Action Level

### 2.1 Structure

```
prepare {
  <binding_name> {
    from_state = <dotted.path>
  }
  <binding_name> {
    from_hook = "<hookName>"
  }
  ...
}
```

- `prepare` is a sibling of `compute` inside `action`.
- `prepare` may be omitted entirely for pure-compute actions with no STATE inputs.
- Each entry must define exactly one source: `from_state` or `from_hook`.

### 2.2 `from_state` — reads from STATE

```
<binding_name> { from_state = <dotted.path> }
```

Reads a value from STATE before the compute graph runs and assigns it to the named binding.

### 2.3 `from_hook` — reads from a hook result

```
<binding_name> { from_hook = "<hookName>" }
```

Invokes the named hook, obtains a result object, and assigns `result[bindingName]` to `state[bindingName]`. See `hook-spec.md` for full semantics.

### 2.4 STATE path format

`from_state` values are **dotted paths**:

```
dotted-path ::= IDENT ('.' IDENT)*
IDENT       ::= [A-Za-z_][A-Za-z0-9_]*
```

Examples: `applicant.income`, `workflow.stage`, `session.user_id`.

An empty segment (e.g. `foo..bar`) or a path starting/ending with `.` is invalid (`InvalidSsotPath`).

---

## 3. `merge` Section — Action Level

### 3.1 Structure

```
merge {
  <binding_name> {
    to_state = <dotted.path>
  }
  ...
}
```

- `merge` is a sibling of `compute` inside `action`.
- `merge` may be omitted entirely for pure-compute actions with no STATE outputs.

Rule: `STATE[path] = state[binding]`

### 3.2 Complete action-level example

```
action "score" {
  compute {
    root = decision
    prog "score_graph" {
      <~>income:int    = 0
      ~>debt:int       = 0
      min_income:int   = 50000
      max_debt:int     = 20000

      income_ok:bool   = income >= min_income
      debt_ok:bool     = debt <= max_debt
      <~decision:bool  = income_ok & debt_ok
    }
  }

  prepare {
    income { from_state = applicant.income }
    debt   { from_state = applicant.debt   }
  }

  merge {
    income   { to_state = decision.input_income }
    decision { to_state = decision.approved     }
  }
}
```

---

## 4. Transition-Level `prepare`

### 4.1 Structure

Inside a `next { }` block, a `prepare` block declares **ingress bindings** for the transition's compute program. Only `from_action` and `from_state` are valid sources inside a transition `prepare`; `from_hook` is prohibited (transitions cannot invoke hooks).

```
next {
  compute {
    condition = go
    prog "to_approve" {
      ~>decision:bool  = _
      ~>income_ok:bool = _
      go:bool = decision & income_ok
    }
  }
  prepare {
    decision  { from_action = decision  }
    income_ok { from_action = income_ok }
  }
  action = approve
}
```

### 4.2 Ingress source attributes

Each entry inside a transition `prepare` must have exactly one of:

| Attribute | Source |
|-----------|--------|
| `from_action = <binding>` | Value of the named binding from the action's result |
| `from_state = <dotted.path>` | Post-merge STATE state after the action's merge |

Both may be used in the same transition `prepare` block, one per entry.

### 4.3 Sigil on transition `prog` bindings

`~>` inside a transition `prog` block marks a binding as an ingress binding populated from the transition `prepare` entries. `<~` and `<~>` are **not valid** in transition `prog` blocks (transitions cannot output to STATE).

---

## 5. Correspondence Rules

### CAN (OK)

- A `~>` binding can appear in `prepare` with a `from_state` path.
- A `<~` binding can appear in `merge` with a `to_state` path.
- A `<~>` binding can appear in both `prepare` and `merge` with different STATE paths.
- The `prepare` and `merge` sections can be omitted entirely when no sigiled bindings are declared.
- A transition `prepare` entry can use `from_action` and another entry in the same block can use `from_state`.
- A `~>` binding in a transition `prog` block can have its ingress declared via `from_action` or `from_state`.

### CAN'T (NG)

- A sigiled binding (`~>`, `<~`, `<~>`) cannot lack a corresponding `prepare` or `merge` entry.
- A `prepare` or `merge` entry cannot reference a binding name that has no sigil in the corresponding `prog` block.
- The same binding name cannot appear twice in `prepare` or twice in `merge`.
- A `<~>` binding cannot be present in `prepare` but absent from `merge`, or vice versa.
- A `prepare` entry cannot carry both `from_state` and `from_hook` on the same binding.
- `merge` cannot appear inside a `next { }` transition block.
- A transition `prepare` entry cannot have neither `from_action` nor `from_state`.
- A transition `prepare` entry cannot have both `from_action` and `from_state` simultaneously.
- `<~` or `<~>` sigils cannot appear inside a transition `prog` block.
- A plain (no-sigil) binding cannot appear in `prepare` or `merge`.

---

## 6. Lowering Rules (Turn DSL → Canonical HCL)

Sigils are stripped from the canonical binding name during lowering. The sigil information is encoded structurally by membership in `prepare` (input) or `merge` (output) sections in the emitted action block.

### 6.1 Action-level lowering

**Turn DSL source:**
```
action "score" {
  compute {
    root = decision
    prog "score_graph" {
      ~>income:int    = _
      <~decision:bool = income_ok & debt_ok
      income_ok:bool  = income >= min_income
      min_income:int  = 50000
    }
  }
  prepare {
    income { from_state = applicant.income }
  }
  merge {
    decision { to_state = decision.approved }
  }
}
```

**Emitted canonical HCL:**
```hcl
action "score" {
  compute {
    root = "decision"
    prog "score_graph" {
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
  }
  prepare {
    binding "income" { from_state = "applicant.income" }
  }
  merge {
    binding "decision" { to_state = "decision.approved" }
  }
}
```

### 6.2 Bidirectional (`<~>`) lowering

A `<~>` binding appears in **both** `prepare` and `merge` with their respective paths:

**Turn DSL:**
```
<~>income:int = _
prepare { income { from_state = applicant.income      } }
merge   { income { to_state   = decision.input_income } }
```

**Emitted HCL:**
```hcl
prepare { binding "income" { from_state = "applicant.income"      } }
merge   { binding "income" { to_state   = "decision.input_income" } }
binding "income" { type = "int" value = 0 }
```

### 6.3 Transition-level lowering

Transition `prepare` entries lower to `TransitionIngressBinding` records in the scene model. The transition `prog` block is lowered to canonical HCL the same as an action prog (sigils stripped, bindings emitted), with no `prepare`/`merge` sub-blocks.

---

## 7. Error Catalogue

| Error code | Trigger condition |
|------------|------------------|
| `MissingPrepareEntry` | A `~>` or `<~>` binding has no matching entry in `prepare` |
| `MissingMergeEntry` | A `<~` or `<~>` binding has no matching entry in `merge` |
| `SpuriousPrepareEntry` | A `prepare` entry references a binding that has no sigil in the `prog` block |
| `SpuriousMergeEntry` | A `merge` entry references a binding that has no sigil in the `prog` block |
| `DuplicatePrepareEntry` | The same binding name appears more than once in `prepare` |
| `DuplicateMergeEntry` | The same binding name appears more than once in `merge` |
| `BidirMissingPrepareEntry` | A `<~>` binding appears in `merge` but not in `prepare` |
| `BidirMissingMergeEntry` | A `<~>` binding appears in `prepare` but not in `merge` |
| `TransitionMerge` | A `merge` block is present inside a `next { }` transition |
| `InvalidTransitionIngress` | A transition `prepare` entry has neither `from_action` nor `from_state`, or has both |
| `TransitionHook` | A `from_hook` source appears inside a transition `prepare` block |
| `TransitionOutputSigil` | A `<~` or `<~>` sigil appears in a transition `prog` block |
| `InvalidSsotPath` | A `from_state` or `to_state` value is not a valid dotted identifier path |
| `InvalidPrepareSource` | A `prepare` entry carries both `from_state` and `from_hook` |

---

## 8. Test Plan

### Domain categories

| Domain | Coverage target |
|--------|----------------|
| A. Sigil parsing | All three sigil forms (`~>`, `<~`, `<~>`) correctly identified |
| B. Correspondence | Sigil ↔ `prepare`/`merge` entry matching validated at convert time |
| C. Bidirectional lowering | `<~>` produces entries in both `prepare` and `merge` |
| D. Sentinel value | Binding default lowered as `value`/`expr`; no effect on STATE resolution |
| E. Transition `prepare` | `from_action` and `from_state` entries lower to correct `TransitionIngressBinding` fields |
| F. Error paths | All error codes trigger correctly and abort without partial output |

### Critical paths (idempotency)

| # | Path | Idempotency check |
|---|------|------------------|
| 1 | `~>` binding + `prepare` → `prepare` block with `from_state` | Re-lower same DSL source; emitted HCL is byte-identical |
| 2 | `<~` binding + `merge` → `merge` block with `to_state` | Re-lower same DSL source; emitted HCL is byte-identical |
| 3 | `<~>` binding + `prepare` + `merge` (different paths) → both sub-blocks | Both paths preserved; independent of declaration order |
| 4 | Action with no `prepare`/`merge` → no sub-blocks emitted | Pure-compute action emits clean `prog` block |
| 5 | Transition `prepare { from_action }` → `TransitionIngressBinding.fromAction` | Field mapping is deterministic for identical input |
| 6 | Transition `prepare { from_state }` → `TransitionIngressBinding.fromSsot` | Field mapping is deterministic for identical input |

### Edge cases

| Case | Expected behaviour |
|------|--------------------|
| `~>income:int = _` with no `prepare` block at all | `MissingPrepareEntry` |
| `prepare { income { from_state = ... } }` where `income` has no sigil | `SpuriousPrepareEntry` |
| `<~>income` appears in `merge` but not in `prepare` | `BidirMissingPrepareEntry` |
| `<~>income` appears in `prepare` but not in `merge` | `BidirMissingMergeEntry` |
| `merge` present inside a `next { }` block | `TransitionMerge` |
| Transition `prepare` entry with no `from_action` and no `from_state` | `InvalidTransitionIngress` |
| Transition `prepare` entry with both `from_action` and `from_state` | `InvalidTransitionIngress` |
| `from_hook` inside a transition `prepare` | `TransitionHook` |
| `<~phase` sigil inside a transition `prog` block | `TransitionOutputSigil` |
| `from_state = "applicant..income"` (empty segment) | `InvalidSsotPath` |
| `from_state = ".income"` (leading dot) | `InvalidSsotPath` |
| Same binding name twice in `prepare` | `DuplicatePrepareEntry` |
| `prepare { x { from_state = p, from_hook = "h" } }` | `InvalidPrepareSource` |
| Action with `prepare` only and no `merge` | Valid — only `~>` bindings required |
| Action with `merge` only and no `prepare` | Valid — only `<~` bindings required |

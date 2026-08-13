# Effect DSL Specification — Turn DSL

> Status: Draft for implementation
> Scope: Turn DSL syntax for STATE effect declarations (inline IO + `prepare`/`merge` sections) and their lowering to canonical HCL

---

## Overview

STATE effects can be written inline on a binding or structurally with sibling `prepare` and `merge` blocks. The two spellings lower to the same canonical model:

```turn
action "score" {
  compute {
    prog "score_graph" {
      income:number <~ @applicant.income
      income_ok:bool = income >= 50000
      decision:bool := (income_ok & debt_ok) ~> @decision.approved
    }
  }
}
```

The equivalent structural spelling is:

```turn
action "score" {
  compute {
    prog "score_graph" {
      income:number
      income_ok:bool = income >= 50000
      decision:bool := income_ok & debt_ok
    }
  }
  prepare { income { from_state = applicant.income } }
  merge { decision { to_state = decision.approved } }
}
```

A named binding may use inline or structural IO for a given direction, never both. An anonymous egress has no structural spelling because there is no author-visible name for a `merge` entry. Inline clauses point toward their destination: `<~` points from the source into the binding, and `~>` points from a named or anonymous result to STATE. Canonical binding names never contain arrows.

---

## 1. Inline IO Syntax

### 1.1 Forms

| Form | Direction | Lowered structure |
|------|-----------|-------------------|
| `name:type <~ @state.path` | STATE → binding | `prepare.from_state` |
| `name:type <~ hook("name")` | hook → binding | `prepare.from_hook` |
| `name:type = (expr) ~> @state.path` | named binding → STATE | `merge.to_state` |
| `(expr) ~> @state.path` | anonymous write-only result → STATE | generated binding + `merge.to_state` |
| `name:type <~ @input.path ~> @output.path` | STATE → binding → STATE | both `prepare` and `merge` |

Transition inputs additionally accept `action(binding)` and literals after `<~`; transition outputs are forbidden.

### 1.2 Grammar

```
prog-item     ::= binding-decl | anonymous-egress
binding-decl  ::= IDENT ':' type (ordinary-rhs | result-rhs)
ordinary-rhs  ::= input-rhs | '=' expr | '=' '(' expr ')' '~>' state-path
result-rhs    ::= ':=' (input-rhs | expr | '(' expr ')' '~>' state-path)
input-rhs     ::= ['<~' ingress-source] ['~>' state-path]
anonymous-egress ::= '(' expr ')' '~>' state-path
ingress-source ::= state-path | hook-call | action-call | literal
state-path    ::= '@' IDENT ('.' IDENT)+
```

A bare `name:type` is a structural input declaration and must be named by a matching `prepare` entry. A computed binding with no inline output may be named by `merge`. Parentheses around the complete top-level RHS are reserved for inline egress; `name:type = (expr)` without `~>` is invalid.

Anonymous egress is valid only in an action prog and is intended for values that are written to STATE but never referenced by name. Its type comes from the destination STATE field. Lowering assigns a deterministic reserved name (`__egress_1`, `__egress_2`, ...) and emits an ordinary binding and merge entry. Anonymous egress cannot be the contextual prog result or be referenced through `action(...)`.

### 1.3 Contextual prog result

The `:=` operator designates the prog's final result:

| Context | Role |
|---------|------|
| action `compute` prog | Compute root—the action's compute output |
| `next` `compute` prog | Boolean transition condition |

Each compute prog requires exactly one `:=` binding, and that binding must be last. A transition result must have type `bool`. A deterministic transition may omit compute entirely and use `next action_id` or `next { action = action_id }`.

### 1.4 Input and bidirectional declarations

Inputs have no computed RHS; their value comes from the inline source or structural `prepare` entry. STATE inputs are required at runtime. A combined `<~ source ~> destination` declaration writes the prepared value to its output destination after execution. An input cannot also use `= expr`.

`_` is only a `case` wildcard. `#it` is only the current-value placeholder inside `pipe` steps.

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

`from_state` values are dotted paths of two or more segments:

```
dotted-path ::= IDENT ('.' IDENT)+
IDENT       ::= [A-Za-z_][A-Za-z0-9_]*
```

Examples: `applicant.income`, `workflow.stage`, `session.user_id`, `session.cart.items`.

An empty segment (e.g. `foo..bar`), a path starting/ending with `.`, or a single-segment path is invalid (`InvalidStatePath`).

### 2.5 Future draft: `from_literal` at action level

Action-level literal ingress is a proposed extension. It is not part of the current action `prepare` grammar, where only `from_state` and `from_hook` are valid.

```
prepare {
  retries { from_literal = 0 }
  mode    { from_literal = "manual" }
  enabled { from_literal = true }
}
```

Proposed semantics:

- `from_literal` would assign the literal directly to the named action binding before the compute graph runs.
- It would be mutually exclusive with `from_state` and `from_hook`. Each action `prepare` entry would still define exactly one source.
- Literal values would be checked against the target binding type during conversion where the literal type is statically known.
- This extension would align action-level ingress with transition-level `from_literal`, while preserving the rule that transitions cannot use `from_hook`.

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
    prog "score_graph" {
      income:number <~ @applicant.income ~> @decision.input_income
      debt:number <~ @applicant.debt
      min_income:number = 50000
      max_debt:number   = 20000

      income_ok:bool   = income >= min_income
      debt_ok:bool     = debt <= max_debt
      decision:bool := (income_ok & debt_ok) ~> @decision.approved
    }
  }

}
```

---

## 4. Transition-Level `prepare`

### 4.1 Structure

Inside a `next { }` block, a `prepare` block declares ingress bindings for the transition's compute program. Only `from_action`, `from_state`, and `from_literal` are valid sources inside a transition `prepare`. `from_hook` is prohibited (transitions cannot invoke hooks).

```
next {
  compute {
    prog "to_approve" {
      decision:bool
      income_ok:bool
      go:bool := decision & income_ok        # := marks the transition condition (last binding)
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
| `from_state = <dotted.path>` | Post-merge STATE value after the action's merge |
| `from_literal = <value>` | A literal value (string, number, or boolean) |

Any one of these may be used per entry. They may be mixed across different entries in the same transition `prepare` block.

> Note on `from_literal` type validation: The literal value's type is inferred at runtime rather than checked against the transition binding at convert time. The runtime converts primitive and homogeneous array literals to typed runtime values. It does not perform author-visible coercion to the target binding type, so authors are responsible for ensuring the literal is compatible with the binding's declared type.

### 4.3 Transition `prog` IO

A transition input can be declared inline with `name:type <~ action(binding)`, `<~ @state.path`, or `<~ literal`, or structurally with a bare input binding and one transition `prepare` entry. `hook()` is not valid in transitions. A `~>` output clause is rejected because transitions cannot write to STATE.

## 5. Correspondence Rules

### CAN (OK)

- Inline and structural IO are equivalent after lowering.
- An action input may read from STATE or a prepare hook.
- An action output may write to a STATE path.
- A binding may be bidirectional, with different input and output STATE paths.
- Transition inputs may read from the current action, post-merge STATE, or a literal.
- Pure-compute actions may omit both `prepare` and `merge`.

### CAN'T (NG)

- The same binding direction cannot be declared both inline and structurally (`DuplicateInlineIO`).
- An inline input cannot also have a computed RHS.
- A structural input cannot omit its matching `prepare` entry.
- A structural `prepare` entry cannot name a binding that computes its own RHS.
- A `merge` entry cannot reference an unknown binding, and duplicate entries are invalid.
- A transition cannot use `hook()`, declare output with `~>`, or contain `merge`/`publish`.
- A leading arrow is retired syntax and produces `LegacySigilPosition`.

## 6. Lowering Rules (Turn DSL → Canonical HCL)

Inline IO is hoisted into structural `prepare` and `merge` entries before validation and lowering. Named declarations keep their binding name; anonymous egress receives a reserved generated name. Canonical binding names contain no arrows.

### 6.1 Action-level lowering

Turn DSL source:
```
action "score" {
  compute {
    prog "score_graph" {
      income:number <~ @applicant.income
      income_ok:bool  = income >= min_income
      min_income:number = 50000
      decision:bool := (income_ok & debt_ok) ~> @decision.approved
    }
  }
}
```

Emitted canonical HCL:
```hcl
action "score" {
  compute {
    root = "decision"
    prog "score_graph" {
      binding "income" {
        type  = "number"
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
        type  = "number"
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

### 6.2 Bidirectional lowering

A combined `income:number <~ @applicant.income ~> @decision.input_income` declaration appears in both `prepare` and `merge`:

Turn DSL:
```
income:number
prepare { income { from_state = applicant.income      } }
merge   { income { to_state   = decision.input_income } }
```

Emitted HCL:
```hcl
prepare { binding "income" { from_state = "applicant.income"      } }
merge   { binding "income" { to_state   = "decision.input_income" } }
binding "income" { type = "number" value = 0 }
```

### 6.3 Transition-level lowering

Transition inline inputs are hoisted to transition `prepare` entries, which lower to `TransitionIngressBinding` records. The transition `prog` lowers like an action prog, with no transition `merge` or `publish`.

---

## 7. Error Catalogue

| Error code | Trigger condition |
|------------|------------------|
| `MissingPrepareEntry` | A structural input binding has no matching entry in `prepare` |
| `MissingMergeEntry` | A binding internally classified as output has no matching entry in `merge` |
| `SpuriousPrepareEntry` | A `prepare` entry references a binding that computes its own value |
| `SpuriousMergeEntry` | A `merge` entry does not correspond to an output binding |
| `DuplicatePrepareEntry` | The same binding name appears more than once in `prepare` |
| `DuplicateMergeEntry` | The same binding name appears more than once in `merge` |
| `BidirMissingPrepareEntry` | A hand-built bidirectional model has output structure but no input structure |
| `BidirMissingMergeEntry` | A hand-built bidirectional model has input structure but no output structure |
| `TransitionMerge` | A `merge` or `publish` block is present inside a `next { }` transition |
| `InvalidTransitionIngress` | A transition `prepare` entry has none of `from_action`, `from_state`, or `from_literal`, or has more than one of them |
| `TransitionHook` | A `from_hook` source appears inside a transition `prepare` block |
| `TransitionOutputSigil` | A `~> @state.path` output clause appears in a transition `prog` |
| `InvalidStatePath` | A `from_state` or `to_state` value has fewer than two segments, contains an empty segment, a leading/trailing dot, or uses invalid identifier characters |
| `InvalidPrepareSource` | A `prepare` entry carries both `from_state` and `from_hook` |
| `UnresolvedPrepareBinding` | A `prepare` binding name has no matching `binding` block in the same `prog` |
| `UnresolvedMergeBinding` | A `merge` binding name has no matching `binding` block in the same `prog` |

---

## 8. Test Plan

### Domain categories

| Domain | Coverage target |
|--------|----------------|
| A. Inline IO parsing | Input (`<~`), output (`~>`), and combined inline clauses are correctly identified |
| B. Correspondence | Inline IO and `prepare`/`merge` declarations are validated at convert time |
| C. Bidirectional lowering | Combined `<~ source ~> destination` clauses produce entries in both `prepare` and `merge` |
| D. Sentinel value | Binding default lowered as `value`/`expr`; no effect on STATE resolution |
| E. Transition `prepare` | `from_action`, `from_state`, and `from_literal` entries lower to correct `TransitionIngressBinding` fields |
| F. Error paths | All error codes trigger correctly and abort without partial output |

### Critical paths (idempotency)

| # | Path | Idempotency check |
|---|------|------------------|
| 1 | Inline `<~ @state.path` input → `prepare` block with `from_state` | Re-lower same DSL source; emitted HCL is byte-identical |
| 2 | Named or anonymous inline `~> @state.path` output → `merge` block with `to_state` | Re-lower same DSL source; emitted HCL is byte-identical |
| 3 | Combined `<~ @input.path ~> @output.path` binding → both sub-blocks | Both paths preserved; independent of declaration order |
| 4 | Action with no `prepare`/`merge` → no sub-blocks emitted | Pure-compute action emits clean `prog` block |
| 5 | Transition `prepare { from_action }` → `TransitionIngressBinding.fromAction` | Field mapping is deterministic for identical input |
| 6 | Transition `prepare { from_state }` → `TransitionIngressBinding.fromState` | Field mapping is deterministic for identical input |
| 7 | Transition `prepare { from_literal }` → `TransitionIngressBinding.fromLiteral` | Field mapping is deterministic for identical input |

### Edge cases

| Case | Expected behaviour |
|------|--------------------|
| Bare input `income:number` with no matching `prepare` entry | `MissingPrepareEntry` |
| `prepare { income { from_state = ... } }` where `income` computes its own RHS | `SpuriousPrepareEntry` |
| A hand-built bidirectional model appears in `merge` but not in `prepare` | `BidirMissingPrepareEntry` |
| A hand-built bidirectional model appears in `prepare` but not in `merge` | `BidirMissingMergeEntry` |
| `merge` present inside a `next { }` block | `TransitionMerge` |
| Transition `prepare` entry with no `from_action`, `from_state`, or `from_literal` | `InvalidTransitionIngress` |
| Transition `prepare` entry with more than one of `from_action`, `from_state`, `from_literal` | `InvalidTransitionIngress` |
| `from_hook` inside a transition `prepare` | `TransitionHook` |
| `phase:str = (expr) ~> @state.phase` or `(expr) ~> @state.phase` inside a transition `prog` block | `TransitionOutputSigil` |
| `phase:str = expr ~> @state.phase` | `ParseSyntaxError` requiring the complete RHS to be parenthesized |
| `phase:str = (expr)` | `ParseSyntaxError`; top-level parentheses are reserved for egress |
| `from_state = "applicant..income"` (empty segment) | `InvalidStatePath` |
| `from_state = ".income"` (leading dot) | `InvalidStatePath` |
| Same binding name twice in `prepare` | `DuplicatePrepareEntry` |
| `prepare { x { from_state = p, from_hook = "h" } }` | `InvalidPrepareSource` |
| Action with `prepare` only and no `merge` | Valid — it may contain inputs without outputs |
| Action with `merge` only and no `prepare` | Valid — it may contain outputs without inputs |

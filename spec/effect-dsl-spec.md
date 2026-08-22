# Effect DSL Specification — Turn DSL

> Status: Draft for implementation
> Scope: Turn DSL syntax for STATE effect declarations (inline IO) and their lowering to canonical HCL

---

## Overview

STATE effects are declared inline on the binding they belong to. Inline clauses point toward their destination. `<~` points from the source into the binding, and `~>` points from a named or anonymous result to STATE.

```turn
action "score" {
  compute "score_graph" {
    income:number <~ @applicant.income
    income_ok:bool = income >= 50000
    decision:bool := (income_ok & debt_ok) ~> @decision.approved
  }
}
```

Author-written `prepare` and `merge` blocks are retired (`ParseSyntaxError`). Inline IO expresses every shape they did, namely a named computed output, a write-only result, a bidirectional binding, and a hook source. One destination per binding is the limit either spelling could express. `prepare` and `merge` survive only as the canonical HCL the converter emits and the runtime reads. §6 gives that shape. Canonical binding names never contain arrows.

Because ingress has no other spelling, a bare `name:type` with no `<~` clause and no computed RHS has no value at all. It is rejected at parse time (`MissingBindingSource`) rather than lowered to the type's zero value.

---

## 1. Inline IO Syntax

### 1.1 Forms

| Form | Direction | Lowered structure |
|------|-----------|-------------------|
| `name:type <~ @state.path` | STATE → binding | `prepare.from_state` |
| `name:type <~ hook("name")` | hook → binding | `prepare.from_hook` |
| `name:type = (expr) ~> @state.path` | named binding → STATE | `merge.to_state` |
| `(expr) ~> @state.path` | anonymous write-only result → STATE | generated binding + `merge.to_state` |
| `(expr) ~> @state.path` as the last item of a block with no `:=` | anonymous result → STATE | `__result` binding + `merge.to_state` + `compute.root` |
| `name:type <~ @input.path ~> @output.path` | STATE → binding → STATE | both `prepare` and `merge` |

Transition inputs additionally accept `action(binding)` and literals after `<~`. Transition outputs are forbidden.

### 1.2 Grammar

```
compute-item  ::= binding-decl | anonymous-egress
binding-decl  ::= IDENT ':' type (ordinary-rhs | result-rhs)
ordinary-rhs  ::= input-rhs | '=' expr | '=' '(' expr ')' '~>' state-path
result-rhs    ::= ':=' (input-rhs | expr | '(' expr ')' '~>' state-path)
input-rhs     ::= ['<~' ingress-source] ['~>' state-path]
anonymous-egress ::= '(' expr ')' '~>' state-path
ingress-source ::= state-path | hook-call | action-call | literal
state-path    ::= '@' IDENT ('.' IDENT)+
```

A bare `name:type` declares no value and is invalid (`MissingBindingSource`). Parentheses around the complete top-level RHS are reserved for inline egress. `name:type = (expr)` without `~>` is invalid.

The grammar is newline-insensitive with one exception. An inline IO clause must continue the line its binding is on, rather than open a line of its own. This holds for `<~` and `~>` alike. Both arrows also led a binding in the retired spelling, so an arrow opening a line fits two readings, this binding's clause and the next binding's sigil, which mean opposite things. The line settles it (`ParseSyntaxError`). For `~>` the anchor is where the value ends, which matters when the right-hand side spans lines. See §3.1.

Anonymous egress is valid only in an action `compute` block and is intended for values that are written to STATE but never referenced by name. Its type comes from the destination STATE field. Lowering assigns a deterministic reserved name (`__egress_1`, `__egress_2`, ...) and emits an ordinary binding and merge entry. Anonymous egress cannot be referenced through `action(...)`. It may be the contextual compute result, but only as the last item of a block that has no `:=` at all. See §1.3.

### 1.3 Contextual compute result

The `:=` operator designates the compute block's final result:

| Context | Role |
|---------|------|
| action `compute` block | Compute root—the action's compute output |
| `next` `compute` block | Boolean transition condition |

Each `compute` block designates exactly one result, and it must be the last item. A transition result must have type `bool`. A deterministic transition may omit compute entirely and use `next action_id` or `next { action = action_id }`. A transition guarded by a single `bool` binding of the enclosing action's `compute` block may be written `next condition -> action_id`. See `scene-graph.md §3`.

An action `compute` block whose result is written to STATE and never read back may omit `:=` and end in an anonymous egress instead. The last item is then the result:

```turn
(true) ~> @triage.paged                     # what the author writes
__result:bool := (true) ~> @triage.paged    # exactly what it means
```

The promoted item is an ordinary result binding named `__result`, typed from its destination STATE field, and it appears under that name in the emitted binding, merge entry, and `compute.root`. The shorthand applies only when the block carries no `:=` anywhere. With one present, the ordinary "result must be last" rule stands and a trailing anonymous egress is `MarkerNotLast`, not a second result. A transition `compute` block always requires its `:=`, because a transition cannot write to STATE and so has no trailing egress to promote.

Use the named form when the result is read by name: another binding in the same block, a transition's `<~ action(binding)`, a `next <condition> -> <action>` guard, or a `next on <subjects> to` subject. The name is also the only way to give the result a named literal/template type, which a destination STATE field cannot supply.

### 1.4 Input and bidirectional declarations

Inputs have no computed RHS. Their value comes from the inline source. STATE inputs are required at runtime. A combined `<~ source ~> destination` declaration writes the prepared value to its output destination after execution. An input cannot also use `= expr`.

`_` is only a `case` wildcard. `#it` is only the current-value placeholder inside `pipe` steps.

## 2. Action-Level Ingress

### 2.1 Sources

An action binding reads from STATE or from a hook:

```
name:type <~ @<namespace>.<field>
name:type <~ hook("<hookName>")
```

- Every input declares its source on the binding. There is no block form.
- A pure-compute action declares no ingress at all.
- A binding has exactly one source: a second `<~` on the same binding does not parse.

### 2.2 `<~ @path` — reads from STATE

Reads a value from STATE before the compute graph runs and assigns it to the binding. Lowers to `prepare.from_state`.

### 2.3 `<~ hook(...)` — reads from a hook result

Invokes the named hook, obtains a result object, and assigns `result[bindingName]` to `state[bindingName]`. Lowers to `prepare.from_hook`. See `hook-spec.md` for full semantics.

A literal ingress (`<~ 300`) is not valid at action level. A constant is an ordinary binding, `name:type = 300`.

### 2.4 STATE path format

State paths are dotted paths of two or more segments:

```
dotted-path ::= IDENT ('.' IDENT)+
IDENT       ::= [A-Za-z_][A-Za-z0-9_]*
```

Examples include `applicant.income`, `workflow.stage`, `session.user_id`, and `session.cart.items`.

An empty segment (e.g. `foo..bar`), a path starting/ending with `.`, or a single-segment path is invalid (`InvalidStatePath`).

### 2.5 Why there is no action-level literal ingress

A constant at action level is already a binding in the compute block:

```
ceiling:number = 300
```

`from_literal` exists at transition level because a next compute is a separate program whose inputs arrive only through ingress. At action level it would buy nothing, so `<~ <literal>` is rejected there.

---

## 3. Action-Level Egress

### 3.1 Forms

```
name:type = (expr) ~> @<namespace>.<field>     # named computed output
name:type := (expr) ~> @<namespace>.<field>    # the compute result, also written out
name:type <~ @<in.path> ~> @<out.path>         # bidirectional
(expr) ~> @<namespace>.<field>                 # write-only, no author-visible name
(expr) ~> @<namespace>.<field>                 # ...and the compute result, when last in a block with no :=
```

- Egress belongs to the binding that produces the value, and a pure-compute action declares none.
- One destination per binding. Two `~>` clauses on one binding do not parse, and the lowered model rejects two entries for one binding.
- The `~>` clause must be on the same line as the end of the value it writes from (§1.2). A right-hand side may span lines, and the clause follows its closing line. What it may not do is open a line of its own.

The rule is `STATE[path] = state[binding]`.

### 3.2 Complete action-level example

```
action "score" {
  compute "score_graph" {
    income:number <~ @applicant.income ~> @decision.input_income
    debt:number <~ @applicant.debt
    min_income:number = 50000
    max_debt:number   = 20000

    income_ok:bool   = income >= min_income
    debt_ok:bool     = debt <= max_debt
    decision:bool := (income_ok & debt_ok) ~> @decision.approved
  }

}
```

---

## 4. Transition-Level Ingress

### 4.1 Structure

Inside a `next { }` block, the transition's compute program declares its inputs inline, on the binding:

```
next {
  compute "to_approve" {
    decision:bool  <~ action(decision)
    income_ok:bool <~ action(income_ok)
    go:bool := decision & income_ok        # := marks the transition condition (last binding)
  }
  action = approve
}
```

### 4.2 Ingress sources

A transition input has exactly one of:

| Clause | Source |
|--------|--------|
| `<~ action(<binding>)` | Value of the named binding from the action's result |
| `<~ @<dotted.path>` | Post-merge STATE value after the action's merge |
| `<~ <literal>` | A literal value (string, number, or boolean) |

They may be mixed across the bindings of one transition compute block. `hook()` is rejected here (`TransitionHook`), because hooks are effectful and consumer-supplied, so making them branch-dependent would take control flow out of STATE.

> Note on literal type validation: The literal value's type is inferred at runtime rather than checked against the transition binding at convert time. The runtime converts primitive and homogeneous array literals to typed runtime values. It does not perform author-visible coercion to the target binding type, so authors are responsible for ensuring the literal is compatible with the binding's declared type.

### 4.3 Transition `compute` egress

A `~>` output clause is rejected because transitions cannot write to STATE (`TransitionOutputSigil`).

## 5. Correspondence Rules

### CAN (OK)

- An action input may read from STATE or a prepare hook.
- An action output may write to a STATE path.
- A binding may be bidirectional, with different input and output STATE paths.
- Transition inputs may read from the current action, post-merge STATE, or a literal.
- Pure-compute actions declare no IO at all.

### CAN'T (NG)

- A binding cannot omit its source: no `<~` clause and no computed RHS is `MissingBindingSource`.
- An inline input cannot also have a computed RHS.
- A binding cannot declare two ingress or two egress clauses.
- A transition cannot use `hook()` or declare output with `~>`, and cannot contain a `publish` block (`TransitionPublish`).
- `prepare` and `merge` blocks are retired syntax and produce `ParseSyntaxError`.
- A leading arrow is retired syntax and produces `ParseSyntaxError`.

## 6. Lowering Rules (Turn DSL → Canonical HCL)

Inline IO is hoisted into `prepare` and `merge` entries before validation and lowering. These blocks exist only from this point on. They are the wire shape the runtime reads, not something an author writes. Every entry is generated from one binding. Named declarations keep their binding name, anonymous egress receives a reserved generated name, and canonical binding names contain no arrows.

### 6.1 Action-level lowering

Turn DSL source:
```
action "score" {
  compute "score_graph" {
    income:number <~ @applicant.income
    income_ok:bool  = income >= min_income
    min_income:number = 50000
    decision:bool := (income_ok & debt_ok) ~> @decision.approved
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

A combined declaration appears in both `prepare` and `merge`:

Turn DSL:
```
income:number <~ @applicant.income ~> @decision.input_income
```

Emitted HCL:
```hcl
prepare { binding "income" { from_state = "applicant.income"      } }
merge   { binding "income" { to_state   = "decision.input_income" } }
binding "income" { type = "number" value = 0 }
```

### 6.3 Transition-level lowering

Transition inline inputs are hoisted to transition `prepare` entries, which lower to `TransitionIngressBinding` records. The transition `compute` block lowers like an action `compute` block, with no transition `merge` or `publish`.

---

## 7. Error Catalogue

| Error code | Trigger condition |
|------------|------------------|
| `MissingBindingSource` | A binding declares neither a `<~` source nor a computed RHS |
| `ParseSyntaxError` | Retired syntax appears in the source: a `prepare` or `merge` block in an action or a `next { }` transition, or an arrow before the binding name |
| `TransitionPublish` | A `publish` block is present inside a `next { }` transition |
| `TransitionHook` | `<~ hook(...)` appears inside a transition `compute` block |
| `TransitionOutputSigil` | A `~> @state.path` output clause appears in a transition `compute` block |
| `InvalidStatePath` | A state path has fewer than two segments, contains an empty segment, a leading/trailing dot, or uses invalid identifier characters |
| `InvalidTransitionIngress` | A transition ingress entry in the model has none of `from_action`, `from_state`, or `from_literal`, or has more than one — reachable only for a model this converter did not produce |

---

## 8. Test Plan

### Domain categories

| Domain | Coverage target |
|--------|----------------|
| A. Inline IO parsing | Input (`<~`), output (`~>`), and combined inline clauses are correctly identified |
| B. Hoisting | Each inline clause produces exactly one `prepare` or `merge` entry, named for its binding |
| C. Bidirectional lowering | Combined `<~ source ~> destination` clauses produce entries in both `prepare` and `merge` |
| D. Sentinel value | Binding default lowered as `value`/`expr`; no effect on STATE resolution |
| E. Transition ingress | `action(...)`, `@path`, and literal clauses lower to correct `TransitionIngressBinding` fields |
| F. Error paths | All error codes trigger correctly and abort without partial output |

### Critical paths (idempotency)

| # | Path | Idempotency check |
|---|------|------------------|
| 1 | Inline `<~ @state.path` input → `prepare` entry with `from_state` | Re-lower same DSL source; emitted HCL is byte-identical |
| 2 | Named or anonymous inline `~> @state.path` output → `merge` entry with `to_state` | Re-lower same DSL source; emitted HCL is byte-identical |
| 3 | Combined `<~ @input.path ~> @output.path` binding → both sub-blocks | Both paths preserved; independent of declaration order |
| 4 | Action with no inline IO → no sub-blocks emitted | Pure-compute action emits clean `prog` block |
| 5 | `<~ action(binding)` → `TransitionIngressBinding.fromAction` | Field mapping is deterministic for identical input |
| 6 | `<~ @state.path` in a transition → `TransitionIngressBinding.fromState` | Field mapping is deterministic for identical input |
| 7 | `<~ <literal>` in a transition → `TransitionIngressBinding.fromLiteral` | Field mapping is deterministic for identical input |

### Edge cases

| Case | Expected behaviour |
|------|--------------------|
| Bare `income:number` with no `<~` clause and no RHS | `MissingBindingSource` |
| `income:number :=` with nothing after the marker | `MissingBindingSource` |
| `prepare { ... }` or `merge { ... }` in an action | `ParseSyntaxError`; the block is skipped whole |
| `prepare { ... }` or `merge { ... }` inside a `next { }` block | `ParseSyntaxError` |
| `publish { ... }` inside a `next { }` block | `TransitionPublish` |
| `<~ hook("h")` inside a transition `compute` block | `TransitionHook` |
| `phase:str = (expr) ~> @state.phase` or `(expr) ~> @state.phase` inside a transition `compute` block | `TransitionOutputSigil` |
| `phase:str = expr ~> @state.phase` | `ParseSyntaxError` requiring the complete RHS to be parenthesized |
| `phase:str = (expr)` | `ParseSyntaxError`; top-level parentheses are reserved for egress |
| `~> @state.phase` opening its own line, below the binding it writes from | `ParseSyntaxError`; the clause continues the line its value ends on |
| `~> @state.phase` following a multi-line RHS, on the line that closes it | Valid; the anchor is where the value ends, not where the binding starts |
| `<~ @state.phase` opening its own line, below the binding it feeds | `ParseSyntaxError`; the clause continues its binding's line |
| `~> @nodot` (single segment) | `InvalidStatePath` |
| `<~ 300` at action level | `ParseSyntaxError`; write `name:number = 300` |
| Action with ingress only | Valid — it may read without writing |
| Action with egress only | Valid — it may write without reading |

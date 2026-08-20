# Scene Graph Specification (Action-Embedded Computation Graph) v0.3

> Status: Proposed spec for implementation
> Scope: Scene orchestration + action-local computation graph definition

## 1. Purpose

This spec defines a scene model where each action embeds its own computation graph.
The computation graph syntax is the HCL ContextSpec DSL (`hcl-context/v1`, implicit in this version) and is executed through the existing builder/runtime pipeline (`ctx` -> `validateContext` -> `executeGraph`).

Primary goals:

1. A scene must be able to define actions declaratively.
2. Each action must be able to declare its computation graph inline.
3. IO values and merge deltas must be explicit and deterministic.
4. Next-action behavior must remain deterministic: rules are evaluated in declaration order and the first true one is selected.

## 2. Conventions

### 2.1 Normative keywords
The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are to be interpreted as described in RFC 2119.

### 2.2 Identifiers

- `SceneId`, `ActionId`, and HCL binding names use `IDENT = [A-Za-z_][A-Za-z0-9_]*`.
- Matching is case-sensitive.

### 2.3 Reference normalization

For reference-style DSL attributes, implementations MUST normalize HCL syntax to canonical runtime strings before validation/execution.

- Bare reference form and quoted string form are both allowed and MUST be treated equivalently:
  - Example: `action = approve` and `action = "approve"` normalize to the same runtime string.
- Reference-style attributes include:
  - `scene.entry_action`
  - `action.compute.root`
  - `next.compute.condition`
  - `next.action`
- The STATE paths carried by `action.prepare.<binding>.from_state`, `action.merge.<binding>.to_state`, and the transition ingress fields are written in source as `@ns.field`. They reach the model already normalized, since `@` paths are lexed as identifiers.
- Literal-style attributes (for example `from_literal`) MUST preserve literal values and are not reference-normalized.

## 3. Balance Rules (CAN / CAN'T)

CAN (OK):

- A scene can contain multiple actions.
- An action can embed one HCL ContextSpec program.
- An action can declare STATE inputs with `<~` and STATE outputs with `~>`, inline in its `compute` block. These lower to the model's `prepare` and `merge` entries.
- An action can define next actions using per-next `compute` blocks.
- A transition input can source any value binding defined by the current action `compute` block via `<~ action(binding)`.
- An action can declare one or more publish hooks under `publish`.
- An action can include optional narrative text (`text`) as a string.

CAN'T (NG):

- An action `compute` block cannot omit its `:=` result binding (it derives `compute.root`) unless its last item is an anonymous egress, which is then the result: `(true) ~> @triage.paged` as the last line means `__result:bool := (true) ~> @triage.paged`, and `compute.root` is `__result`. A compute block cannot carry more than one result, and the result binding must be last — with a `:=` present, a trailing anonymous egress is `MarkerNotLast` rather than a second result.
- A binding cannot omit its source: no `<~` clause and no computed RHS is `MissingBindingSource`. Author-written `prepare` and `merge` blocks are retired (`ParseSyntaxError`).
- A next rule that includes a `compute` block cannot omit its `:=` condition result (it derives `compute.condition`) or its label. A next rule MAY omit the `compute` block entirely when the transition is deterministic (unconditional). The form `next { action = ... }` is shorthand for an always-true condition, equivalent to `compute "..." { c:bool := true }`. The two forms lower to an identical model, and the canonical form is the concise compute-less one. A trivially-true condition is normalized away during conversion.
- A conditional transition MAY be written as `next <condition> -> <action>`, where `<condition>` names a `bool` binding of the enclosing action's own `compute` block. It is exactly equivalent to a next rule whose `compute` block ingresses that binding with `<~ action(binding)` and returns it as the `:=` condition. The guard is written first so the line reads in evaluation order. A condition that is not a single bare binding — a comparison, a negation, or a value from anywhere but this action's `compute` block — cannot use this form and keeps the block form.
- A run of transitions that all branch on the same values MAY be written as one `next on <subjects> to { ... }` block. `<subjects>` is a bare binding name or a parenthesized list of them, each naming a value binding of the enclosing action's own `compute` block. Each arm is `<pattern> -> <action>`, where `<pattern>` is `_`, a literal, or a parenthesized list of literals and `_` whose length equals the subject count. A single subject may be written without parentheses on either side. Every arm expands to exactly the next rule it abbreviates, in arm order: an arm with at least one literal becomes a rule whose `compute` ingresses only the subjects that arm constrains, each with `<~ action(binding)`, and returns their conjoined equality test as the `:=` condition; the `_` arm becomes an unconditional rule. Arms accept only literals and `_` — a variable binder has nothing to bind to, since an arm selects an action rather than evaluating an expression, and guards, template patterns, and nested tuples keep the block form. Each subject's type is inferred from the literals written in its column; a column whose literals disagree is an error (`ArgTypeMismatch`), as is an arm whose width differs from the subject list (`NextMatchArity`).
- A match block MUST contain exactly one unconditional arm — a bare `_`, or a tuple whose elements are all `_` — and it MUST be the last arm. A block with none is an error (`NonExhaustiveMatch`), because falling through every arm schedules no transition at all and silently ends the scene; a second one is `DuplicateFallback`, and any arm after it is `UnreachableArm`.
- Next actions cannot reference missing actions.

Correlation:

- Because the root accepts both value and function bindings, a root with an inline `~> @state.path` output is always available as a deterministic emission source.
- Because an action and each of its next rules carry separate `compute` blocks, output mapping and branching logic are explicitly separated.
- Because next-rule inputs are ingress-driven, action `compute` values are usable in a next rule's `compute` only through an explicit `<~ action(binding)` clause.

## 4. Runtime Data Model

```ts
type Scene = {
  sceneId: string;
  actions: Action[];
  entryActionId: ActionId;
  view?: OverviewView;
};

type Action = {
  actionId: ActionId;
  text?: string; // optional action-local narrative text
  compute: ActionComputeGraph;
  prepare?: PrepareSpec;
  merge?: MergeSpec;
  publish?: PublishSpec;
  next?: NextRule[]; // default: []
  // Merge mode is always "replace-by-id"; not author-configurable.
};

type ActionComputeGraph = {
  prog: string; // canonical `prog "<name>" { ... }` block lowered from the compute body
  root: string; // canonical binding key from DSL `compute.root`; resolves to a value or function binding
};

type PrepareSpec = {
  bindings: Record<string, PrepareBinding>; // key is binding name declared in compute.prog
};

type PrepareBinding = {
  fromState?: string;    // canonical dotted STATE source path
  fromHook?: string;    // hook name; hook returns object whose field matches binding name
  required?: boolean;   // default true for fromState
};

type MergeSpec = {
  bindings: Record<string, MergeBinding>; // key is binding name declared in compute.prog
};

type MergeBinding = {
  toState?: string; // canonical destination key in STATE; default is binding key
};

type PublishSpec = {
  hooks: string[]; // hook names, invoked in declaration order after merge
};

type NextRule = {
  compute: NextComputeGraph;
  prepare?: NextPrepareSpec;
  action: ActionId; // canonical next action id from DSL `next.action`
};

type NextPrepareSpec = {
  bindings: Record<string, NextPrepareBinding>; // key is binding name in next compute.prog
};

type NextPrepareBinding = {
  fromAction?: string;  // source binding from current action compute.prog result
  fromState?: string;    // post-merge STATE path S_{n+1}
  fromLiteral?: unknown;
  required?: boolean;
};

type NextComputeGraph = {
  prog: string; // canonical `prog "<name>" { ... }` block lowered from the compute body
  condition: string; // canonical bool binding key from DSL `next.compute.condition`
};

type OverviewView = {
  flow: string;
  enforce: "nodes_only" | "at_least" | "strict";
};
```

Source and destination rules:

- An action-level input is declared inline with `name:type <~ source`. Its source is STATE or a hook.
- An action-level output is declared inline with `name:type = (expr) ~> @state.path`, or anonymously as `(expr) ~> @state.path`. Its destination is a STATE path.
- A transition input is declared inline with `name:type <~ source`. Its source is an action binding, post-merge STATE, or a literal.
- `fromAction` is only valid for transition ingress.
- `fromHook` is only valid for action-level ingress (not transition-level).
- `fromLiteral` is only valid for transition ingress. At action level a constant is an ordinary binding, `name:type = <literal>`.
- Publish hooks in `publish.hooks` fire after merge in declaration order and receive the complete final state.

Action-to-next binding scope:

- For one action invocation, a transition's `fromAction` ingress MUST resolve against that action's `compute.prog` binding namespace.
- Implementations MAY resolve these bindings lazily, but observable behavior MUST match eager availability of all value bindings declared in action `compute.prog`.

## 5. HCL Scene DSL

This spec standardizes the following scene-level HCL shape:

Reference-style fields below use the canonical bare form. Quoted references are accepted only as a temporary compatibility aid and should not be authored in new files.
Within a `compute` block, parse-safe infix shorthand (for example `income_ok:bool = income >= min_income`, `go:bool = decision & income_ok`) follows HCL ContextSpec lowering rules.
IO direction is declared by inline clauses that point toward their destination:

- `name:type <~ @state.path` declares an input.
- `name:type = (expr) ~> @state.path` declares a named output; `(expr) ~> @state.path` declares a write-only anonymous output whose type is inferred from STATE.
- `name:type <~ @input.path ~> @output.path` declares bidirectional IO.
- A bare `name:type` declares no value and is rejected (`MissingBindingSource`).

Rule, result binding declared last: The compute root is designated by `:=` on its binding; the same operator designates a transition condition in a next compute. The result binding MUST be the last binding declared in the `compute` block. An action `compute` block with no `:=` at all designates its last binding instead, and only when that binding is an anonymous egress: `(true) ~> @triage.paged` written last is the result, named `__result`. Bindings are order-independent at runtime, but placing the result last makes the data-flow direction immediately readable. Inputs and intermediate values come first, and the final output that drives the action result appears at the bottom (read like a `return`). The lowered model still exposes `compute.root` / `compute.condition` as string fields, derived from the result binding.

```hcl
scene "loan_flow" {
  entry_action      = score

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

    publish {
      hook = "score_audit"
    }

    next {
      compute "to_approve" {
        decision:bool <~ action(decision)
        income_ok:bool <~ action(income_ok)
        go:bool := decision & income_ok
      }
      action = approve
    }
    next {
      compute "to_reject" {
        always:bool := true
      }
      action = reject
    }
  }
}
```

### 5.0.1 Transition Match Blocks

When several transitions branch on the same values, the run may be written as one match block. This is surface syntax only: it expands into the next rules below it, so the two spell the same model.

```hcl
// one rule per arm, evaluated in arm order
next on (band, vip) to {
  ("heavy", false) -> archive,
  ("heavy", true)  -> expedite_archive,
  (_, true)        -> expedite_archive,
  _ -> archive
}

// what the first arm abbreviates
next {
  compute "..." {
    band:str <~ action(band)
    vip:bool <~ action(vip)
    go:bool := band == "heavy" & vip == false
  }
  action = archive
}
```

A `_` column is not ingressed, so the third arm's rule reads only `vip`. The `_` arm abbreviates the bare `next archive`.

Reach for this form when the decision is over values. A decision that is already one `bool` per branch stays clearer as a run of `next <flag> -> <action>` lines.

### 5.1 Action Docstring Sugar (`"""..."""`)

For authoring convenience, an action MAY contain one Python-style triple-quoted text block at action-block top level:

```hcl
action "forest_trail" {
  """
  You take the forest trail.
  """

  compute {
    # ...
  }
}
```

This surface syntax MUST be lowered to canonical action text in plain HCL:

```hcl
action "forest_trail" {
  text = <<-EOT
    You take the forest trail.
  EOT

  compute {
    # ...
  }
}
```

Lowering and validation rules:

1. The triple-quoted text block MAY appear at most once per action.
2. The lowered value MUST be assigned to `action.text` as a string.
3. If both a triple-quoted block and explicit `text = ...` appear in one action, validation MUST fail (`ActionTextDuplicate`).
4. A single newline immediately after opening `"""` and immediately before closing `"""` MUST be trimmed during lowering. All other content MUST be preserved verbatim.

## 6. Validation Rules

Before first action execution, implementations MUST validate:

1. `actions` is non-empty.
2. `entryActionId` is non-empty and the action it names exists.
3. Every `actionId` is unique.
4. All next actions exist.
5. `compute` language is implicit and MUST be treated as `hcl-context/v1`.
6. For each action, `compute.prog` parses under HCL ContextSpec v1.
7. `compute.root` exists in the program (value or function binding).
8. Every `prepare` and `merge` binding key exists and resolves to a value binding in `compute.prog`. Conversion satisfies this by construction: each entry is generated from the binding that carries the inline clause.
9. Every input binding has exactly one ingress source.
10. Every named output binding has exactly one STATE destination; every anonymous egress declares its destination inline and lowers to one generated output binding.
11. For each next rule, `compute.prog` parses under HCL ContextSpec v1.
12. For each next rule, `compute.condition` exists and resolves to a `bool` binding (value or function output).
13. For each next rule, every transition ingress binding key exists and resolves to a value binding in that next-rule `compute.prog`.
14. For each next binding with `fromAction`, the source binding exists in the current action `compute.prog` binding namespace.
15. If an `overview` block exists, overview parsing, compilation, and enforcement succeed for the selected mode.
16. For action docstring sugar, each action has at most one triple-quoted text block and no conflict with explicit `text`.

Validation failures MUST produce `invalid_graph` except overview failures, which MUST produce `invalid_overview`.

## 7. Action Execution Semantics

For one action invocation with pre-state `S_n`:

1. Snapshot: capture immutable STATE snapshot `S_n`.
2. Load graph template: parse/compile `compute.prog` if not cached.
3. Prepare phase:
   - For each `prepare.<binding>` with `fromState`, resolve value from `S_n`.
   - For each `prepare.<binding>` with `fromHook`, invoke the named hook (deduplicating calls for the same hook name), then map returned object fields into state bindings.
   - If a required source is missing, fail action without executing the graph.
4. Build runtime graph:
   - Lower HCL program to ContextSpec.
   - Apply prepare-derived state overrides.
   - Build with `ctx(spec)`.
   - Validate with `validateContext`.
5. Execute root:
   - `rootBinding = ids[compute.root]`
   - If `compute.root` resolves to a function binding: `R_n = executeGraph(rootBinding as FuncId, validatedContext)`
   - If `compute.root` resolves to a value binding: `R_n = readValue(rootBinding as ValueId, validatedContext)` (identical to how `compute.condition` handles value bindings)
   - Build action binding namespace `A_n` from this invocation's `compute.prog` context.
6. Merge phase: build action delta `D_n` from `merge` bindings:
   - For each `merge.<binding>`, read binding value from graph context/output table.
   - Destination key is `toState` if provided, otherwise binding name.
   - Merge `D_n` atomically into STATE using `replace-by-id` mode → produces `S_{n+1}`.
7. Publish phase:
   - For each `hook` in `publish.hooks` (declaration order), invoke the hook passing the complete final state.
   - Publish hooks are read-only. Return values are ignored.
8. Evaluate next rules in declaration order:
   - Build/validate each next-rule `compute` graph.
   - Resolve transition `prepare` bindings from action namespace `A_n` (`fromAction`), post-merge state `S_{n+1}` (`fromState`), and literals.
   - Resolve `compute.condition` to a boolean value:
     - If `compute.condition` is a function binding, execute it.
     - If `compute.condition` is a value binding, read it directly.
   - Treat resolved boolean as the rule result.
9. Select next action IDs based on effective policy and enqueue.

Failure semantics:

- If any step before merge fails, merge MUST NOT occur.
- No partial STATE mutation is allowed.

## 8. Next Semantics

- Selection is first-match and is not configurable: rules are evaluated in declaration order and the first true rule is selected. At most one next action is scheduled per action run.
- Each rule's `compute` graph is evaluated independently and must resolve `compute.condition` to boolean.
- `fromAction` in transition `prepare` reads from the current action `compute.prog` binding namespace (`A_n`).
- No matches: action run terminates with no next action scheduled.
- A `next on <subjects> to { }` block expands to one rule per arm in arm order, which is what makes its arms mutually exclusive: the `_` arm is reached only when no arm above it matched.

## 9. Overview DSL Enforcement

Overview DSL behavior is unchanged from `draft-spec/scene-graph.md`:

- `nodes_only`: `overview.nodes ⊆ impl_nodes`
- `at_least`: `overview.nodes ⊆ impl_nodes` and `overview.data_edges ⊆ impl_data_edges`
- `strict`: exact equality for nodes and data edges. Control edge handling remains mode-dependent

Runtime mapping:

- `impl_nodes = { action.actionId }`
- `impl_data_edges = { (actionId, nextActionId) | nextActionId in action.next }`

## 10. Diagnostics (Minimum Set)

Existing required codes from v0.2 remain required, plus the following:

- `InvalidActionGraph`
- `ActionRootNotFound`
- `IngressTargetNotValue`
- `IngressSourceMissing`
- `EgressSourceInvalid`
- `EgressSourceUnavailable`
- `NextComputeInvalid`
- `NextComputeNotBool`
- `NextIngressSourceInvalid`
- `ActionTextDuplicate`
- `NextMatchArity`

Recommended diagnostic payload:

```ts
type SceneDiagnostic = {
  code: string;
  severity: "error" | "warning";
  stage:
    | "scene_validation"
    | "action_validate"
    | "action_execute"
    | "next_resolve"
    | "overview_parse"
    | "overview_compile"
    | "overview_enforce";
  actionId?: ActionId;
  binding?: string;
  message: string;
  details?: Record<string, unknown>;
};
```

## 11. Conformance Checklist

1. `compute.root` is derived from the `:=` result binding, or from a trailing anonymous egress promoted in its place, so it always names an existing binding. An action `compute` block with neither fails validation (`MissingRootMarker`). A root that names a value binding is valid and reads the value directly.
2. Missing STATE ingress path with required ingress fails action without merge.
3. A root binding with an inline `~>` output writes exactly the executed root result.
4. Next-rule `compute.prog` parse/validation failures stop scheduling and emit next diagnostics.
5. `next.compute.condition` must resolve to `bool`, else validation fails.
6. First-match selection is deterministic: the same rules and inputs always select the same next action.
7. Overview enforcement modes behave as defined.
8. Re-running with same prepare inputs and snapshot yields identical `result`, `delta`, and selected next actions.
9. Reference-style DSL fields produce identical runtime strings for quoted vs bare forms.
10. A transition `<~ action(binding)` ingress can consume a non-root value binding from action `compute.prog` and make it available in `next.compute`.
11. Triple-quoted action text and explicit `text` assignment produce identical runtime `action.text`.
12. Publish hooks fire after merge in declaration order and receive the complete final state.

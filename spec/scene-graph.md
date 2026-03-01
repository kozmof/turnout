# Scene Graph Specification (Action-Embedded Computation Graph) v0.3

> Status: Proposed spec for implementation
> Scope: Scene orchestration + action-local computation graph definition

## 1. Purpose

This spec defines a scene model where each action embeds its own computation graph.
The computation graph syntax is the HCL ContextSpec DSL (`hcl-context/v1`, implicit in this version) and is executed through the existing builder/runtime pipeline (`ctx` -> `validateContext` -> `executeGraph`).

Primary goals:

1. A scene must be able to define actions declaratively.
2. Each action must be able to declare its computation graph inline.
3. Ingress values and egress deltas must be explicit and deterministic.
4. Next-action behavior must remain deterministic (`first-match` or `all-match`).

## 2. Conventions

### 2.1 Normative keywords
The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are to be interpreted as described in RFC 2119.

### 2.2 Identifiers

- `SceneId`, `ActionId`, and HCL binding names use `IDENT = [A-Za-z_][A-Za-z0-9_]*`.
- Matching is case-sensitive.

### 2.3 Reference normalization

For reference-style DSL attributes, implementations MUST normalize HCL syntax to canonical runtime strings before validation/execution.

- Bare reference form and quoted string form are both allowed and MUST be treated equivalently:
  - Example: `to = decision.reason` and `to = "decision.reason"` normalize to the same runtime string.
- Reference-style attributes include:
  - `action.compute.root`
  - `next.compute.condition`
  - `ingress.to`, `ingress.from_ssot`
  - `egress.to`, `egress.from`
  - `next.action`
  - `next.ingress.to`, `next.ingress.from_action`, `next.ingress.from_ssot`
- Literal-style attributes (for example `from_literal`) MUST preserve literal values and are not reference-normalized.

## 3. Balance Rules (CAN / CAN'T)

CAN (OK):

- A scene can contain multiple actions.
- An action can embed one HCL ContextSpec program.
- An action can bind runtime ingresses from SSOT paths or literals.
- An action can define multiple egresses to merge into SSOT.
- An action can define next actions using per-next `compute` `prog` blocks.
- A next ingress can source any value binding defined by the current action `compute.prog` via `from_action`.
- An action can include optional narrative text (`text`) as a string.

CAN'T (NG):

- An action cannot omit `compute.root`.
- `compute.root` cannot point to a value binding; it must resolve to a function binding.
- An `ingress` target cannot reference an undefined binding.
- An `egress` source cannot reference an undefined binding.
- A next rule cannot omit `compute.condition` or `compute.prog`.
- Next actions cannot reference missing actions.

Correlation:

- Because `root` is function-only, `from = <root_binding>` is always available as a deterministic emission source.
- Because action `compute` and next-rule `compute` use separate `prog` blocks, output mapping and branching logic are explicitly separated.
- Because next-rule inputs are ingress-driven, action `compute.prog` values are usable in `next.compute` only through explicit `next.ingress.from_action` mapping.

## 4. Runtime Data Model

```ts
type Scene = {
  sceneId: string;
  actions: Action[];
  entryActionIds: ActionId[];
  nextPolicy?: "first-match" | "all-match"; // default: first-match
  view?: OverviewView;
};

type Action = {
  actionId: ActionId;
  text?: string; // optional action-local narrative text
  compute: ActionComputeGraph;
  ingresses?: ActionIngressBinding[];
  egresses?: ActionEgressBinding[];
  next?: NextRule[]; // default: []
  nextPolicy?: "first-match" | "all-match";
  resultMerge?: {
    mode?: "replace-by-id"; // default: replace-by-id
  };
};

type ActionComputeGraph = {
  prog: string; // canonical source of one inline `prog "<name>" { ... }` block
  root: string; // canonical binding key from DSL `compute.root`; must resolve to function binding
};

type ActionIngressBinding = {
  to: string; // canonical target value binding from DSL `ingress.to`
  fromSsot?: string; // canonical dotted path from DSL `ingress.from_ssot`
  fromLiteral?: unknown;
  required?: boolean; // default true (only for fromSsot)
};

type ActionEgressBinding = {
  to: string; // canonical destination key from DSL `egress.to` (merged to SSOT)
  from?: string; // canonical binding key from DSL `egress.from` (including root binding)
  fromLiteral?: unknown;
};

type NextRule = {
  compute: NextComputeGraph;
  ingresses?: NextIngressBinding[];
  action: ActionId; // canonical next action id from DSL `next.action`
};

type NextComputeGraph = {
  prog: string; // canonical source of one inline `prog "<name>" { ... }` block
  condition: string; // canonical bool binding key from DSL `next.compute.condition`
};

type NextIngressBinding = {
  to: string; // canonical target value binding from DSL `next.ingress.to`
  fromAction?: string; // canonical source binding from current action `compute.prog` via DSL `next.ingress.from_action`
  fromSsot?: string; // canonical dotted path from DSL `next.ingress.from_ssot` (S_{n+1})
  fromLiteral?: unknown;
  required?: boolean; // default true (for fromAction/fromSsot)
};

type OverviewView = {
  text: string;
  enforce: "nodes_only" | "at_least" | "strict";
};
```

Source exclusivity rules:

- `ActionIngressBinding`: exactly one of `fromSsot` or `fromLiteral` MUST be set.
- `ActionEgressBinding`: exactly one of `from` or `fromLiteral` MUST be set.
- `NextIngressBinding`: exactly one of `fromAction`, `fromSsot`, or `fromLiteral` MUST be set.

Action-to-next binding scope:

- For one action invocation, `next.ingress.from_action` MUST resolve against that action's `compute.prog` binding namespace.
- Implementations MAY resolve these bindings lazily, but observable behavior MUST match eager availability of all value bindings declared in action `compute.prog`.

## 5. HCL Scene DSL

This spec standardizes the following scene-level HCL shape:

Reference-style fields below are shown in bare form; per Section 2.3, quoted and bare forms normalize identically.
Within `compute.prog`, parse-safe infix shorthand (for example `income_ok:bool =| income >= min_income`, `go:bool =| decision & income_ok`) follows HCL ContextSpec lowering rules.

```hcl
scene "loan_flow" {
  entry_actions      = ["score"]
  next_policy        = "first-match"

  action "score" {
    compute {
      root     = decision
      prog "score_graph" {
        income:int = 0
        debt:int   = 0
        min_income:int = 50000
        max_debt:int   = 20000
        income_ok:bool =| income >= min_income
        debt_ok:bool   =| debt <= max_debt
        decision:bool  = bool_and(income_ok, debt_ok)
      }
    }

    ingress {
      to        = income
      from_ssot = applicant.income
    }

    ingress {
      to        = debt
      from_ssot = applicant.debt
    }

    egress {
      to        = decision.approved
      from      = decision
    }

    next {
      compute {
        condition = go
        prog "to_approve" {
          decision:bool = false
          income_ok:bool = false
          go:bool =| decision & income_ok
        }
      }
      ingress {
        to          = decision
        from_action = decision
      }
      ingress {
        to          = income_ok
        from_action = income_ok
      }
      action = approve
    }
    next {
      compute {
        condition = always
        prog "to_reject" {
          always:bool = true
        }
      }
      action = reject
    }
  }
}
```

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
3. If both a triple-quoted block and explicit `text = ...` appear in one action, validation MUST fail (`SCN_ACTION_TEXT_DUPLICATE`).
4. A single newline immediately after opening `"""` and immediately before closing `"""` MUST be trimmed during lowering; all other content MUST be preserved verbatim.

## 6. Validation Rules

Before first action execution, implementations MUST validate:

1. `actions` is non-empty.
2. `entryActionIds` is non-empty and all entries exist.
3. Every `actionId` is unique.
4. All next actions exist.
5. `compute` language is implicit and MUST be treated as `hcl-context/v1`.
6. For each action, `compute.prog` parses under HCL ContextSpec v1.
7. `compute.root` exists in the program and resolves to a function binding.
8. Every `ingress.to` exists and resolves to a value binding.
9. Every `egress.from` exists in the program when `from` is used.
10. For each next rule, `compute.prog` parses under HCL ContextSpec v1.
11. For each next rule, `compute.condition` exists and resolves to a `bool` binding (value or function output).
12. For each next ingress, `ingress.to` exists and resolves to a value binding in `compute.prog`.
13. For each next ingress with `fromAction`, the source binding exists in the current action `compute.prog` binding namespace.
14. If `view` exists, overview parsing/compilation/enforcement succeeds for selected mode.
15. For action docstring sugar, each action has at most one triple-quoted text block and no conflict with explicit `text`.

Validation failures MUST produce `invalid_graph` except overview failures, which MUST produce `invalid_overview`.

## 7. Action Execution Semantics

For one action invocation with pre-state `S_n`:

1. Snapshot: capture immutable scene snapshot `S_n`.
2. Load graph template: parse/compile `compute.prog` if not cached.
3. Resolve ingresses:
   - For each `ingress` with `fromSsot`, read `S_n` by dotted path.
   - If missing and `required` is true (default), fail action.
   - Apply resolved ingresses as overrides of target value bindings.
4. Build runtime graph:
   - Lower HCL program to ContextSpec.
   - Apply ingress overrides.
   - Build with `ctx(spec)`.
   - Validate with `validateContext`.
5. Execute root function:
   - `rootFuncId = ids[compute.root]`
   - `R_n = executeGraph(rootFuncId, validatedContext)`
   - Build action binding namespace `A_n` from this invocation's action `compute.prog` context.
6. Build action delta `D_n` from `egresses`:
   - `from`: resolve binding value from graph context/output table.
   - `fromLiteral`: use literal value directly.
7. Merge `D_n` atomically into SSOT using `replace-by-id` mode.
8. Evaluate next rules in declaration order:
   - Build/validate each next-rule `compute` graph.
   - Resolve next ingresses from action binding namespace `A_n` (`fromAction`), post-merge state `S_{n+1}` (`fromSsot`), and literals.
   - Resolve `compute.condition` to a boolean value:
     - If `compute.condition` is a function binding, execute it.
     - If `compute.condition` is a value binding, read it directly.
   - Treat resolved boolean as the rule result.
9. Select next action IDs based on effective policy and enqueue.

Failure semantics:

- If any step before merge fails, merge MUST NOT occur.
- No partial SSOT mutation is allowed.

## 8. Next Semantics

- Effective next policy: action-level override, else scene-level, else `first-match`.
- Evaluation order is declaration order.
- Each rule's `compute` graph is evaluated independently and must resolve `compute.condition` to boolean.
- `fromAction` ingresses read from the current action `compute.prog` binding namespace (`A_n`).
- `first-match`: select first true rule.
- `all-match`: select all true rules in declaration order.
- No matches: action run terminates with no next action scheduled.

## 9. Overview DSL Enforcement

Overview DSL behavior is unchanged from `draft-spec/scene-graph.md`:

- `nodes_only`: `overview.nodes ⊆ impl_nodes`
- `at_least`: `overview.nodes ⊆ impl_nodes` and `overview.data_edges ⊆ impl_data_edges`
- `strict`: exact equality for nodes and data edges; control edge handling remains mode-dependent

Runtime mapping:

- `impl_nodes = { action.actionId }`
- `impl_data_edges = { (actionId, nextActionId) | nextActionId in action.next }`

## 10. Diagnostics (Minimum Set)

Existing required codes from v0.2 remain required, plus the following:

- `SCN_INVALID_ACTION_GRAPH`
- `SCN_ACTION_ROOT_NOT_FUNCTION`
- `SCN_INGRESS_TARGET_NOT_VALUE`
- `SCN_INGRESS_SOURCE_MISSING`
- `SCN_EGRESS_SOURCE_INVALID`
- `SCN_EGRESS_SOURCE_UNAVAILABLE`
- `SCN_NEXT_COMPUTE_INVALID`
- `SCN_NEXT_COMPUTE_NOT_BOOL`
- `SCN_NEXT_INGRESS_SOURCE_INVALID`
- `SCN_ACTION_TEXT_DUPLICATE`

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

1. Invalid `root` binding type fails validation (`SCN_ACTION_ROOT_NOT_FUNCTION`).
2. Missing SSOT ingress path with required ingress fails action without merge.
3. `egress.from = compute.root` writes exactly the executed root result.
4. Next-rule `compute.prog` parse/validation failures stop scheduling and emit next diagnostics.
5. `next.compute.condition` must resolve to `bool`, else validation fails.
6. `first-match` and `all-match` selection behavior is deterministic.
7. Overview enforcement modes behave as defined.
8. Re-running with same ingresses and snapshot yields identical `result`, `delta`, and selected next actions.
9. Reference-style DSL fields produce identical runtime strings for quoted vs bare forms.
10. A `next.ingress.from_action` can consume a non-root value binding from action `compute.prog` and make it available in `next.compute`.
11. Triple-quoted action text and explicit `text` assignment produce identical runtime `action.text`.

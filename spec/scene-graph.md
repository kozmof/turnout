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
  - Example: `to_ssot = decision.reason` and `to_ssot = "decision.reason"` normalize to the same runtime string.
- Reference-style attributes include:
  - `action.compute.root`
  - `next.compute.condition`
  - `action.io.group.<binding>.from_ssot`, `action.io.group.<binding>.to_ssot`
  - `next.action`
  - `next.io.group.<binding>.from_action`, `next.io.group.<binding>.from_ssot`
- Literal-style attributes (for example `from_literal`) MUST preserve literal values and are not reference-normalized.

## 3. Balance Rules (CAN / CAN'T)

CAN (OK):

- A scene can contain multiple actions.
- An action can embed one HCL ContextSpec program.
- An action can bind grouped IO mappings under `io { group { ... } }`.
- An action can define inbound/outbound direction per binding in `compute.prog`.
- An action can define next actions using per-next `compute` `prog` blocks.
- A next IO entry can source any value binding defined by the current action `compute.prog` via `from_action`.
- An action can include optional narrative text (`text`) as a string.

CAN'T (NG):

- An action cannot omit `compute.root`.
- `compute.root` cannot point to a value binding; it must resolve to a function binding.
- An `io.group` binding key cannot reference an undefined binding.
- A binding marked as ingress-capable cannot omit its ingress source.
- A next rule cannot omit `compute.condition` or `compute.prog`.
- Next actions cannot reference missing actions.

Correlation:

- Because `root` is function-only, a `<~ root` or `<~> root` binding is always available as a deterministic emission source.
- Because action `compute` and next-rule `compute` use separate `prog` blocks, output mapping and branching logic are explicitly separated.
- Because next-rule inputs are ingress-driven, action `compute.prog` values are usable in `next.compute` only through explicit `next.io.group.<binding>.from_action` mapping.

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
  io?: IoGroup;
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

type IoDirection = "ingress" | "egress" | "both";

type IoGroup = {
  group: Record<string, IoBinding>; // key is binding name declared in compute.prog
};

type IoBinding = {
  fromSsot?: string; // canonical dotted source path
  fromAction?: string; // canonical source binding from prior action namespace (next-rule only)
  fromLiteral?: unknown; // literal ingress source
  toSsot?: string; // canonical destination key in SSOT; default is binding key
  required?: boolean; // default true for fromSsot/fromAction
};

type NextRule = {
  compute: NextComputeGraph;
  io?: IoGroup;
  action: ActionId; // canonical next action id from DSL `next.action`
};

type NextComputeGraph = {
  prog: string; // canonical source of one inline `prog "<name>" { ... }` block
  condition: string; // canonical bool binding key from DSL `next.compute.condition`
};

type OverviewView = {
  text: string;
  enforce: "nodes_only" | "at_least" | "strict";
};
```

Source exclusivity rules:

- For action-level bindings declared as `~>` or `<~>`, exactly one ingress source MUST be set: `fromSsot` or `fromLiteral`.
- For next-level bindings declared as `~>` or `<~>`, exactly one ingress source MUST be set: `fromAction`, `fromSsot`, or `fromLiteral`.
- For bindings declared as `<~` or `<~>`, SSOT merge destination is `toSsot` if provided, otherwise the binding key.
- `fromAction` is only valid inside `next.io.group`.

Action-to-next binding scope:

- For one action invocation, `next.io.group.<binding>.from_action` MUST resolve against that action's `compute.prog` binding namespace.
- Implementations MAY resolve these bindings lazily, but observable behavior MUST match eager availability of all value bindings declared in action `compute.prog`.

## 5. HCL Scene DSL

This spec standardizes the following scene-level HCL shape:

Reference-style fields below are shown in bare form; per Section 2.3, quoted and bare forms normalize identically.
Within `compute.prog`, parse-safe infix shorthand (for example `income_ok:bool =| income >= min_income`, `go:bool =| decision & income_ok`) follows HCL ContextSpec lowering rules.
Directional binding prefixes are interpreted before ContextSpec lowering:

- `~>name:type = ...` means ingress-only binding.
- `<~name:type = ...` means egress-only binding.
- `<~>name:type = ...` means ingress + egress binding.

```hcl
scene "loan_flow" {
  entry_actions      = ["score"]
  next_policy        = "first-match"

  action "score" {
    compute {
      root     = decision
      prog "score_graph" {
        <~>income:int = 0
        ~>debt:int   = 0
        min_income:int = 50000
        max_debt:int   = 20000
        income_ok:bool =| income >= min_income
        debt_ok:bool   =| debt <= max_debt
        <~decision:bool  = bool_and(income_ok, debt_ok)
      }
    }

    io {
      group {
        income {
          from_ssot = applicant.income
          to_ssot   = decision.input_income
        }
        debt {
          from_ssot = applicant.debt
        }
        decision {
          to_ssot = decision.approved
        }
      }
    }

    next {
      compute {
        condition = go
        prog "to_approve" {
          ~>decision:bool = false
          ~>income_ok:bool = false
          go:bool =| decision & income_ok
        }
      }
      io {
        group {
          decision {
            from_action = decision
          }
          income_ok {
            from_action = income_ok
          }
        }
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
8. Every `io.group` binding key exists and resolves to a value binding in `compute.prog`.
9. For every binding declared `~>` or `<~>`, exactly one ingress source is set in `io.group`.
10. For each next rule, `compute.prog` parses under HCL ContextSpec v1.
11. For each next rule, `compute.condition` exists and resolves to a `bool` binding (value or function output).
12. For each next rule, every `next.io.group` binding key exists and resolves to a value binding in that next-rule `compute.prog`.
13. For each next binding with `fromAction`, the source binding exists in the current action `compute.prog` binding namespace.
14. If `view` exists, overview parsing/compilation/enforcement succeeds for selected mode.
15. For action docstring sugar, each action has at most one triple-quoted text block and no conflict with explicit `text`.

Validation failures MUST produce `invalid_graph` except overview failures, which MUST produce `invalid_overview`.

## 7. Action Execution Semantics

For one action invocation with pre-state `S_n`:

1. Snapshot: capture immutable scene snapshot `S_n`.
2. Load graph template: parse/compile `compute.prog` if not cached.
3. Resolve ingress-capable IO bindings:
   - For each `io.group.<binding>` where direction is `~>` or `<~>`, resolve source (`fromSsot`, `fromLiteral`).
   - If missing and `required` is true (default), fail action.
   - Apply resolved values as overrides of target bindings.
4. Build runtime graph:
   - Lower HCL program to ContextSpec.
   - Apply IO-derived ingress overrides.
   - Build with `ctx(spec)`.
   - Validate with `validateContext`.
5. Execute root function:
   - `rootFuncId = ids[compute.root]`
   - `R_n = executeGraph(rootFuncId, validatedContext)`
   - Build action binding namespace `A_n` from this invocation's action `compute.prog` context.
6. Build action delta `D_n` from egress-capable IO bindings:
   - For each `io.group.<binding>` where direction is `<~` or `<~>`, read binding value from graph context/output table.
   - Destination key is `toSsot` if provided; otherwise binding name.
7. Merge `D_n` atomically into SSOT using `replace-by-id` mode.
8. Evaluate next rules in declaration order:
   - Build/validate each next-rule `compute` graph.
   - Resolve next ingress-capable bindings from action binding namespace `A_n` (`fromAction`), post-merge state `S_{n+1}` (`fromSsot`), and literals.
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
- `fromAction` in `next.io.group` reads from the current action `compute.prog` binding namespace (`A_n`).
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
3. A `<~ root` or `<~> root` binding writes exactly the executed root result when mapped through `io.group`.
4. Next-rule `compute.prog` parse/validation failures stop scheduling and emit next diagnostics.
5. `next.compute.condition` must resolve to `bool`, else validation fails.
6. `first-match` and `all-match` selection behavior is deterministic.
7. Overview enforcement modes behave as defined.
8. Re-running with same IO inputs and snapshot yields identical `result`, `delta`, and selected next actions.
9. Reference-style DSL fields produce identical runtime strings for quoted vs bare forms.
10. A `next.io.group.<binding>.from_action` can consume a non-root value binding from action `compute.prog` and make it available in `next.compute`.
11. Triple-quoted action text and explicit `text` assignment produce identical runtime `action.text`.

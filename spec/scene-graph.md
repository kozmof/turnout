# Scene Graph Specification (Action-Embedded Computation Graph) v0.3

> Status: Proposed spec for implementation
> Scope: Scene orchestration + action-local computation graph definition

## 1. Purpose

This spec defines a scene model where each action embeds its own computation graph.
The computation graph syntax is the HCL ContextSpec DSL (`hcl-context/v1`, implicit in this version) and is executed through the existing builder/runtime pipeline (`ctx` -> `validateContext` -> `executeGraph`).

Primary goals:

1. A scene must be able to define actions declaratively.
2. Each action must be able to declare its computation graph inline.
3. Input values and emitted output deltas must be explicit and deterministic.
4. Transition behavior must remain deterministic (`first-match` or `all-match`).

## 2. Conventions

### 2.1 Normative keywords
The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are to be interpreted as described in RFC 2119.

### 2.2 Identifiers

- `SceneId`, `ActionId`, and HCL binding names use `IDENT = [A-Za-z_][A-Za-z0-9_]*`.
- Matching is case-sensitive.

## 3. Balance Rules (CAN / CAN'T)

CAN (OK):

- A scene can contain multiple actions.
- An action can embed one HCL ContextSpec program.
- An action can bind runtime inputs from SSOT paths or literals.
- An action can emit multiple output keys to merge into SSOT.
- An action can transition to other actions using ordered predicates.

CAN'T (NG):

- An action cannot omit `compute.root`.
- `compute.root` cannot point to a value binding; it must resolve to a function binding.
- An `input` target cannot reference an undefined binding.
- An `emit` source cannot reference an undefined binding.
- Transition targets cannot reference missing actions.

Correlation:

- Because `root` is function-only, `from = "<root_binding>"` is always available as a deterministic emission source.
- Because `input` and `emit` reference declared bindings, scene validation can fail fast before run-time mutation.

## 4. Runtime Data Model

```ts
type Scene = {
  sceneId: string;
  actions: Action[];
  entryActionIds: ActionId[];
  transitionPolicy?: "first-match" | "all-match"; // default: first-match
  view?: OverviewView;
};

type Action = {
  actionId: ActionId;
  compute: ActionComputeGraph;
  inputs?: ActionInputBinding[];
  emits?: ActionEmitBinding[];
  transitions?: TransitionRule[]; // default: []
  transitionPolicy?: "first-match" | "all-match";
  resultMerge?: {
    mode?: "replace-by-id"; // default: replace-by-id
  };
};

type ActionComputeGraph = {
  prog: string; // canonical source of one inline `prog "<name>" { ... }` block
  root: string; // binding key in program, must resolve to function binding
};

type ActionInputBinding = {
  to: string; // target value binding name in action program
  fromSsot?: string; // dotted path in scene snapshot
  fromLiteral?: unknown;
  required?: boolean; // default true (only for fromSsot)
};

type ActionEmitBinding = {
  to: string; // destination key in action delta (merged to SSOT)
  from?: string; // emit resolved program binding value (including root binding)
  fromLiteral?: unknown;
};

type TransitionRule = {
  when: string; // predicate expression against { result, state }
  to: ActionId;
};

type OverviewView = {
  text: string;
  enforce: "nodes_only" | "at_least" | "strict";
};
```

Source exclusivity rules:

- `ActionInputBinding`: exactly one of `fromSsot` or `fromLiteral` MUST be set.
- `ActionEmitBinding`: exactly one of `from` or `fromLiteral` MUST be set.

## 5. HCL Scene DSL

This spec standardizes the following scene-level HCL shape:

```hcl
scene "loan_flow" {
  entry_actions      = ["score"]
  transition_policy  = "first-match"

  action "score" {
    compute {
      root     = "decision"
      prog "score_graph" {
        income:int = 0
        debt:int   = 0
        min_income:int = 50000
        max_debt:int   = 20000
        income_ok:bool = gte(income, min_income)
        debt_ok:bool   = lte(debt, max_debt)
        decision:bool  = bool_and(income_ok, debt_ok)
      }
    }

    input {
      to        = "income"
      from_ssot = "applicant.income"
    }

    input {
      to        = "debt"
      from_ssot = "applicant.debt"
    }

    emit {
      to        = "decision.approved"
      from      = "decision"
    }

    transition {
      when = "result.value == true"
      to   = "approve"
    }
    transition {
      when = "true"
      to   = "reject"
    }
  }
}
```

## 6. Validation Rules

Before first action execution, implementations MUST validate:

1. `actions` is non-empty.
2. `entryActionIds` is non-empty and all entries exist.
3. Every `actionId` is unique.
4. All transition targets exist.
5. `compute` language is implicit and MUST be treated as `hcl-context/v1`.
6. For each action, `compute.prog` parses under HCL ContextSpec v1.
7. `compute.root` exists in the program and resolves to a function binding.
8. Every `input.to` exists and resolves to a value binding.
9. Every `emit.from` exists in the program when `from` is used.
10. If `view` exists, overview parsing/compilation/enforcement succeeds for selected mode.

Validation failures MUST produce `invalid_graph` except overview failures, which MUST produce `invalid_overview`.

## 7. Action Execution Semantics

For one action invocation with pre-state `S_n`:

1. Snapshot: capture immutable scene snapshot `S_n`.
2. Load graph template: parse/compile `compute.prog` if not cached.
3. Resolve inputs:
   - For each `input` with `fromSsot`, read `S_n` by dotted path.
   - If missing and `required` is true (default), fail action.
   - Apply resolved inputs as overrides of target value bindings.
4. Build runtime graph:
   - Lower HCL program to ContextSpec.
   - Apply input overrides.
   - Build with `ctx(spec)`.
   - Validate with `validateContext`.
5. Execute root function:
   - `rootFuncId = ids[compute.root]`
   - `R_n = executeGraph(rootFuncId, validatedContext)`
6. Build action delta `D_n` from `emits`:
   - `from`: resolve binding value from graph context/output table.
   - `fromLiteral`: use literal value directly.
7. Merge `D_n` atomically into SSOT using `replace-by-id` mode.
8. Evaluate transitions against `{ result: R_n, state: S_{n+1} }`.
9. Select next action IDs based on effective policy and enqueue.

Failure semantics:

- If any step before merge fails, merge MUST NOT occur.
- No partial SSOT mutation is allowed.

## 8. Transition Semantics

- Effective transition policy: action-level override, else scene-level, else `first-match`.
- Evaluation order is declaration order.
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
- `impl_data_edges = { (actionId, targetActionId) | targetActionId in action.transitions }`

## 10. Diagnostics (Minimum Set)

Existing required codes from v0.2 remain required, plus the following:

- `SCN_INVALID_ACTION_GRAPH`
- `SCN_ACTION_ROOT_NOT_FUNCTION`
- `SCN_INPUT_TARGET_NOT_VALUE`
- `SCN_INPUT_SOURCE_MISSING`
- `SCN_EMIT_SOURCE_INVALID`
- `SCN_EMIT_SOURCE_UNAVAILABLE`

Recommended diagnostic payload:

```ts
type SceneDiagnostic = {
  code: string;
  severity: "error" | "warning";
  stage:
    | "scene_validation"
    | "action_validate"
    | "action_execute"
    | "transition_resolve"
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
2. Missing SSOT input path with required input fails action without merge.
3. `emit.from = compute.root` writes exactly the executed root result.
4. `first-match` and `all-match` selection behavior is deterministic.
5. Overview enforcement modes behave as defined.
6. Re-running with same inputs and snapshot yields identical `result`, `delta`, and selected next actions.

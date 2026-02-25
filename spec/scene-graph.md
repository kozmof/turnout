# Scene Graph Specification (Formal Draft v0.2)

> Status: Draft for implementation
> Scope: Runtime scene execution semantics and optional Overview DSL topology enforcement

## 1. Conventions

### 1.1 Normative keywords
The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are to be interpreted as described in RFC 2119.

### 1.2 Identifier notation
- `ActionId` and overview `NodeId` use `IDENT = [A-Za-z_][A-Za-z0-9_]*`.
- Matching between runtime actions and overview nodes is case-sensitive string equality.

### 1.3 Deterministic ordering
When diagnostics contain a set of nodes or edges, implementations MUST emit them in stable lexicographic order:
- Nodes: ascending `IDENT`.
- Edges: ascending `(from, to)` tuple order.

## 2. Primary Goal and Scope

The system defines a deterministic scene orchestration model where:
1. Actions execute compute graphs against an immutable snapshot of SSOT.
2. Action output merges atomically into SSOT.
3. Next actions are selected via deterministic transition rules.
4. Optional Overview DSL text can enforce a topology contract against the implementation graph.

Out of scope in this draft:
- Distributed scheduling and cross-process consistency.
- Runtime semantics for control edges (`^`) beyond validation/enforcement.

## 3. Runtime Data Model

### 3.1 Logical entities
- SSOT: canonical mutable state for one scene run.
- Scene: collection of actions, one or more entry actions, optional overview contract.
- Action: unit that executes a compute graph and emits result + merge delta.
- Transition rule: ordered predicate + target action.
- Scene run: one execution instance with lifecycle status.

### 3.2 Structural contracts

```ts
type Scene = {
  actions: Action[];
  entryActionIds: ActionId[];
  transitionPolicy?: "first-match" | "all-match"; // default: first-match
  view?: OverviewView;
};

type Action = {
  actionId: ActionId;
  graph: {
    executionContextId: string;
    rootFuncId: string;
  };
  inputBindings: Record<string, unknown>;
  resultMerge?: {
    mode?: "replace-by-id"; // default: replace-by-id
  };
  transitions: TransitionRule[];
  transitionPolicy?: "first-match" | "all-match"; // action-level override
};

type TransitionRule = {
  when: string; // predicate expression resolved by runtime
  to: ActionId;
};

type OverviewView = {
  text: string;
  enforce: "nodes_only" | "at_least" | "strict";
};
```

### 3.3 Scene invariants
Before first action execution, the implementation MUST validate:
1. `actions` is non-empty.
2. `entryActionIds` is non-empty.
3. Every `actionId` is unique.
4. Every `entryActionId` exists in `actions`.
5. Every transition target exists in `actions`.
6. Every referenced graph ID and value/function/definition ID exists.
7. If `view` exists, the overview text parses and compiles.
8. If `view` exists, overview enforcement succeeds for the configured mode.

If any invariant fails, run status MUST be `invalid_graph` except overview parse/compile/enforcement failures, which MUST be `invalid_overview`.

## 4. Runtime Execution Semantics

For one action invocation with pre-state `S_n`:
1. Snapshot: copy SSOT into immutable `S_n`.
2. Input bind: resolve ad hoc input bindings for the action.
3. Runtime input build: derive compute input from `S_n` plus ad hoc values.
4. Context validate: run runtime context validation (same gate as `validateContext`).
5. Execute graph: produce result `R_n` and delta `D_n`.
6. Merge: atomically apply `D_n` to SSOT and produce `S_{n+1}`.
7. Transition evaluate: evaluate transition rules against `R_n` and `S_{n+1}`.
8. Schedule: enqueue selected next action(s), then mark action complete.

Failure behavior:
- If step 4 or step 5 fails, step 6 MUST NOT run.
- No partial SSOT mutation is allowed on any failure path.

## 5. Merge Semantics

### 5.1 Current merge mode
This draft defines one merge mode:
- `replace-by-id` (default and only standardized mode in v0.2).

Semantics:
1. For every key present in `D_n`, SSOT value MUST be replaced by `D_n[key]`.
2. Keys not present in `D_n` MUST remain unchanged.
3. Merge MUST be atomic per action.

### 5.2 Extension rule
Future merge modes MAY be added, but unknown merge mode values MUST fail validation before execution.

## 6. Transition Semantics

### 6.1 Policy resolution
- Action-level `transitionPolicy` overrides scene-level `transitionPolicy`.
- If neither is set, effective policy MUST be `first-match`.

### 6.2 Evaluation rules
- Transition order is declaration order.
- `first-match`: select the first rule that evaluates `true`.
- `all-match`: select all rules that evaluate `true`, preserving declaration order.
- If no rule matches, the run MUST enter terminal `completed` state.
- Predicates MUST be evaluated against `R_n` and `S_{n+1}`.

## 7. Failure Semantics and Diagnostics

### 7.1 Action failure classes
- `failed_validation`: runtime context validation failed.
- `failed_execution`: compute graph execution failed.

### 7.2 Run failure classes
- `invalid_graph`: structural/runtime topology invalidity in scene/action definitions.
- `invalid_overview`: overview parse/compile/enforcement failure.

### 7.3 Diagnostic schema
Every failure MUST emit:

```ts
type SceneDiagnostic = {
  code: string;
  severity: "error" | "warning";
  stage:
    | "scene_validation"
    | "overview_parse"
    | "overview_compile"
    | "overview_enforce"
    | "action_validate"
    | "action_execute"
    | "transition_resolve";
  actionId?: ActionId;
  message: string;
  details?: Record<string, unknown>;
};
```

### 7.4 Required error codes
Implementations MUST provide at least the following codes:
- `SCN_DUPLICATE_ACTION_ID`
- `SCN_MISSING_ENTRY_ACTION`
- `SCN_MISSING_TRANSITION_TARGET`
- `SCN_INVALID_CONTEXT`
- `SCN_EXECUTION_ERROR`
- `SCN_OVERVIEW_PARSE_ERROR`
- `SCN_OVERVIEW_COMPILE_ERROR`
- `SCN_OVERVIEW_ENFORCEMENT_FAILED`
- `SCN_OVERVIEW_CONTROL_UNAVAILABLE`
- `SCN_OVERVIEW_CONTROL_COMPARISON_SKIPPED` (warning)

## 8. Determinism and Idempotency

Given identical preconditions (`S_n`, ad hoc inputs, graph definitions, transition rules), one action invocation MUST produce identical:
- `R_n`
- `D_n`
- selected next action IDs

Additional guarantees:
- Retrying after failure MUST NOT expose partial SSOT mutation.
- Non-deterministic dependencies (time, random, IO) SHOULD be injected as explicit ad hoc inputs.

## 9. Overview DSL

### 9.1 Purpose
Overview DSL is an indentation-shaped textual topology contract for the scene graph.

It is embedded in HCL:

```hcl
view "overview" {
  text = <<-EOT
    A
      |=> B => C
      |=> D(&B)
  EOT

  enforce = "at_least"
}
```

### 9.2 Lexical rules
1. Tabs in indentation MUST be rejected (`SCN_OVERVIEW_PARSE_ERROR`).
2. Blank lines MAY appear and MUST be ignored.
3. Indentation levels MUST follow stack discipline (INDENT/DEDENT).
4. Dedent to a non-existing prior level MUST fail parse.
5. `IDENT` tokens MUST match `[A-Za-z_][A-Za-z0-9_]*`.

### 9.3 Conceptual output model

```text
nodes: Set<NodeId>
data_edges: Set<(from,to)>
control_edges: Set<(from,to)>
```

### 9.4 Core syntax and semantics

Root declaration:

```text
A
```

- Declares node `A`
- Sets active root to `A`

Branch:

```text
|=> PATH
```

Semantics for root `R` and path `S1 => ... => Sn`:
- Data edge `R -> S1`
- Chain edges `Si -> S(i+1)` for `i in [1, n-1]`

Tap dependency:

```text
D(&B, &C)
```

Semantics:
- Data edges `B -> D`, `C -> D`

Control dependency:

```text
C(^B)
```

Semantics:
- Control edge `B ~> C` (stored separately from data edges)

### 9.5 Indentation and branch-root rule
1. Each indented line belongs to nearest less-indented ancestor.
2. Nested lines under a branch use branch-root = first step of that branch path.
3. Branch-root is never the last chain step unless path length is 1.

Example:

```text
A
  |=> B => C
    |=> D
```

Compiles to:
- `A -> B`
- `B -> C`
- `B -> D`

### 9.6 Multiple root blocks
Multiple top-level roots are allowed and compile into one overview graph with potentially disconnected components.

### 9.7 Formal grammar (simplified)

```text
document      ::= forest
forest        ::= root_block+
root_block    ::= node_line (INDENT branch_stmt+ DEDENT)?
node_line     ::= IDENT
branch_stmt   ::= "|=>" path (INDENT branch_stmt+ DEDENT)?
path          ::= step ("=>" step)*
step          ::= IDENT dep_annots?
dep_annots    ::= "(" dep_item ("," dep_item)* ")"
dep_item      ::= "&" IDENT | "^" IDENT
```

### 9.8 Compilation algorithm
For each root block:
1. Set active root `R` from `node_line`.
2. For each `branch_stmt` under `R`:
   - Parse path `S1..Sn`.
   - Add data edge `R -> S1`.
   - Add chain edges `Si -> S(i+1)` for `i in [1, n-1]`.
   - For each `&X` on step `Si`, add data edge `X -> Si`.
   - For each `^X` on step `Si`, add control edge `X ~> Si`.
   - If nested branch statements exist, recurse with new active root = `S1`.
3. Add every referenced identifier to `nodes`.

Set behavior:
- Duplicate nodes/edges MUST be deduplicated.
- Compilation MUST be deterministic for identical input text.

## 10. Enforcement Modes and Runtime Mapping

### 10.1 Runtime topology extraction
- `impl_nodes = { action.actionId }`
- `impl_data_edges = { (actionId, targetActionId) | targetActionId in action.transitions }`
- `impl_control_edges` are compared only when implementation exposes control metadata.

### 10.2 Enforcement modes

`nodes_only`:
- Require `overview.nodes ⊆ impl_nodes`.

`at_least`:
- Require `overview.nodes ⊆ impl_nodes`.
- Require `overview.data_edges ⊆ impl_data_edges`.
- Extra implementation nodes/edges are allowed.
- If control metadata is unavailable, control comparison MUST be skipped and a warning diagnostic SHOULD be emitted.

`strict`:
- Require `overview.nodes = impl_nodes`.
- Require `overview.data_edges = impl_data_edges`.
- Require `overview.control_edges = impl_control_edges` when control metadata exists.
- If overview has any control edges and implementation control metadata is unavailable, enforcement MUST fail with `SCN_OVERVIEW_CONTROL_UNAVAILABLE`.

### 10.3 Enforcement failure output
On enforcement failure, diagnostics MUST include:
- mode (`nodes_only` | `at_least` | `strict`)
- missing/extra nodes
- missing/extra data edges
- missing/extra control edges (if compared)

## 11. Conformance Test Plan

### 11.1 Runtime structural validation
- Duplicate `actionId` fails with `SCN_DUPLICATE_ACTION_ID`.
- Missing `entryActionId` fails with `SCN_MISSING_ENTRY_ACTION`.
- Missing transition target fails with `SCN_MISSING_TRANSITION_TARGET`.

### 11.2 Runtime execution path
- Success path verifies snapshot -> execute -> atomic merge -> transition.
- Validation or execution failure verifies no merge occurred.

### 11.3 Merge behavior
- `replace-by-id` updates only touched keys.
- Unknown merge mode fails pre-execution validation.

### 11.4 Transition behavior
- `first-match` chooses first true rule.
- `all-match` returns all true rules in declaration order.
- No-match transitions run to terminal `completed`.

### 11.5 Overview parser and compiler
- Valid examples for flat, nested, and chained branches.
- Invalid indentation and tab indentation fail parse.
- Branch-root behavior uses first chain step deterministically.

### 11.6 Enforcement
- `nodes_only`, `at_least`, and `strict` pass/fail according to Section 10.
- Strict mode with unresolved control metadata fails when overview contains control edges.

### 11.7 Idempotency
- Re-executing same preconditions yields identical result, delta, and next actions.

## 12. Open Decisions
1. Parallel execution policy for queued next actions within one run.
2. Whether control dependencies should become executable runtime constraints in a future version.

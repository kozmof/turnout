# Scene Graph Spec

## 1. Primary Goal
Define a deterministic scene orchestration model where actions execute compute graphs against a single source of truth (SSOT) state and route to subsequent actions.

## 2. Sub-goals
1. Represent a scene as a connected set of actions.
2. Ensure each action reads from an immutable state snapshot and writes through explicit merge.
3. Resolve next actions through deterministic transition rules.
4. Make success and failure behavior explicit.
5. Keep the model testable and idempotent.

## 3. Domain Model
- SSOT state: canonical mutable state store for one scene run.
- Scene: named collection of actions plus one or more entry actions.
- Action: compute step that evaluates a compute graph with snapshot state and ad hoc inputs.
- Ad hoc input: runtime input for one action (user input or constant).
- Transition rule: predicate over action result and state used to select next action(s).
- Scene run: one execution instance with its own SSOT and lifecycle.

## 4. Scene and Action Contract
1. A scene MUST define `actions` and `entryActionIds`.
2. An action MUST define:
   - `actionId`
   - `graph` (execution context and root function id)
   - `inputBindings` for ad hoc values
   - `resultMerge` policy
   - ordered `transitions`
3. All referenced IDs (action/value/function/definition IDs) MUST exist before runtime execution starts.

## 5. Action Lifecycle
For one action execution:
1. Copy SSOT into immutable snapshot `S_n`.
2. Resolve ad hoc inputs for the action.
3. Build action-local runtime input from `S_n` plus ad hoc inputs.
4. Validate runtime context (equivalent to `validateContext` gate).
5. Execute compute graph and produce result `R_n` and delta `D_n`.
6. Merge `D_n` into SSOT atomically, producing `S_{n+1}`.
7. Evaluate transition rules using `R_n` and `S_{n+1}`.
8. Enqueue selected next action(s), then mark action complete.

If step 4 or step 5 fails, merge MUST NOT occur.

## 6. Merge Semantics
- Default mode is `replace-by-id` for keys present in `D_n`.
- Merge MUST be atomic per action.
- Untouched SSOT keys MUST remain unchanged.
- On key conflict, action output wins unless action-specific policy overrides it.

## 7. Transition Semantics
- Transition order is significant.
- Default policy is `first-match`.
- `first-match`: select the first rule that evaluates to `true`.
- `all-match` (optional): select all true rules in declaration order.
- If no rule matches, scene run enters terminal `completed` state.
- Transition predicates MUST evaluate against post-merge state (`S_{n+1}`) and current action result (`R_n`).

## 8. Failure Semantics
- Validation failure: mark action `failed_validation`, do not merge, stop unless error transition exists.
- Execution failure: mark action `failed_execution`, do not merge, stop unless error transition exists.
- Transition failure (missing target action): mark run `invalid_graph` and stop.
- Every failure MUST emit structured diagnostics: action id, stage, message, and details.

## 9. Determinism and Idempotency
- Given identical `S_n`, ad hoc inputs, and graph definition, the action MUST produce identical `R_n`, `D_n`, and selected next actions.
- Retry after failure MUST NOT expose partial SSOT mutation.
- Non-deterministic behavior (time/random/IO) SHOULD be injected through explicit ad hoc inputs.

## 10. Open Decisions to Confirm
1. Should default transition policy remain `first-match`, or always permit fan-out?
2. Should merge conflict policy be globally fixed or configurable per action?
3. Should no-match terminal state be `completed` or `stalled`?
4. Is parallel execution of queued next actions allowed for one scene run?

## 11. Test Plan (Testable Spec)
### 11.1 Graph Wiring
- Valid case: all action and transition targets resolve.
- Invalid case: missing transition target is rejected before execution.

### 11.2 Critical Path
- Happy path: snapshot -> execute -> atomic merge -> transition.
- Verify no SSOT mutation occurs before successful merge commit.

### 11.3 Merge Behavior
- Replace-by-id updates only touched keys.
- Conflict behavior follows configured policy.
- Simulated failure before commit leaves SSOT unchanged.

### 11.4 Transition Resolution
- `first-match` respects declaration order.
- `all-match` returns deterministic ordered targets.
- No-match reaches terminal state deterministically.

### 11.5 Error Scenarios
- Invalid context blocks execution and merge.
- Runtime compute errors block merge and emit diagnostics.
- Invalid transition target stops run with `invalid_graph`.

### 11.6 Idempotency
- Repeating same inputs yields identical outputs and next actions.
- Re-run from same pre-state yields identical post-state.

### 11.7 Manual Intervention
- Operator can inspect diagnostics and retry with corrected ad hoc input.
- Manual SSOT edits (if allowed) must happen via audited operation before retry.

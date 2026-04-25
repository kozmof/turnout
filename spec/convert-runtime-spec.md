# Convert–Runtime Pipeline Specification

> **Status**: Draft for implementation
> **Scope**: Two-phase pipeline from Turn DSL authoring to TypeScript runtime execution, including STATE effect semantics

---

## Overview

### Layer Responsibilities

The model separates concerns across four layers:

| layer   | responsibility                   |
| ------- | -------------------------------- |
| prog    | declare computation and bindings |
| prepare | construct input state            |
| merge   | persist results                  |
| publish | expose final state               |

Key properties:
- Sigils define directional intent; binding names remain plain canonical identifiers.
- `prepare` and `merge` operate on **individual bindings**; `publish` operates on the **whole state**.
- Hooks never mutate state directly; state is written only through prepare result mapping.
- All STATE paths and hook names are declared explicitly at convert time.

### Pipeline

The pipeline has two sequential phases:

1. **Convert phase** — A Go CLI reads Turn DSL and emits canonical plain HCL files that conform to `hcl-context-spec.md`.
2. **Runtime phase** — A TypeScript runtime reads the emitted HCL, prepares a `ContextSpec` via `ctx()`, and executes it through the step execution API. Each action's result is merged into STATE at the timing declared in the Turn DSL.

```
Turn DSL  ──[Go CLI]──>  HCL file  ──[TypeScript runtime]──>  STATE mutations
```

---

## Phase 1: Convert (Go CLI)

### Responsibilities

- Parse Turn DSL source.
- Lower DSL constructs to canonical plain HCL (per `hcl-context-spec.md` lowering rules).
- Emit one `prog "<actionId>" { ... }` block per declared action compute graph, nested inside an `action "<actionId>" { compute { ... } prepare { ... } merge { ... } publish { ... } }` block.
- Emit `entry_actions = ["<actionId>", ...]` as a top-level attribute at the top of each scene block to declare the scene's entry action IDs.
- Emit inline transition `prog` blocks for each next-rule compute program.
- Emit STATE effect declarations (`prepare` and `merge` sub-blocks) at action level.
- Emit `publish` sub-block for any publish-phase hook declarations.
- Validate DSL syntax and type rules before emitting any HCL.

### Action HCL Shape

```hcl
action "checkout" {
  compute {
    root = "order_id"
    prog "checkout_graph" {
      binding "cart_items" {
        type  = "str"
        value = ""
      }
      binding "order_id" {
        type  = "str"
        expr  = { combine = { fn = "build_order" args = [{ ref = "cart_items" }] } }
      }
    }
  }

  prepare {
    binding "cart_items" { from_state = "session.cart.items" }
  }

  merge {
    binding "order_id" { to_state = "order.id" }
  }

  publish {
    hook = "order_audit"
  }
}
```

Rules:
- `prepare` entries declare STATE inputs (`from_state`) or hook inputs (`from_hook`) for `~>` and `<~>` sigiled bindings.
- `merge` entries declare STATE outputs (`to_state`) for `<~` and `<~>` sigiled bindings.
- `publish` entries declare publish-phase hook names; multiple `hook` attributes are allowed.
- Every binding name inside `prepare` or `merge` must also appear as a `binding` block in the same `prog` block.
- `state_path` / dotted path values are composed of `[A-Za-z_][A-Za-z0-9_]*` segments separated by `.`.
- Timing is fixed at convert time: `prepare` bindings are resolved before execution; `merge` bindings are written after execution; `publish` hooks fire after merge.

### CAN (OK)

- The Go CLI can accept Turn DSL surface syntax including typed keys (`name:type`), function call expressions, parse-safe infix expressions (`=`), `#if`, `#case`, and `#pipe`.
- The Go CLI can lower all surface DSL forms to canonical plain HCL `binding` blocks, identically to the rules in `hcl-context-spec.md` §2–3.
- The Go CLI can emit multiple `action` blocks in one HCL file — one per declared action — as long as each block has a distinct name label matching its `actionId`.
- The Go CLI can declare STATE effect bindings inside action blocks using `prepare` and `merge` sub-blocks.
- The Go CLI can emit `publish` sub-blocks with one or more `hook` attributes per action.
- The Go CLI can emit `prepare` entries with `from_hook` for prepare-phase hook bindings (per `hook-spec.md`).
- The Go CLI can report parse and type errors (per the error catalogue in `hcl-context-spec.md` §5 and the extended catalogue below) and abort without emitting partial HCL.
- The Go CLI can validate that every transition `compute.condition` binding resolves to a `bool` at convert time.

### CAN'T (NG)

- The Go CLI cannot emit `name:type` as attribute keys in the canonical HCL output; typed keys must be lowered to `binding "<name>" { type = "..." ... }` blocks.
- The Go CLI cannot emit bare identifiers in argument positions; all references must be lowered to explicit reference or expression nodes such as `{ ref = "name" }`, or the canonical `if`/`case`/`pipe` expression shapes from `hcl-context-spec.md`.
- The Go CLI cannot accept or emit non-v0 forms such as `{ fn = [x, y] }`, `pipe(...)[...]`, `#pipe(x:v)[...]`, block-style `cond`, or block-style `#if`.
- The Go CLI cannot emit Phase 2 loop constructs (`range`, `map`, `filter`, `fold`) in Phase 1 output; encountering them **must produce an `UnsupportedConstruct` error** and abort without emitting any HCL.
- The Go CLI cannot emit HCL that is not parseable by a stock HCL parser.
- The Go CLI cannot emit a file in which two `action` blocks share the same name label.
- Effect timing cannot be inferred at runtime; it must be fixed in the emitted HCL at convert time as declared in the Turn DSL.
- The Go CLI cannot emit a `prepare` or `merge` binding whose name does not match an existing `binding` block in the same `prog`.
- The Go CLI cannot emit a `from_state` or `to_state` value that is not a valid dotted identifier path.
- The Go CLI cannot emit a `prepare` entry with both `from_state` and `from_hook` on the same binding (`InvalidPrepareSource`).
- The Go CLI cannot emit a `from_hook` binding name in a transition `prepare` block (`TransitionHook`).
- The Go CLI cannot emit `merge` or `publish` blocks inside a transition `next` block.

### Convert-phase Error Catalogue

In addition to the error codes in `hcl-context-spec.md` §5, the converter must emit:

| Error code | Trigger condition |
|------------|------------------|
| `UnsupportedConstruct` | Phase 2 loop construct (`range`, `map`, `filter`, `fold`) encountered in a Phase 1 DSL file |
| `DuplicateActionLabel` | Two `action` blocks with the same name label in one emitted HCL file |
| `InvalidStatePath` | `from_state` or `to_state` value has fewer than two segments, contains an empty segment, a leading/trailing dot, or uses invalid identifier characters |
| `UnresolvedPrepareBinding` | `prepare` binding name has no matching `binding` block in the same `prog` |
| `UnresolvedMergeBinding` | `merge` binding name has no matching `binding` block in the same `prog` |
| `MissingPrepareEntry` | A `~>` or `<~>` sigiled binding has no corresponding `prepare` entry |
| `MissingMergeEntry` | A `<~` or `<~>` sigiled binding has no corresponding `merge` entry |
| `InvalidPrepareSource` | A `prepare` entry carries both `from_state` and `from_hook` |
| `TransitionHook` | A `from_hook` source appears in a transition `prepare` block |
| `TransitionMerge` | A `merge` or `publish` block appears inside a `next { }` block |
| `SpuriousPrepareEntry` | A `prepare` entry references a binding that has no sigil in the corresponding `prog` block |
| `SpuriousMergeEntry` | A `merge` entry references a binding that has no sigil in the corresponding `prog` block |
| `BidirMissingPrepareEntry` | A `<~>` binding appears in `merge` but has no corresponding entry in `prepare` |
| `BidirMissingMergeEntry` | A `<~>` binding appears in `prepare` but has no corresponding entry in `merge` |
| `TransitionOutputSigil` | A `<~` or `<~>` sigil appears in a transition `prog` block |
| `InvalidTransitionIngress` | A transition `prepare` entry has none of `from_action`, `from_state`, or `from_literal`, or has more than one of them |

---

## Phase 2: Runtime (TypeScript)

### Responsibilities

- Parse the emitted HCL and construct a `Scene` (per `scene-graph.md` §3.2).
- For each action, pass its `prog` block to `ctx()` to obtain a `ContextSpec`.
- Validate scene structural invariants (per `scene-graph.md` §3.3) before first execution.
- Execute actions following the four-phase lifecycle: **prepare → compute → merge → publish**.
- Atomically merge the action result delta into STATE.
- Evaluate transition compute programs using post-merge STATE and action output.
- Enqueue selected next action(s) according to the transition policy.

### Action-Local State

During execution of one action, the runtime maintains a local state map:

```
State = { binding_name → value }
```

Binding names are defined by the `prog` block in `compute`; the set of bindings declared there forms the **runtime state schema** for that action invocation. This state map is distinct from STATE (`S_n` / `S_{n+1}`):

- `prepare` populates state bindings from STATE paths or hook results before the graph runs.
- `compute` reads and writes state bindings through the program graph.
- `merge` selects specific state bindings and writes them back to STATE.
- `publish` exposes the complete final state map to publish hooks (read-only).

Example state during `process_order` execution:

```
{
  raw_payload: "...",
  user_id: "u123",
  receipt: "..."
}
```

### Execution Order (per action)

```
1. Resolve prepare.from_state bindings from STATE snapshot S_n
2. Invoke prepare hooks (declaration order); collect returned objects
3. Map hook result fields into state bindings
4. Execute compute graph (executeGraph)
5. Apply merge.to_state → produce STATE delta D_n; apply atomically → S_{n+1}
6. Invoke publish hooks (declaration order) with final state snapshot
7. Evaluate transitions
```

### CAN (OK)

- The runtime can build a `Scene` from the emitted HCL, mapping each `action "<actionId>"` block to an `Action` entry.
- The runtime can pass each action's canonical plain HCL `prog` block to `ctx()` to produce the action's `ContextSpec`.
- The runtime can resolve `prepare.from_state` bindings from the pre-action STATE snapshot into the action's state before the compute graph runs.
- The runtime can invoke `prepare.from_hook` hooks in declaration order before `executeGraph`, mapping returned object fields into state bindings.
- The runtime can invoke the same prepare hook once even when multiple bindings reference it, reusing the returned object for all mapping.
- The runtime can execute each action's `ContextSpec` via `executeGraph` to produce result `R_n` and merge delta `D_n`.
- The runtime can atomically apply `D_n` to STATE to produce `S_{n+1}`, writing only the declared `merge` output bindings.
- The runtime can invoke `publish` hooks in declaration order after merge, passing the complete final state.
- The runtime can silently skip any hook whose name has no registered implementation.
- The runtime can evaluate each transition's inline `prog` block by building a fresh `ContextSpec` for that transition, resolving ingresses from `R_n` (`fromAction`), `S_{n+1}` (`fromState`), or declared literals.
- The runtime can apply `first-match` or `all-match` transition policy, defaulting to `first-match` when neither action-level nor scene-level policy is set.
- When `all-match` selects multiple next actions, the runtime can execute them **sequentially in declaration order**, with each subsequent action seeing the STATE state produced by the prior action's merge.
- The runtime can enter terminal `completed` state when no transition rule matches.
- The runtime can enforce scene structural invariants and emit `SceneDiagnostic` entries for every failure (per `scene-graph.md` §7).

### CAN'T (NG)

- The runtime cannot begin executing actions if any scene structural invariant (per `scene-graph.md` §3.3) fails; it must set run status to `invalid_graph` and stop.
- The runtime cannot partially mutate STATE on action validation or execution failure; merge must not run if steps 1–4 fail.
- The runtime cannot allow a transition compute program to reference bindings from its parent action's `prog` block directly; ingress values must be explicitly declared via transition `prepare` entries.
- The runtime cannot apply merge deltas out of declaration order within a single action.
- The runtime cannot accept an unknown merge mode; it must fail pre-execution validation.
- The runtime cannot skip transition evaluation after a successful action execution.
- The runtime cannot change effect timing at runtime; timing is fixed by the emitted HCL declarations.
- The runtime cannot allow a prepare hook to mutate state directly; state writes occur only through the returned object mapped by the runtime.
- The runtime cannot allow a publish hook to mutate state; publish hooks are read-only with respect to action state.
- The runtime cannot change hook execution order at runtime; hooks execute in declaration order as emitted in HCL.
- Under `all-match`, the runtime cannot execute selected next actions concurrently; execution order is declaration order and each action merges before the next begins.

---

## STATE Effect Semantics

> **See also**: `effect-dsl-spec.md` — full specification of the Turn DSL sigil and `prepare`/`merge` section syntax that authors use to declare STATE effects, and their lowering rules to the canonical HCL shape.

| Phase | Direction | Mechanism |
|-------|-----------|-----------|
| prepare | STATE → state | STATE path resolved from `S_n` snapshot into state binding |
| prepare | hook → state | Hook invoked; returned object fields mapped into state bindings |
| merge | state → STATE | `D_n` applied atomically via `replace-by-id` merge to produce `S_{n+1}` |
| publish | state → hook | Publish hooks receive complete final state snapshot (read-only) |

### CAN (OK)

- An action can declare multiple prepare input bindings, each reading from a distinct STATE dotted path or hook.
- An action can declare multiple merge output bindings, each writing to a distinct STATE dotted path.
- An action can declare multiple publish hooks; each receives the full final state.
- Transition ingress can read from action output (`fromAction`) and from post-merge STATE (`fromState`) in the same rule.
- STATE keys not present in `D_n` remain unchanged after merge.

### CAN'T (NG)

- An action compute graph cannot mutate STATE directly during execution; all STATE writes must go through the declared merge step.
- A transition compute program cannot write to STATE; it can only read from `R_n` and `S_{n+1}`.
- Prepare inputs must not be resolved from `S_{n+1}` (post-merge state); they must use the `S_n` snapshot taken before execution.
- Effect bindings cannot bypass the convert-time STATE path declarations; the runtime cannot introduce ad-hoc STATE paths not declared in the emitted HCL.
- Publish hooks cannot mutate state.

---

## Correlation Between CAN and CAN'T

- Because the Go CLI lowers all DSL surface forms to canonical plain HCL at convert time, the TypeScript runtime can use a stock HCL parser with no DSL awareness.
- Because effect timing is fixed in the emitted HCL (`prepare`/`merge`/`publish` sub-blocks), the runtime enforces a strict `prepare → compute → merge → publish` ordering without needing to inspect DSL intent at runtime.
- Because STATE merge is atomic and the runtime must not partially mutate on failure, retry safety holds without distributed coordination.
- Because transition compute programs are isolated `prog` blocks with explicit ingress declarations, they can be validated independently at convert time.
- Because `all-match` sequential execution applies one merge at a time, STATE ordering is deterministic.
- Because publish hooks are read-only, state integrity after merge is guaranteed regardless of publish hook behavior.

---

## Resolved Decisions

| # | Decision | Resolution |
|---|----------|------------|
| 1 | Phase 2 constructs in Phase 1 file | **Hard error**: emit `UnsupportedConstruct` diagnostic and abort — no HCL is emitted. |
| 2 | Duplicate `action` block name labels | **Parse error**: fail with `DuplicateActionLabel` — last-wins is forbidden. |
| 3 | `div` fractional results | `binaryFnNumber::divide` may produce a fractional result. Since the DSL type `number` maps to JavaScript `number` (which accepts fractions), the result is stored as-is. Authors who require integer results should chain `.floor()` or `.round()` after division. |
| 4 | Parallel action scheduling under `all-match` | **Sequential, declaration order**: selected next actions run one at a time; each sees the STATE state produced by the previous action's merge. |
| 5 | Entry action HCL declaration | `entryActionIds` are emitted as a top-level string-list attribute: `entry_actions = ["<actionId>", ...]` at the top of the scene block. |
| 6 | Missing STATE path at runtime | Error code `MissingStatePath`. `SceneDiagnostic` carries `path` (the missing dotted path) and `bindingName` in the `details` field. |

---

## Test Plan

### Domain categories

| Domain | Coverage target |
|--------|----------------|
| A. Convert — lowering | All DSL surface forms produce canonical plain HCL |
| B. Convert — prepare/merge blocks | `prepare` and `merge` sub-blocks emitted correctly with binding entries |
| B2. Convert — publish blocks | `publish` sub-blocks emitted with correct hook names in declaration order |
| C. Convert — error paths | All converter error codes abort without partial HCL |
| D. Runtime — scene loading | `action` blocks map to `Action` entries correctly |
| E. Runtime — prepare phase | `from_state` resolved before compute; `from_hook` invoked and mapped |
| E2. Runtime — hook execution | Prepare hooks fire before graph; publish hooks fire after merge; unregistered hooks skipped |
| F. Runtime — execution ordering | prepare → compute → merge → publish ordering enforced |
| G. Runtime — transition semantics | `first-match`, `all-match`, no-match, sequential ordering |
| H. Runtime — merge semantics | `replace-by-id` atomicity, unknown mode rejection |
| I. Runtime — structural invariants | All `scene-graph.md §3.3` invariants trigger `invalid_graph` |

### Critical paths (idempotency)

| # | Path | Idempotency check |
|---|------|------------------|
| 1 | Turn DSL → Convert → HCL → Runtime → STATE | Re-run identical DSL input, compare final STATE state byte-for-byte |
| 2 | Prepare `from_state` path resolves from `S_n`, not `S_{n+1}` | Execute action twice with same `S_n`; assert identical state bindings both times |
| 3 | Merge is atomic: either all `D_n` keys written or none | Inject failure after partial write; assert STATE unchanged |
| 4 | `all-match` sequential ordering: action B sees A's merge | Assert STATE after A is visible to B; assert B's delta builds on A's output |
| 5 | Transition ingress uses `S_{n+1}` (post-merge), not `S_n` | Verify `fromState` reflects A's merged output, not pre-merge snapshot |
| 6 | Same preconditions produce identical `R_n`, `D_n`, next action IDs | Re-execute scene from same `S_n` and inputs; assert identical outputs |
| 7 | Prepare hook return value → state binding visible to compute graph | Same hook impl + same `S_n` → identical graph input and result both runs |
| 8 | Publish hook receives state after merge | Same action state → identical state delivered to publish hook both runs |

### Edge cases

| Case | Expected behaviour |
|------|--------------------|
| Turn DSL contains `range(n)` (Phase 2) | `UnsupportedConstruct` error, no HCL emitted |
| Two `action` blocks with identical name labels | `DuplicateActionLabel` error |
| `prepare` binding name not present as a `binding` block | `UnresolvedPrepareBinding` error at convert time |
| `from_state = "foo..bar"` (empty segment) | `InvalidStatePath` error |
| `div` binding result stored in `:number` field | Valid; `number` type accepts fractional results — authors may chain `.floor()` or `.round()` if integer semantics needed |
| `all-match` selects 0 next actions | Enter terminal `completed` state |
| `all-match` selects 3 actions; action 2 fails execution | Action 3 does not run; no partial STATE mutation from action 2 |
| Unknown merge mode in action | Fail pre-execution validation; `invalid_graph` |
| Transition `compute.condition` resolves to `int`, not `bool` | `SCN_INVALID_CONTEXT` at scene validation; `invalid_graph` |
| `fromState` path not present in `S_{n+1}` and `required = true` | `MissingStatePath` runtime error; `SceneDiagnostic` carries `path` and `bindingName` in `details` |
| `all-match` with no transitions declared | Enter terminal `completed` state |
| Prepare hook unregistered | Silently skipped; binding value remains default or STATE-resolved |
| Publish hook returns a value | Return value ignored; state unchanged |

### Resolved points

- **Entry action HCL declaration**: `entryActionIds` are emitted as a top-level string-list attribute at the top of the scene block: `entry_actions = ["<actionId>", ...]`.
- **`fromState` missing-path behavior**: When a dotted STATE path does not exist in `S_{n+1}` and `required = true`, the runtime emits a `MissingStatePath` error. The `SceneDiagnostic` for this error carries `path` (the missing dotted path string) and `bindingName` (the binding that declared it) in the `details` field.
- **`div_floor` alias**: No longer a priority — `number` type natively accepts fractional results. A convenience alias may still be added but is not required for correctness.

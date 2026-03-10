# Convert–Runtime Pipeline Specification

> **Status**: Draft for implementation
> **Scope**: Two-phase pipeline from Turn DSL authoring to TypeScript runtime execution, including SSOT effect semantics

---

## Overview

The pipeline has two sequential phases:

1. **Convert phase** — A Go CLI reads Turn DSL and emits canonical plain HCL files that conform to `hcl-context-spec.md`.
2. **Runtime phase** — A TypeScript runtime reads the emitted HCL, prepares a `ContextSpec` via `ctx()`, and executes it through the step execution API. Each action's result is merged into SSOT at the timing declared in the Turn DSL.

```
Turn DSL  ──[Go CLI]──>  HCL file  ──[TypeScript runtime]──>  SSOT mutations
```

---

## Phase 1: Convert (Go CLI)

### Responsibilities

- Parse Turn DSL source.
- Lower DSL constructs to canonical plain HCL (per `hcl-context-spec.md` lowering rules).
- Emit one `prog "<actionId>" { ... }` block per declared action compute graph, nested inside an `action "<actionId>" { compute { ... } prepare { ... } merge { ... } publish { ... } }` block.
- Emit inline transition `prog` blocks for each next-rule compute program.
- Emit SSOT effect declarations (`prepare` and `merge` sub-blocks) at action level.
- Emit `publish` sub-block for any publish-phase hook declarations.
- Validate DSL syntax and type rules before emitting any HCL.

### Action HCL Shape

```hcl
action "checkout" {
  compute {
    root = "order_id"
    prog "checkout_graph" {
      binding "cart_items" {
        type  = "string"
        value = ""
      }
      binding "order_id" {
        type  = "string"
        expr  = { combine = { fn = "build_order" args = [{ ref = "cart_items" }] } }
      }
    }
  }

  prepare {
    binding "cart_items" { from_ssot = "session.cart.items" }
  }

  merge {
    binding "order_id" { to_ssot = "order.id" }
  }

  publish {
    hook = "order_audit"
  }
}
```

Rules:
- `prepare` entries declare SSOT inputs (`from_ssot`) or hook inputs (`from_hook`) for `~>` and `<~>` sigiled bindings.
- `merge` entries declare SSOT outputs (`to_ssot`) for `<~` and `<~>` sigiled bindings.
- `publish` entries declare publish-phase hook names; multiple `hook` attributes are allowed.
- Every binding name inside `prepare` or `merge` must also appear as a `binding` block in the same `prog` block.
- `ssot_path` / dotted path values are composed of `[A-Za-z_][A-Za-z0-9_]*` segments separated by `.`.
- Timing is fixed at convert time: `prepare` bindings are resolved before execution; `merge` bindings are written after execution; `publish` hooks fire after merge.

### CAN (OK)

- The Go CLI can accept Turn DSL surface syntax including typed keys (`name:type`), function call expressions, parse-safe infix expressions (`=`), `#pipe`, `cond`, and `#if`.
- The Go CLI can lower all surface DSL forms to canonical plain HCL `binding` blocks, identically to the rules in `hcl-context-spec.md` §2–3.
- The Go CLI can emit compatibility input forms (`{ fn = [x, y] }`, `pipe(...)`) when an intermediate representation requires them, provided they are normalized before final HCL output.
- The Go CLI can emit multiple `action` blocks in one HCL file — one per declared action — as long as each block has a distinct name label matching its `actionId`.
- The Go CLI can declare SSOT effect bindings inside action blocks using `prepare` and `merge` sub-blocks.
- The Go CLI can emit `publish` sub-blocks with one or more `hook` attributes per action.
- The Go CLI can emit `prepare` entries with `from_hook` for prepare-phase hook bindings (per `hook-spec.md`).
- The Go CLI can report parse and type errors (per the error catalogue in `hcl-context-spec.md` §5 and the extended catalogue below) and abort without emitting partial HCL.
- The Go CLI can validate that every transition `compute.root` binding resolves to a `bool` at convert time.

### CAN'T (NG)

- The Go CLI cannot emit `name:type` as attribute keys in the canonical HCL output; typed keys must be lowered to `binding "<name>" { type = "..." ... }` blocks.
- The Go CLI cannot emit bare identifiers in argument positions; all references must be lowered to `{ ref = "name" }`, `{ func_ref = "..." }`, `{ step_ref = N }`, or `{ transform = { ... } }` forms.
- The Go CLI cannot emit Phase 2 loop constructs (`range`, `map`, `filter`, `fold`) in Phase 1 output; encountering them **must produce an `UnsupportedConstruct` error** and abort without emitting any HCL.
- The Go CLI cannot emit HCL that is not parseable by a stock HCL parser.
- The Go CLI cannot emit a file in which two `action` blocks share the same name label.
- Effect timing cannot be inferred at runtime; it must be fixed in the emitted HCL at convert time as declared in the Turn DSL.
- The Go CLI cannot emit a `prepare` or `merge` binding whose name does not match an existing `binding` block in the same `prog`.
- The Go CLI cannot emit a `from_ssot` or `to_ssot` value that is not a valid dotted identifier path.
- The Go CLI cannot emit a `prepare` entry with both `from_ssot` and `from_hook` on the same binding (`InvalidPrepareSource`).
- The Go CLI cannot emit a `from_hook` binding name in a transition `prepare` block (`TransitionHook`).
- The Go CLI cannot emit `merge` or `publish` blocks inside a transition `next` block.

### Convert-phase Error Catalogue

In addition to the error codes in `hcl-context-spec.md` §5, the converter must emit:

| Error code | Trigger condition |
|------------|------------------|
| `UnsupportedConstruct` | Phase 2 loop construct (`range`, `map`, `filter`, `fold`) encountered in a Phase 1 DSL file |
| `DuplicateActionLabel` | Two `action` blocks with the same name label in one emitted HCL file |
| `InvalidSsotPath` | `from_ssot` or `to_ssot` value is not a valid dotted identifier path |
| `UnresolvedPrepareBinding` | `prepare` binding name has no matching `binding` block in the same `prog` |
| `UnresolvedMergeBinding` | `merge` binding name has no matching `binding` block in the same `prog` |
| `MissingPrepareEntry` | A `~>` or `<~>` sigiled binding has no corresponding `prepare` entry |
| `MissingMergeEntry` | A `<~` or `<~>` sigiled binding has no corresponding `merge` entry |
| `InvalidPrepareSource` | A `prepare` entry carries both `from_ssot` and `from_hook` |
| `TransitionHook` | A `from_hook` source appears in a transition `prepare` block |
| `TransitionMerge` | A `merge` or `publish` block appears inside a `next { }` block |

---

## Phase 2: Runtime (TypeScript)

### Responsibilities

- Parse the emitted HCL and construct a `Scene` (per `scene-graph.md` §3.2).
- For each action, pass its `prog` block to `ctx()` to obtain a `ContextSpec`.
- Validate scene structural invariants (per `scene-graph.md` §3.3) before first execution.
- Execute actions following the four-phase lifecycle: **prepare → compute → merge → publish**.
- Atomically merge the action result delta into SSOT.
- Evaluate transition compute programs using post-merge SSOT and action output.
- Enqueue selected next action(s) according to the transition policy.

### Execution Order (per action)

```
1. Resolve prepare.from_ssot bindings from SSOT snapshot S_n
2. Invoke prepare hooks (declaration order); collect returned objects
3. Map hook result fields into state bindings
4. Execute compute graph (executeGraph)
5. Apply merge.to_ssot → produce SSOT delta D_n; apply atomically → S_{n+1}
6. Invoke publish hooks (declaration order) with final state snapshot
7. Evaluate transitions
```

### CAN (OK)

- The runtime can build a `Scene` from the emitted HCL, mapping each `action "<actionId>"` block to an `Action` entry.
- The runtime can pass each action's canonical plain HCL `prog` block to `ctx()` to produce the action's `ContextSpec`.
- The runtime can resolve `prepare.from_ssot` bindings from the pre-action SSOT snapshot into the action's state before the compute graph runs.
- The runtime can invoke `prepare.from_hook` hooks in declaration order before `executeGraph`, mapping returned object fields into state bindings.
- The runtime can invoke the same prepare hook once even when multiple bindings reference it, reusing the returned object for all mapping.
- The runtime can execute each action's `ContextSpec` via `executeGraph` to produce result `R_n` and merge delta `D_n`.
- The runtime can atomically apply `D_n` to SSOT to produce `S_{n+1}`, writing only the declared `merge` output bindings.
- The runtime can invoke `publish` hooks in declaration order after merge, passing the complete final state.
- The runtime can silently skip any hook whose name has no registered implementation.
- The runtime can evaluate each transition's inline `prog` block by building a fresh `ContextSpec` for that transition, resolving ingresses from `R_n` (`fromAction`), `S_{n+1}` (`fromSsot`), or declared literals.
- The runtime can apply `first-match` or `all-match` transition policy, defaulting to `first-match` when neither action-level nor scene-level policy is set.
- When `all-match` selects multiple next actions, the runtime can execute them **sequentially in declaration order**, with each subsequent action seeing the SSOT state produced by the prior action's merge.
- The runtime can enter terminal `completed` state when no transition rule matches.
- The runtime can enforce scene structural invariants and emit `SceneDiagnostic` entries for every failure (per `scene-graph.md` §7).

### CAN'T (NG)

- The runtime cannot begin executing actions if any scene structural invariant (per `scene-graph.md` §3.3) fails; it must set run status to `invalid_graph` and stop.
- The runtime cannot partially mutate SSOT on action validation or execution failure; merge must not run if steps 1–4 fail.
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

## SSOT Effect Semantics

> **See also**: `effect-dsl-spec.md` — full specification of the Turn DSL sigil and `prepare`/`merge` section syntax that authors use to declare SSOT effects, and their lowering rules to the canonical HCL shape.

| Phase | Direction | Mechanism |
|-------|-----------|-----------|
| prepare | SSOT → state | SSOT path resolved from `S_n` snapshot into state binding |
| prepare | hook → state | Hook invoked; returned object fields mapped into state bindings |
| merge | state → SSOT | `D_n` applied atomically via `replace-by-id` merge to produce `S_{n+1}` |
| publish | state → hook | Publish hooks receive complete final state snapshot (read-only) |

### CAN (OK)

- An action can declare multiple prepare input bindings, each reading from a distinct SSOT dotted path or hook.
- An action can declare multiple merge output bindings, each writing to a distinct SSOT dotted path.
- An action can declare multiple publish hooks; each receives the full final state.
- Transition ingress can read from action output (`fromAction`) and from post-merge SSOT (`fromSsot`) in the same rule.
- SSOT keys not present in `D_n` remain unchanged after merge.

### CAN'T (NG)

- An action compute graph cannot mutate SSOT directly during execution; all SSOT writes must go through the declared merge step.
- A transition compute program cannot write to SSOT; it can only read from `R_n` and `S_{n+1}`.
- Prepare inputs must not be resolved from `S_{n+1}` (post-merge state); they must use the `S_n` snapshot taken before execution.
- Effect bindings cannot bypass the convert-time SSOT path declarations; the runtime cannot introduce ad-hoc SSOT paths not declared in the emitted HCL.
- Publish hooks cannot mutate state.

---

## Correlation Between CAN and CAN'T

- Because the Go CLI lowers all DSL surface forms to canonical plain HCL at convert time, the TypeScript runtime can use a stock HCL parser with no DSL awareness.
- Because effect timing is fixed in the emitted HCL (`prepare`/`merge`/`publish` sub-blocks), the runtime enforces a strict `prepare → compute → merge → publish` ordering without needing to inspect DSL intent at runtime.
- Because SSOT merge is atomic and the runtime must not partially mutate on failure, retry safety holds without distributed coordination.
- Because transition compute programs are isolated `prog` blocks with explicit ingress declarations, they can be validated independently at convert time.
- Because `all-match` sequential execution applies one merge at a time, SSOT ordering is deterministic.
- Because publish hooks are read-only, state integrity after merge is guaranteed regardless of publish hook behavior.

---

## Resolved Decisions

| # | Decision | Resolution |
|---|----------|------------|
| 1 | Phase 2 constructs in Phase 1 file | **Hard error**: emit `UnsupportedConstruct` diagnostic and abort — no HCL is emitted. |
| 2 | Duplicate `action` block name labels | **Parse error**: fail with `DuplicateActionLabel` — last-wins is forbidden. |
| 3 | `div` integer safety | `binaryFnNumber::divide` produces a float; `:int` on a `div` binding is **advisory only**. A `div_floor` alias may be added in a future revision. |
| 4 | Parallel action scheduling under `all-match` | **Sequential, declaration order**: selected next actions run one at a time; each sees the SSOT state produced by the previous action's merge. |

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
| E. Runtime — prepare phase | `from_ssot` resolved before compute; `from_hook` invoked and mapped |
| E2. Runtime — hook execution | Prepare hooks fire before graph; publish hooks fire after merge; unregistered hooks skipped |
| F. Runtime — execution ordering | prepare → compute → merge → publish ordering enforced |
| G. Runtime — transition semantics | `first-match`, `all-match`, no-match, sequential ordering |
| H. Runtime — merge semantics | `replace-by-id` atomicity, unknown mode rejection |
| I. Runtime — structural invariants | All `scene-graph.md §3.3` invariants trigger `invalid_graph` |

### Critical paths (idempotency)

| # | Path | Idempotency check |
|---|------|------------------|
| 1 | Turn DSL → Convert → HCL → Runtime → SSOT | Re-run identical DSL input, compare final SSOT state byte-for-byte |
| 2 | Prepare `from_ssot` path resolves from `S_n`, not `S_{n+1}` | Execute action twice with same `S_n`; assert identical state bindings both times |
| 3 | Merge is atomic: either all `D_n` keys written or none | Inject failure after partial write; assert SSOT unchanged |
| 4 | `all-match` sequential ordering: action B sees A's merge | Assert SSOT after A is visible to B; assert B's delta builds on A's output |
| 5 | Transition ingress uses `S_{n+1}` (post-merge), not `S_n` | Verify `fromSsot` reflects A's merged output, not pre-merge snapshot |
| 6 | Same preconditions produce identical `R_n`, `D_n`, next action IDs | Re-execute scene from same `S_n` and inputs; assert identical outputs |
| 7 | Prepare hook return value → state binding visible to compute graph | Same hook impl + same `S_n` → identical graph input and result both runs |
| 8 | Publish hook receives state after merge | Same action state → identical state delivered to publish hook both runs |

### Edge cases

| Case | Expected behaviour |
|------|--------------------|
| Turn DSL contains `range(n)` (Phase 2) | `UnsupportedConstruct` error, no HCL emitted |
| Two `action` blocks with identical name labels | `DuplicateActionLabel` error |
| `prepare` binding name not present as a `binding` block | `UnresolvedPrepareBinding` error at convert time |
| `from_ssot = "foo..bar"` (empty segment) | `InvalidSsotPath` error |
| `div` binding with `:int` type | Advisory; runtime produces float — document and do not coerce |
| `all-match` selects 0 next actions | Enter terminal `completed` state |
| `all-match` selects 3 actions; action 2 fails execution | Action 3 does not run; no partial SSOT mutation from action 2 |
| Unknown merge mode in action | Fail pre-execution validation; `invalid_graph` |
| Transition `compute.root` resolves to `int`, not `bool` | `SCN_INVALID_CONTEXT` at scene validation; `invalid_graph` |
| `fromSsot` path not present in `S_{n+1}` and `required = true` | Transition ingress resolution error at runtime |
| `all-match` with no transitions declared | Enter terminal `completed` state |
| Prepare hook unregistered | Silently skipped; binding value remains default or SSOT-resolved |
| Publish hook returns a value | Return value ignored; state unchanged |

### Remaining open points

- **Entry action HCL declaration**: The Turn DSL mechanism for declaring `entryActionIds` is not yet specified.
- **`fromSsot` missing-path behavior**: When a dotted SSOT path does not exist in `S_{n+1}` and `required = true`, the exact error code and `SceneDiagnostic` shape are not yet specified.
- **`div_floor` alias**: Decide whether to add a `div_floor` built-in alias in a future revision of `hcl-context-spec.md`.

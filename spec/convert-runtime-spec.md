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
- Emit one `prog "<actionId>" { ... }` block per declared action compute graph.
- Emit inline `prog` blocks for each transition compute program.
- Emit SSOT effect declarations (output binding → SSOT path mappings) and effect timing markers inside each `prog` block.
- Validate DSL syntax and type rules before emitting any HCL.

### SSOT Effect Binding HCL Shape

SSOT effect declarations are nested **inside** the action's `prog` block, under `ssot_input` (pre-action) and `ssot_output` (post-action) sub-blocks:

```hcl
prog "checkout" {
  ssot_input {
    binding "cart_items" {
      ssot_path = "session.cart.items"
    }
  }
  ssot_output {
    binding "order_id" {
      ssot_path = "order.id"
    }
  }

  # compute bindings follow
  binding "total" {
    type  = "int"
    value = 0
  }
}
```

Rules:
- `ssot_path` values are **dotted paths** composed of `[A-Za-z_][A-Za-z0-9_]*` segments separated by `.` (e.g. `"session.cart.items"`, `"order.id"`).
- Every binding name inside `ssot_input` or `ssot_output` must also appear as a `binding` block in the same `prog` block.
- Timing is fixed at convert time: `ssot_input` bindings are resolved from `S_n` (pre-execution snapshot); `ssot_output` bindings are written to `S_{n+1}` (post-merge).
- There is no runtime inference of timing — the distinction is entirely structural in the emitted HCL.

### CAN (OK)

- The Go CLI can accept Turn DSL surface syntax including typed keys (`name:type`), function call expressions, parse-safe infix expressions (`=|`), `#pipe`, `cond`, and `#if`.
- The Go CLI can lower all surface DSL forms to canonical plain HCL `binding` blocks, identically to the rules in `hcl-context-spec.md` §2–3.
- The Go CLI can emit compatibility input forms (`{ fn = [x, y] }`, `pipe(...)`) when an intermediate representation requires them, provided they are normalized before final HCL output.
- The Go CLI can emit multiple `prog` blocks in one HCL file — one per action — as long as each block has a distinct name label matching its `actionId`.
- The Go CLI can declare SSOT effect bindings inside `prog` blocks using `ssot_input` and `ssot_output` sub-blocks.
- The Go CLI can declare effect timing for each action: `ssot_input` (SSOT → action input before execution) or `ssot_output` (action output → SSOT after merge).
- The Go CLI can emit `hook` sub-blocks inside a `prog` block — one per `hook` declaration in the Turn DSL — preserving name label, `timing`, and `affect` binding names in declaration order (per `hook-spec.md` §2).
- The Go CLI can report parse and type errors (per the error catalogue in `hcl-context-spec.md` §5 and the extended catalogue below) and abort without emitting partial HCL.
- The Go CLI can validate that every transition `compute.root` binding resolves to a `bool` at convert time.

### CAN'T (NG)

- The Go CLI cannot emit `name:type` as attribute keys in the canonical HCL output; typed keys must be lowered to `binding "<name>" { type = "..." ... }` blocks.
- The Go CLI cannot emit bare identifiers in argument positions; all references must be lowered to `{ ref = "name" }`, `{ func_ref = "..." }`, `{ step_ref = N }`, or `{ transform = { ... } }` forms.
- The Go CLI cannot emit Phase 2 loop constructs (`range`, `map`, `filter`, `fold`) in Phase 1 output; encountering them **must produce an `UnsupportedConstruct` error** and abort without emitting any HCL (see resolved Open Decision 1).
- The Go CLI cannot emit HCL that is not parseable by a stock HCL parser.
- The Go CLI cannot emit a file in which two `prog` blocks share the same name label.
- Effect timing cannot be inferred at runtime; it must be fixed in the emitted HCL at convert time as declared in the Turn DSL.
- The Go CLI cannot emit an `ssot_input` or `ssot_output` binding whose name does not match an existing `binding` block in the same `prog`.
- The Go CLI cannot emit a `ssot_path` that is not a valid dotted identifier path.
- The Go CLI cannot emit two `hook` sub-blocks with the same name label in the same `prog` block (`DuplicateHookLabel`).
- The Go CLI cannot emit a `hook` sub-block with a `timing` value other than `"pre"` or `"post"` (`InvalidHookTiming`).
- The Go CLI cannot emit a `hook` sub-block whose `affect` binding name does not match an existing `binding` block in the same `prog` (`UnresolvedHookAffectBinding`).
- The Go CLI cannot emit a `hook` sub-block inside a transition `prog` block (`TransitionHook`).

### Convert-phase Error Catalogue

In addition to the error codes in `hcl-context-spec.md` §5, the converter must emit:

| Error code | Trigger condition |
|------------|------------------|
| `UnsupportedConstruct` | Phase 2 loop construct (`range`, `map`, `filter`, `fold`) encountered in a Phase 1 DSL file |
| `DuplicateProgLabel` | Two `prog` blocks with the same name label in one emitted HCL file |
| `InvalidSsotPath` | `ssot_path` value is not a valid dotted identifier path |
| `UnresolvedSsotBinding` | `ssot_input`/`ssot_output` binding name has no matching `binding` block in the same `prog` |
| `DuplicateHookLabel` | Two `hook` sub-blocks with the same name label in one `prog` block |
| `InvalidHookTiming` | `hook` sub-block `timing` value is not `"pre"` or `"post"` |
| `UnresolvedHookAffectBinding` | A `hook` affect binding name has no matching `binding` block in the same `prog` |
| `TransitionHook` | A `hook` block appears inside a `next { }` transition block |

---

## Phase 2: Runtime (TypeScript)

### Responsibilities

- Parse the emitted HCL and construct a `Scene` (per `scene-graph.md` §3.2).
- For each action, pass its `prog` block to `ctx()` to obtain a `ContextSpec`.
- Validate scene structural invariants (per `scene-graph.md` §3.3) before first execution.
- Execute each action's compute graph via the step execution API (`executeGraph`).
- Atomically merge the action result delta into SSOT.
- Evaluate transition compute programs using post-merge SSOT and action output.
- Enqueue selected next action(s) according to the transition policy.

### CAN (OK)

- The runtime can build a `Scene` from the emitted HCL, mapping each `prog "<actionId>"` block to an `Action` entry.
- The runtime can pass each action's canonical plain HCL `prog` block to `ctx()` to produce the action's `ContextSpec`.
- The runtime can resolve SSOT effect input bindings from the pre-action SSOT snapshot into the action's `inputBindings`.
- The runtime can execute each action's `ContextSpec` via `executeGraph` to produce result `R_n` and merge delta `D_n`.
- The runtime can execute `pre` hooks for an action in declaration order before `executeGraph`, allowing each registered hook to read and write its declared `affect` bindings (per `hook-spec.md` §3).
- The runtime can execute `post` hooks for an action in declaration order after `executeGraph`, allowing each registered hook to read and override result bindings before `D_n` is built.
- The runtime can silently skip any hook whose name has no registered implementation.
- The runtime can atomically apply `D_n` to SSOT to produce `S_{n+1}`, writing only the declared effect output bindings.
- The runtime can evaluate each transition's inline `prog` block by building a fresh `ContextSpec` for that transition, resolving ingresses from `R_n` (`fromAction`), `S_{n+1}` (`fromSsot`), or declared literals.
- The runtime can apply `first-match` or `all-match` transition policy, defaulting to `first-match` when neither action-level nor scene-level policy is set.
- When `all-match` selects multiple next actions, the runtime can execute them **sequentially in declaration order**, with each subsequent action seeing the SSOT state produced by the prior action's merge (see resolved Open Decision 4).
- The runtime can enter terminal `completed` state when no transition rule matches.
- The runtime can enforce scene structural invariants and emit `SceneDiagnostic` entries for every failure (per `scene-graph.md` §7).
- The runtime can fail with `DuplicateProgLabel` if two `prog` blocks share the same name label (defensive check, since the converter is already forbidden from emitting this).
- If `view` is present, the runtime can enforce the Overview DSL topology contract at the configured mode (`nodes_only`, `at_least`, or `strict`).

### CAN'T (NG)

- The runtime cannot begin executing actions if any scene structural invariant (per `scene-graph.md` §3.3) fails; it must set run status to `invalid_graph` and stop.
- The runtime cannot partially mutate SSOT on action validation or execution failure; merge must not run if steps 4 or 5 fail (per `scene-graph.md` §4).
- The runtime cannot allow a transition compute program to reference bindings from its parent action's `prog` block directly; ingress values must be explicitly declared via `TransitionIngressBinding`.
- The runtime cannot apply merge deltas out of declaration order within a single action; `replace-by-id` must write all keys in `D_n` before any transition is evaluated.
- The runtime cannot accept an unknown merge mode; it must fail pre-execution validation.
- The runtime cannot skip transition evaluation after a successful action execution.
- The runtime cannot change effect timing at runtime; timing is fixed by the emitted HCL declarations.
- The runtime cannot allow a hook implementation to `get()` or `set()` a binding not declared in its `affect` block; such access is a runtime error and aborts action execution.
- The runtime cannot allow a `post` hook to write to SSOT directly; all writes must go through the declared merge step.
- The runtime cannot change hook execution order at runtime; hooks execute in declaration order as emitted in HCL.
- Under `all-match`, the runtime cannot execute selected next actions concurrently; execution order is declaration order and each action merges before the next begins.

---

## SSOT Effect Semantics

> **See also**: `effect-dsl-spec.md` — full specification of the Turn DSL sigil and `io` block syntax that authors use to declare SSOT effects, and their lowering rules to the canonical HCL shape below.

| Timing | Direction | Mechanism |
|--------|-----------|-----------|
| Pre-action | SSOT → action input | SSOT path resolved from `S_n` snapshot into `inputBindings` |
| Post-action | action output → SSOT | `D_n` applied atomically via `replace-by-id` merge to produce `S_{n+1}` |

### CAN (OK)

- An action can declare multiple pre-action input bindings, each reading from a distinct SSOT dotted path.
- An action can declare multiple post-action output bindings, each writing to a distinct SSOT dotted path.
- Transition ingress can read from action output (`fromAction`) and from post-merge SSOT (`fromSsot`) in the same rule.
- SSOT keys not present in `D_n` remain unchanged after merge (per `scene-graph.md` §5.1).

### CAN'T (NG)

- An action compute graph cannot mutate SSOT directly during execution; all SSOT writes must go through the declared merge step.
- A transition compute program cannot write to SSOT; it can only read from `R_n` and `S_{n+1}`.
- Pre-action inputs must not be resolved from `S_{n+1}` (post-merge state); they must use the `S_n` snapshot taken before execution.
- Effect bindings cannot bypass the convert-time SSOT path declarations; runtime cannot introduce ad-hoc SSOT paths not declared in the emitted HCL.

---

## Correlation Between CAN and CAN'T

- Because the Go CLI lowers all DSL surface forms to canonical plain HCL at convert time, the TypeScript runtime can use a stock HCL parser with no DSL awareness — the constraint on the converter (no `name:type` keys in output) enables the simplicity constraint on the runtime (no DSL parsing required).
- Because effect timing is fixed in the emitted HCL (`ssot_input`/`ssot_output` sub-blocks), the runtime can enforce a strict snapshot→execute→merge→transition ordering without needing to inspect DSL intent at runtime.
- Because SSOT merge is atomic and the runtime must not partially mutate on failure, retry safety (per `scene-graph.md` §8) holds without distributed coordination.
- Because transition compute programs are isolated `prog` blocks with explicit ingress declarations, they can be validated independently at convert time, enabling the runtime to refuse execution of any scene that would produce an ambiguous or undefined transition result.
- Because `all-match` sequential execution applies one merge at a time, SSOT ordering is deterministic and each subsequent action observes up-to-date state without conflict resolution logic.

---

## Resolved Decisions

| # | Decision | Resolution |
|---|----------|------------|
| 1 | Phase 2 constructs in Phase 1 file | **Hard error**: emit `UnsupportedConstruct` diagnostic and abort — no HCL is emitted. |
| 2 | Duplicate `prog` block name labels | **Parse error**: fail with `DuplicateProgLabel` — last-wins is forbidden because the converter is already prohibited from emitting duplicates; this is a defensive invariant. |
| 3 | `div` integer safety | `binaryFnNumber::divide` produces a float; `:int` on a `div` binding is **advisory only**. A `div_floor` alias may be added in a future revision; until then, authors must apply `{ transform = { ref = "result", fn = "transformFnNumber::floor" } }` explicitly when integer truncation is required. |
| 4 | Parallel action scheduling under `all-match` | **Sequential, declaration order**: selected next actions run one at a time; each sees the SSOT state produced by the previous action's merge. |

---

## Test Plan

### Domain categories

| Domain | Coverage target |
|--------|----------------|
| A. Convert — lowering | All DSL surface forms produce canonical plain HCL |
| B. Convert — SSOT effect bindings | `ssot_input`/`ssot_output` sub-blocks emitted correctly |
| B2. Convert — hook sub-blocks | `hook` sub-blocks emitted with correct `timing` and `affect` bindings in declaration order |
| C. Convert — error paths | All converter error codes abort without partial HCL |
| D. Runtime — scene loading | `prog` blocks map to `Action` entries correctly |
| E. Runtime — effect binding resolution | Pre/post SSOT paths read/write at correct times |
| E2. Runtime — hook execution | Pre hooks fire before graph; post hooks fire after graph; unregistered hooks skipped |
| F. Runtime — execution ordering | snapshot → pre-hooks → execute → post-hooks → merge → transition |
| G. Runtime — transition semantics | `first-match`, `all-match`, no-match, sequential ordering |
| H. Runtime — merge semantics | `replace-by-id` atomicity, unknown mode rejection |
| I. Runtime — structural invariants | All `scene-graph.md §3.3` invariants trigger `invalid_graph` |

### Critical paths (idempotency)

| # | Path | Idempotency check |
|---|------|------------------|
| 1 | Turn DSL → Convert → HCL → Runtime → SSOT | Re-run identical DSL input, compare final SSOT state byte-for-byte |
| 2 | Pre-action `ssot_input` path resolves from `S_n`, not `S_{n+1}` | Execute action twice with same `S_n`; assert identical `inputBindings` both times |
| 3 | Post-action merge is atomic: either all `D_n` keys written or none | Inject failure after partial write; assert SSOT unchanged |
| 4 | `all-match` sequential ordering: action B sees A's merge | Assert SSOT after A is visible to B; assert B's delta builds on A's output |
| 5 | Transition ingress uses `S_{n+1}` (post-merge), not `S_n` | Verify `fromSsot` reflects A's merged output, not pre-merge snapshot |
| 6 | Same preconditions produce identical `R_n`, `D_n`, next action IDs | Re-execute scene from same `S_n` and ad hoc inputs; assert identical outputs |
| 7 | Pre-hook `set()` visible to compute graph | Same hook impl + same `S_n` → identical graph input and result both runs |
| 8 | Post-hook `set()` enters `D_n` and merges to SSOT | Same hook impl + same graph output → identical SSOT after merge both runs |

### Edge cases

| Case | Expected behaviour |
|------|--------------------|
| Turn DSL contains `range(n)` (Phase 2) | `UnsupportedConstruct` error, no HCL emitted |
| Two `prog` blocks with identical name labels | `DuplicateProgLabel` error |
| `ssot_input` binding name not present as a `binding` block | `UnresolvedSsotBinding` error at convert time |
| `ssot_path = "foo..bar"` (empty segment) | `InvalidSsotPath` error |
| `div` binding with `:int` type | Advisory; runtime produces float — document and do not coerce |
| `all-match` selects 0 next actions | Enter terminal `completed` state |
| `all-match` selects 3 actions; action 2 fails execution | Action 3 does not run; no partial SSOT mutation from action 2 |
| Unknown merge mode in action | Fail pre-execution validation; `invalid_graph` |
| Transition `compute.root` resolves to `int`, not `bool` | `SCN_INVALID_CONTEXT` at scene validation; `invalid_graph` |
| `fromSsot` path not present in `S_{n+1}` and `required = true` | Transition ingress resolution error at runtime |
| `all-match` with no transitions declared | Enter terminal `completed` state (equivalent to no-match) |

### Remaining open points

- **Entry action HCL declaration**: The Turn DSL mechanism for declaring `entryActionIds` is not yet specified — must be defined before the Scene construction step can be fully tested.
- **`fromSsot` missing-path behavior**: When a dotted SSOT path does not exist in `S_{n+1}` and `required = true`, the exact error code and `SceneDiagnostic` shape are not yet specified.
- **`div_floor` alias**: Decide whether to add a `div_floor` built-in alias in a future revision of `hcl-context-spec.md`.

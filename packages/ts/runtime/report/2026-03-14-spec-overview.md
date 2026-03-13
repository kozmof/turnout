# Spec Overview — Turnout

**Date:** 2026-03-14
**Project:** Turnout — Turn DSL Workflow Orchestration System
**Spec files analysed:** 7 markdown specs + 4 `.turn` example files

---

## Summary

Turnout is a declarative workflow orchestration system built around a custom DSL called **Turn**. Workflows are authored as scene graphs where each action embeds its own typed computation graph. The system follows a two-phase pipeline: a Go CLI converts Turn DSL to canonical HCL, which a TypeScript runtime then parses and executes. State is managed as immutable snapshots with atomic merges between actions.

---

## Spec Files

### 1. `effect-dsl-spec.md` — STATE Effect Declarations

Defines the surface syntax for declaring how an action reads from and writes to the global STATE object.

**Sigil forms:**

| Sigil | Direction | Meaning |
|-------|-----------|---------|
| `~>` | Input only | Pre-action STATE → local binding |
| `<~` | Output only | Local binding → post-action STATE |
| `<~>` | Bidirectional | Both input and output |

**Sections:**
- `prepare` block: maps STATE paths or hook names to local bindings (inputs)
- `merge` block: maps local bindings to STATE paths (outputs)
- Sigils annotate each binding inside `prog` to declare the direction

**Correspondence rules:** Every `~>` or `<~>` binding must have a matching `prepare` entry; every `<~` or `<~>` binding must have a matching `merge` entry. Violations produce compile-time errors.

**Lowering:** During conversion, sigils are stripped and the binding direction is encoded structurally in HCL via sub-block placement.

**Error catalogue:** 17 codes including `MissingPrepareEntry`, `DuplicatePrepareEntry`, `BidirMissingMergeEntry`, `OrphanPrepareEntry`.

---

### 2. `transform-fn-dsl-spec.md` — Transform Function DSL

Defines DSL surface syntax for per-value type-safe method calls applied to bound values.

**Method call syntax:** `value.method()` or chained: `value.method1().method2()`

**Available methods by type:**

| Type | Methods |
|------|---------|
| `number` | `.toStr()`, `.abs()`, `.floor()`, `.ceil()`, `.round()`, `.negate()` |
| `string` | `.toNumber()`, `.trim()`, `.toLowerCase()`, `.toUpperCase()`, `.length()` |
| `boolean` | `.not()`, `.toStr()` |
| `array` | `.length()`, `.isEmpty()` |
| `null` | *(none)* |

**Chaining rules:** Output type of each method must match input type of the next in chain. The internal `pass` identity function is not exposed at DSL surface.

---

### 3. `state-shape-spec.md` — STATE Object Declaration

Defines the declaration syntax, type system, initialization model, and runtime semantics for the global STATE object.

**Shape:** Two-level map `namespace.field` (e.g., `applicant.income`, `decision.approved`).

**DSL:**
```
state {
  namespace "applicant" {
    field "income"   { type = "int"  value = 0    }
    field "name"     { type = "str"  value = ""   }
  }
}
```

**Supported types:** `int`, `str`, `bool`, `arr<int>`, `arr<str>`, `arr<bool>`

**Runtime model:**
- `S_n` — immutable snapshot before action
- `D_n` — delta produced by action's compute graph
- `S_{n+1}` — post-action snapshot after atomic merge

**Key rules:**
- Every field requires an explicit default matching its declared type
- STATE fields are authoritative type constraints; merge bindings must conform
- External state can be referenced via `state_file` directive
- Merge strategy: replace-by-id

**Validation:** 10 runtime + 2 convert-time rules.
**Error catalogue:** 13 codes including `MissingStateSource`, `StateTypeMismatch`, `StateFieldAlreadyDeclared`.

---

### 4. `scene-graph.md` — Scene Orchestration

Defines the scene model: how multiple actions form a graph, how transitions are declared, and how the runtime executes the full lifecycle.

**Core concepts:**
- A **scene** contains a set of named actions with a declared entry point
- Each action has its own `compute` graph, `prepare` inputs, `merge` outputs, and `next` transition rules
- `next_policy`: `first-match` (stop at first true condition) or `all-match` (evaluate all)
- **Overview DSL**: optional `view` block with ASCII flow diagram; enforcement modes: `nodes_only`, `at_least`, `strict`

**Action lifecycle (8 steps):**
1. Snapshot S_n
2. Resolve prepare bindings (STATE + hooks)
3. Invoke prepare hooks
4. Map inputs into compute graph
5. Execute compute graph
6. Merge delta D_n → S_{n+1}
7. Invoke publish hooks
8. Evaluate next-rule conditions

**Validation:** 16 rules checked before execution.
**Diagnostics:** 10 minimum diagnostic codes (e.g., `SCN_INVALID_ACTION_GRAPH`, `SCN_MISSING_ENTRY_ACTION`).
**Conformance checklist:** 12 critical requirements.

---

### 5. `hcl-context-spec.md` — HCL Context DSL (Computation Graph)

Defines the typed-key DSL for declaring `ContextSpec` computation graphs — the core expression layer used inside each action's `prog` block.

**Architecture:** Surface DSL (authoring) → lowered to canonical plain HCL (Phase 1 only).

**Surface DSL constructs:**

| Construct | Example |
|-----------|---------|
| Typed key | `score:int = 42` |
| Function call | `add(a: score, b: bonus)` |
| Infix | `score >= threshold` |
| Pipe | `#pipe(x: val)[step1, step2]` |
| Conditional | `#if(cond, then, else)` |

**24 built-in binary functions:**

| Category | Functions |
|----------|-----------|
| Number | `add`, `sub`, `mul`, `div`, `mod`, `max`, `min`, `gt`, `gte`, `lt`, `lte` |
| String | `str_concat`, `str_includes`, `str_starts`, `str_ends` |
| Boolean | `bool_and`, `bool_or`, `bool_xor` |
| Generic | `eq`, `neq` |
| Array | `arr_includes`, `arr_get`, `arr_concat` |

**Reference forms:** `ValueRef`, `FuncRef`, `FuncOutputRef`, `StepOutputRef`, `TransformRef`

**Phase 2 (reserved, not yet implemented):** `range`, `map`, `filter`, `fold`

**Error catalogue:** 18 codes.

---

### 6. `hook-spec.md` — Hook Declarations

Defines the two hook types that extend action execution with external side effects.

**Prepare hooks** — fire before compute graph:
- Declared in `prepare` block: `from_hook = "<name>"`
- Return an object; fields are mapped into local state bindings
- Multiple bindings from the same hook → hook invoked once (deduplication)

**Publish hooks** — fire after merge:
- Declared in action: `hook = "<name>"`
- Receive the full final STATE snapshot (read-only)
- Used for external notifications, logging, downstream triggers

**TypeScript API:**
```ts
runtime.hook("my_hook", (ctx: PrepareHookContext) => { ... })
runtime.hook("my_pub", (ctx: PublishHookContext) => { ... })
```

**Key rules:**
- Unregistered hooks are silently skipped
- Prepare hooks: read-only access to STATE; cannot mutate
- Publish hooks: read-only; fires after S_{n+1} is committed

**Error catalogue:** 4 codes (`MissingHookField`, `InvalidPrepareSource`, `UnresolvedPrepareBinding`, `UnresolvedMergeBinding`).

---

### 7. `convert-runtime-spec.md` — Convert and Runtime Pipeline

Defines the two-phase architecture from Turn DSL authoring to TypeScript execution.

**Phase 1 — Convert (Go CLI):**
- Parses Turn DSL source files
- Validates syntax and types
- Lowers to canonical plain HCL per `hcl-context-spec` rules
- Emits action blocks with `compute`, `prepare`, `merge`, `publish` sub-blocks
- Hard error on any Phase 2 constructs in Phase 1 input

**Phase 2 — Runtime (TypeScript):**
- Parses emitted HCL into Scene model
- Builds `ContextSpec` via `ctx()` builder for each action
- Validates scene structural invariants
- Executes 4-phase lifecycle: prepare → compute → merge → publish

**Resolved design decisions:**
1. Phase 2 constructs in Phase 1 file → hard compile error
2. Duplicate action block names → parse error
3. `div` integer safety → advisory warning only (produces float)
4. Parallel `all-match` transitions → executed in declaration order

**Error catalogue:** Extended converter error codes (superset of other specs).
**Test plan:** Idempotency checks, round-trip validation, edge cases.

---

## Example Files

### `scene-graph-with-actions.turn` — Loan Approval

A minimal 3-action workflow: `score → approve | reject`.

- Demonstrates all three sigil forms (`~>`, `<~`, `<~>`)
- STATE namespaces: `applicant`, `decision`
- Transition: conditional approval branch, unconditional reject fallback

---

### `detective-phase.turn` — Detective Evidence Hunt

A complex 8-action investigation workflow demonstrating multi-branch convergence.

**Flow:**
```
arrive_crime_scene → scan_scene
scan_scene → collect_physical_evidence (conditional) | interview_witness (fallback)
collect_physical_evidence → interview_witness
interview_witness → analyze_timeline
analyze_timeline → identify_suspect (conditional) | search_for_more_evidence (fallback)
identify_suspect → submit_case_file
search_for_more_evidence → submit_case_file
```

**STATE namespaces:** `crime_scene`, `evidence`, `witness`, `leads`, `investigation`

**Notable patterns:**
- `from_action` in next-rule prepare (reads action-local output, not STATE)
- Convergence fan-in: two paths both reach `interview_witness` and `submit_case_file`
- `enforce = "at_least"` overview mode
- String concatenation via infix `+`

---

### `adventure-story-graph-with-actions.turn` — Adventure Story

A large 10-action story-branching game with parallel convergence paths.

**Flow:** `choose_route` branches into 4 paths (forest, city, sewer, campfire), each converging to one of 4 terminus actions.

**STATE namespaces:** `story`, `party`

**Notable patterns:**
- Complex multi-level transition conditions
- Threshold comparisons (`>= N`) driving story branches
- Array and string concatenation for narrative assembly
- `enforce = "at_least"` with dense overview diagram

---

### `llm-workflow-with-actions.turn` — LLM Support Workflow

A 7-action AI pipeline for processing and moderating LLM responses.

**Flow:**
```
analyze_request → retrieve_context (conditional) | draft_direct (fallback)
retrieve_context → draft_with_context
draft_direct | draft_with_context → safety_check
safety_check → publish_response (conditional) | human_review (fallback)
```

**STATE namespaces:** `request`, `runtime`, `workflow`, `moderation`, `conversation`, `review`

**Notable patterns:**
- Retrieval-augmented generation (RAG) branch
- Safety moderation gate with toxicity and PII scoring
- Human-in-the-loop fallback path
- `from_action` for passing compute results into transition conditions

---

## Cross-Cutting Observations

### Architecture Layers

```
Turn DSL source (.turn files)
        │
        ▼  [Go CLI converter]
Canonical HCL (lowered, plain)
        │
        ▼  [TypeScript runtime]
Scene model + ContextSpec
        │
        ▼  [Execution engine]
STATE snapshots S_n → S_{n+1}
```

### Spec Dependency Graph

```
scene-graph.md
  ├── hcl-context-spec.md   (computation graph inside each action)
  ├── effect-dsl-spec.md    (STATE sigils + prepare/merge)
  ├── state-shape-spec.md   (STATE schema and snapshot model)
  ├── hook-spec.md          (prepare + publish hooks)
  └── transform-fn-dsl-spec.md  (method calls inside prog bindings)

convert-runtime-spec.md
  └── depends on all of the above (pipeline integration)
```

### Implementation Status

| Spec | Status |
|------|--------|
| `hcl-context-spec.md` | Phase 1 ready; Phase 2 (loops) requires runtime extension |
| `convert-runtime-spec.md` | Draft for implementation |
| `state-shape-spec.md` | Draft for implementation |
| `effect-dsl-spec.md` | Draft for implementation |
| `hook-spec.md` | Draft for implementation |
| `transform-fn-dsl-spec.md` | Draft for implementation |
| `scene-graph.md` | Proposed spec for implementation |

### Key Design Principles

1. **Immutability** — STATE is never mutated in place; every action produces a new snapshot via atomic merge
2. **Locality** — each action's computation is fully described by its own `prog` block; no shared mutable scope
3. **Directionality** — sigils (`~>`, `<~`, `<~>`) make data flow explicit at the DSL surface
4. **Two-phase separation** — convert-time validation is strict; runtime never receives malformed HCL
5. **Determinism** — all-match transitions are sequential; hooks are deduplicated; no implicit ordering

# Design Discovery: Turnout

_2026-03-28_

---

## Overview

Turnout is a declarative workflow orchestration engine built around a custom DSL (`.turn` files). Its deepest design commitment is **explicitness**: every data movement, every branch, every effect must be named and directed. This shapes every layer of the system.

---

## Design Dimensions

### 1. Cross-Language Contract via Protobuf

**Intent:** The protobuf schema in `schema/turnout-model.proto` is the single source of truth for the intermediate representation. Both the Go compiler and the TypeScript executor are generated from it.

**How it deviates:** Most projects treat protobuf as a serialization detail. Here it's the *architectural center* — the schema defines what a valid program *is*, not just how it's transmitted. Go and TypeScript are downstream consumers of the schema, not co-designers of it.

**Momentum:** This creates strong gravitational pull toward the proto schema as the language of discourse for new features. Adding a new action type, compute function, or route strategy means extending the proto first, then both language implementations follow. The schema is the constitution; the implementations are legislation.

---

### 2. Multi-Stage Compilation Pipeline (Go)

**Intent:** The Go side implements a classical compiler pipeline: lexer → parser → AST → lowering → validation → emission. Each stage is a distinct transformation with its own data structures.

**How it deviates:** The pipeline is hand-written (no parser generators like ANTLR), which allows the DSL syntax to be closely tailored to domain vocabulary (`~>`, `<~>`, `from_hook`, `next`) rather than general-purpose grammar rules. The lowering stage (AST → `TurnModel`) is the normalization step where design intent is crystallized — ambiguities in the syntax become unambiguous in the model.

**Momentum:** The separation of lowering from parsing means the DSL surface can evolve (syntactic sugar, aliases, shorthand) without breaking the execution model. New syntax maps to existing model constructs. This enables safe language iteration.

---

### 3. Explicit Directionality via Sigils

**Intent:** Bindings in `.turn` files carry directionality markers (`~>` ingress, `<~` egress, `<~>` bidirectional). Prepare/merge blocks make data movement visible as a structural property of the action, not inferred from usage.

**How it deviates:** Most workflow and dataflow systems treat data movement as implicit (e.g., "assign X to Y"). Turnout makes it a first-class declaration. This is closer to hardware description languages (VHDL, Verilog) than to typical workflow DSLs.

**Momentum:** Explicitness compounds. Once direction is declared in the DSL, the executor can enforce it, the validator can check it, and tooling (LSP, linter) can surface violations. The VSCode extension is a natural extension of this — the language has enough structure to support semantic highlighting and diagnostics. Future monitoring/observability tooling would inherit this directionality for free.

---

### 4. Computation Graph as First-Class Primitive

**Intent:** `packages/ts/runtime` implements a pure, lazy, immutable computation graph. Nodes are bindings; edges are dependencies. The three function types — Combine (binary), Pipe (multi-step), Cond (ternary) — are deliberately minimal.

**How it deviates:** Most workflow engines embed scripting languages (JS, Python, Lua) for expression evaluation. Turnout replaces that with a closed, declarative graph. You cannot write arbitrary code inside a compute expression; you can only compose the provided primitives.

**Momentum:** The closed computation model is the engine's security and determinism guarantee. It enables full static analysis of what a program *can* compute before running it. The value tagging system (propagating `['random']`, `['network']` tags through operations) is a direct consequence — tags are provenance metadata that only makes sense when the computation is inspectable. This points toward future features like reproducibility guarantees, auditing, or differential execution.

---

### 5. Queue-Based Scheduling with Visited-Set Cycle Prevention

**Intent:** Scene execution uses an explicit work queue (initialized with entry actions) rather than a state machine or continuation. Next rules enqueue subsequent actions; a visited set prevents re-execution.

**How it deviates:** State machines require you to enumerate all states and transitions upfront. The queue model is more like a push-based task scheduler — actions declare what comes after them, but the executor decides the actual traversal. The visited-set approach is an approximation of "no cycles per scene" without requiring the author to prove acyclicity.

**Momentum:** The queue model enables `all-match` next policies naturally (multiple actions enqueued from one branching point) in a way that would require parallel state machine transitions. It also makes action traces easy to accumulate: each dequeue produces one trace entry. The tradeoff is that complex non-linear flows (e.g., rejoining branches) are not explicitly modeled — they emerge from queue semantics. Future expressiveness would likely require extending the queue model rather than replacing it.

---

### 6. History-Based Route Pattern Matching

**Intent:** `packages/ts/scene-runner/src/route/` matches against execution history (scene.action sequences) rather than against explicit "go to scene X" instructions. Patterns support exact, wildcard, and catchall forms with priority resolution.

**How it deviates:** Typical workflow orchestrators route explicitly (`if condition then goto SceneB`). Turnout routes *retrospectively* — "given what just happened, what should happen next?" This inverts the control structure. Scenes don't know about routes; routes observe scenes.

**Momentum:** Retrospective routing decouples scenes from orchestration logic entirely. A scene is a pure local computation; routing is a separate, composable layer above it. This makes scenes reusable across different routes. The design points toward route composition (routes that embed or extend other routes) and toward externally-observable execution traces as a debugging/monitoring primitive.

---

### 7. Value Tagging for Computation Provenance

**Intent:** Values carry a `tags` array that propagates through operations. Tags like `['random']` or `['network', 'cached']` mark the origin or quality of a value without changing its type or semantics.

**How it deviates:** Type systems typically track *what* a value is (int, string, etc.). Tag systems track *where it came from* or *what it's been through*. This is more like information flow tracking in security research than standard type theory.

**Momentum:** Tag propagation is the seed of a rich provenance system. A value that passed through a `network` hook carries that tag through all downstream computations. Future features could include: refusing to merge `random`-tagged values into deterministic state, auditing which outputs derive from external data, or replay/determinism checks that strip tagged values and re-evaluate. The infrastructure is in place; the policies that act on tags are the open frontier.

---

## Deep Dive: Fine-Grained Design Tensions

### 8. The Null Type Is a Semantic System, Not an Absence

Most languages treat `null` as "no value." Turnout's `null` carries a *reason*: `missing`, `not-found`, `error`, `filtered`, `redacted`, `unknown` (`packages/ts/runtime/src/state-control/value.ts`).

**What this reveals:** The computation graph is designed for data workflows where the *quality* of absence matters. `missing` (a prepare path that wasn't in STATE) and `redacted` (a value that exists but shouldn't be seen) are both "no value" but carry completely different semantics for downstream decisions. A next rule could branch on `null.reason == 'redacted'` just as naturally as on a boolean.

**Tension:** The null sub-symbol system exists in the runtime type but there's no DSL syntax yet to produce or pattern-match against specific null reasons. The infrastructure is ahead of the surface language. This is either intentional scaffolding or incubating capability that hasn't found its DSL form yet.

**Momentum:** The gap between runtime capability and DSL expressiveness is a design pressure. Either the DSL will grow null-reason syntax (`from_null_reason`, conditional on `is_redacted`, etc.) or the null sub-symbol system will be simplified to match what the language can actually produce.

---

### 9. The Operator Table Is a Closed World With Deliberate Holes

The validation layer (`packages/go/converter/internal/validate/validate.go`) maintains a table of exactly 27 built-in functions. The table has an `operatorOnly` flag — some functions can *only* be called as infix operators, never as `fn()` calls, and vice versa.

**The forbidden calls:**
- Operator-only: `add`, `sub`, `mul`, `div`, `mod`, `eq`, `neq`, `bool_and`, `bool_or`, `str_concat`, `gt`, `gte`, `lt`, `lte`
- Call-only: `max`, `min`, `str_includes`, `str_starts`, `str_ends`, `bool_xor`, `arr_includes`, `arr_get`, `arr_concat`

**What this reveals:** The distinction isn't technical — it's *cognitive*. Infix `a + b` and `add(a, b)` are the same operation, but the design enforces that you write the one that matches idiomatic human intent. `max(a, b)` should never become `a max b`. This is a legibility policy encoded in validation rules, not in type theory.

**The `+` operator is type-dispatched.** The lowering phase converts `a + b` to either `add` (number) or `str_concat` (string) based on operand types. This means `+` has no runtime representation — it's a syntactic convenience that dissolves during compilation. The DSL surface uses familiar notation; the IR is unambiguous.

**Momentum:** The closed-world assumption here is strong. Adding a new operation requires: (1) a table entry in validation, (2) a mapping in the HCL context builder, and (3) potentially a new infix or call-only surface form. The friction is intentional — new functions aren't cheap to add. This pushes expressiveness toward composition of existing primitives rather than proliferation of builtins.

---

### 10. The View Block Is an Embedded Specification Language

The `view` block in scenes takes a heredoc with `|=>` arrow syntax and an `enforce` flag.

```
view "loan-decision" {
  flow = <<-EOT
    collect_data |=> score_credit |=> approve
                               |=> reject
  EOT
  enforce = true
}
```

**What this reveals:** The view block is a *diagrammatic constraint* baked into the source file. When `enforce = true`, the declared flow is not just documentation — it's a contract the runtime or validator is expected to check. But the current validator doesn't fully process view blocks yet (they're preserved in the Model but enforcement logic is incomplete).

**Tension:** `enforce = true` exists in the DSL and proto schema, but the execution layer doesn't act on it yet. This is a forward declaration of an intent that hasn't been implemented. The `enforce` flag is either a future feature waiting for implementation or a currently-ignored affordance left in to avoid a schema migration later.

**Momentum:** If enforcement is implemented, the view block becomes a formal property of the scene — a declared invariant over action ordering. That would make the executor responsible for checking that execution traces conform to the declared flow graph. This points toward *verified execution*: traces are not just recorded, they're validated against declared structure.

---

### 11. Side-Branch Execution Is a Hidden Second Compute Pass

In `packages/ts/scene-runner/src/executor/action-executor.ts`, after executing the root compute graph, there's a second pass: "execute side branches" — function bindings that are *not reachable from the root* but are consumed by next-rule `from_action` entries.

**What this means:** An action's compute block has a primary output (the root) and zero or more secondary outputs consumed exclusively by transition logic. These secondary outputs are invisible to merge and state — they're routing-only values. They exist in the binding space but are computed only when a next rule references them.

**Why this matters:** There are two categories of binding in a Turnout program:
1. **Primary bindings** — reachable from root, may be merged to STATE
2. **Transition bindings** — unreachable from root, exist only to gate next rules

The action executor must traverse both the root graph and all side-branch graphs. Missed side branches would silently skip transition evaluations.

**Momentum:** This separation suggests a future explicit syntax for declaring transition-only bindings — values that are computed but never merged. The current approach discovers them implicitly by looking at what next rules reference via `from_action`. Explicit declaration would make the two categories visible in the DSL, enabling the validator to check that non-root bindings aren't accidentally merged.

---

### 12. The Pipe Function Is a Scoped Computation Dialect

`PipeFunc` execution creates a `ScopedExecutionContext` that restricts visible value IDs to only the pipe's declared parameters and accumulated step outputs. Parent context values are invisible inside a pipe.

**What this reveals:** Pipes are not just sequential composition — they're *lexically scoped computation environments*. A pipe is a boundary where the only way to get a value inside is through declared parameters. This is closer to lambda functions than to method chains.

**The design consequence:** There are no free variables in pipes. Every input is named. This makes pipes referentially transparent — given the same input bindings, a pipe always produces the same output. It also means pipes are composable: a pipe step can be another pipe, and the scoping composes correctly.

**Tension:** The `#pipe(p1:v1, ...)[step1, step2]` syntax is heavy compared to the simplicity of what it models. For simple sequential transforms this is verbose. The design chose explicitness over ergonomics here — every input source is traceable.

**Momentum:** The scoped computation model makes pipes the natural unit for reuse. A future library system would likely center on named, parameterized pipe definitions that can be imported and called with `#pipe(...)`. The groundwork is entirely in place; only the import/definition mechanism is missing.

---

### 13. Route Pattern Matching Is History Rewriting the Present

The route pattern matcher doesn't just look at the last action. It extracts the *first contiguous block* of a scene's actions from the execution history, discarding any later revisits.

**Why "first contiguous"?** If scene `A` appears at history positions 1–4, then scene `B` at 5–7, then scene `A` again at 8–10, the matcher only uses positions 1–4 when evaluating `A.*` patterns. Positions 8–10 are ignored.

**What this reveals:** The route system assumes that a scene's *first* traversal is the canonical one for routing decisions. Subsequent visits are execution noise, not routing signal. This prevents loops from triggering the same arm repeatedly and ensures pattern matching is stable.

**The asymmetry:** Routes observe history, but history is one-directional. You can match `scene_A.action1.*.action3` but you cannot match "scene_A followed by scene_B followed by scene_A." There's no cross-scene sequence pattern. Routes match *within* scenes, not *across* scenes.

**Tension:** The priority resolution (fewer wildcards > longer suffix > declaration order) is deterministic but non-obvious. A pattern `scene.*.action3` beats `scene.action1.*` only by suffix length — a learnable but non-obvious ordering authors must internalize.

**Momentum:** The "first contiguous block" rule handles loops but limits expressiveness. Future requirements might need cross-scene sequence patterns, or the ability to match on "second visit to scene A." The current history model would need visit-count metadata to support this.

---

### 14. The HCL Emission Is Not Just Serialization — It's Canonicalization

The emitter writes HCL in a fixed order: state → scenes → routes. Within each block, fields appear in defined order. Indentation is exactly 2 spaces per level.

**What this reveals:** The emitter is a *canonical form* writer. Two `.turn` files with the same semantics but different whitespace or ordering produce identical HCL output. This makes the emitter suitable as a formatter or linter target — `turnout format` would be the same operation as `turnout convert --emit hcl`.

**The dual output:** The runtime consumes proto JSON, not HCL. HCL emission is therefore not the execution path — it's the human-readable representation for debugging and review. The compiler produces two outputs for two audiences.

**Momentum:** The canonical form design suggests a development workflow where authors write `.turn`, convert to HCL to review the canonical representation, and ship JSON for execution. This is a standard compiler pattern (readable IR for debugging) applied at the intermediate representation level.

---

### 15. The `next_policy` Is an Underspecified Branch Semantics

Each scene has an optional `next_policy` field: `first-match` (default) or `all-match`. Under `all-match`, every next rule whose condition is true enqueues its target action.

**What `all-match` actually means:** It's not parallel execution. It's *multiple sequential enqueue operations*. If two next rules both match, both target actions are queued and execute in declaration order. The semantics are deterministic but non-obvious.

**What's missing:** There's no syntax for expressing *join* — "execute actions A and B, then continue with C when both complete." `all-match` enables fan-out (one action → multiple successors) but there's no fan-in. Once the queue fans out, it converges only through the visited-set.

**Tension:** `all-match` creates execution behavior that isn't fully representable in the view block's `|=>` arrow notation. A view can express fork (`A |=> B` and `A |=> C`) but not join (`B |=> D` and `C |=> D`). The execution model is richer than the diagram language.

**Momentum:** This gap points toward either: (1) a join operator in the view block (`B & C |=> D`), or (2) explicit fork/join syntax in the DSL for parallel branches. The current model can simulate joins only through state manipulation — a binding that tracks whether both branches have completed.

---

### 16. Proto as Constitution: What It Means for Versioning

The proto schema is generated into both Go and TypeScript via buf. Proto field numbers are permanent — once `ActionModel.compute = 1` is shipped, that field number is a commitment with every serialized `.json` file ever emitted.

**Current protection:** The proto uses `optional` sparingly. There's no `reserved` annotation yet, meaning there's no recorded history of removed fields.

**Momentum:** As the language grows (new expression types, new prepare sources, new route patterns), the proto will need to evolve. The current schema is young enough that evolution hasn't been painful yet. But since proto is the canonical representation, schema migrations are compiler migrations — changing a proto field is a language version bump. This will require an explicit versioning strategy before the format stabilizes.

---

## Design Momentum Summary

| Dimension | Current State | Natural Next Steps |
|---|---|---|
| Proto-centric schema | Single cross-language contract | Schema versioning, migration tooling |
| Hand-written pipeline | Clean stage separation | Incremental compilation, LSP diagnostics |
| Explicit directionality | DSL + validator enforces it | Static data-flow analysis, IDE visualization |
| Closed compute graph | Minimal primitives, inspectable | Reproducibility guarantees, static analysis |
| Queue-based scheduling | Simple, traceable execution | Branch rejoining, parallel action execution |
| History-based routing | Scenes decoupled from routing | Route composition, reusable scene libraries |
| Value tagging | Provenance infrastructure | Policy enforcement on tagged values |
| Null sub-symbols | Runtime capability only | DSL syntax for null-reason branching |
| View block enforce | Schema field, no enforcement | Verified execution against declared structure |
| Pipe scoping | Lambda-equivalent isolation | Named pipe library / import system |

---

## Core Design Intent

Turnout's overarching design intent is **auditability through explicitness**. Every design choice — sigil directionality, closed function table, explicit prepare/merge blocks, history-based routing — serves the goal of making a program's behavior fully inspectable without running it. The architecture treats opacity as a bug.

The system is currently **ahead of itself** in several places: null sub-symbols without DSL syntax, `enforce` without enforcement, side-branch bindings without explicit declaration. These are capability deposits waiting for the language to grow into them. The design has made infrastructure choices that anticipate features the DSL doesn't yet express.

The core risk is the inverse: **the cost of explicitness**. The `#pipe(p1:v1, p2:v2)[step1, step2, step3]` syntax for what is essentially a lambda is heavy. Requiring explicit prepare/merge blocks for every state interaction is verbose. If the ergonomic tax becomes too high for real workflows, the temptation will be to add implicit behavior — which directly undermines the design's core bet.

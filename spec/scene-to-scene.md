# Scene-to-Scene Routing Specification

> **Status**: Draft for implementation
> **Scope**: Chapter-level routing — determining which scene to enter next after a scene within a chapter reaches its terminal state

---

## 1. Purpose

This spec defines a routing DSL that evaluates cross-scene execution history within a **chapter** to determine the next scene to enter. It operates at the layer above `scene-graph.md` (which governs within-scene action transitions).

---

## 2. Core Concepts

### 2.1 Chapter Node

A `route "<chapter-id>"` block defines a **chapter node** in a higher-level scene graph. A chapter:

- Groups and coordinates execution across one or more scenes.
- Maintains a **route history** — the ordered sequence of `scene-id.action-id` entries appended as actions complete.
- Evaluates its `match` block each time a scene within it reaches a terminal state.

### 2.2 Route History

Each time an action completes within a chapter, the runtime appends `<scene-id>.<action-id>` to the chapter's route history. History grows in execution order and is scoped to a single chapter invocation.

Example history after scene-1 executes `intro`, `quiz`, then `final_action`:

```
[scene-1.intro, scene-1.quiz, scene-1.final_action]
```

### 2.3 Trigger

The `match` block is evaluated when a scene inside the chapter reaches a **terminal state** — i.e., when `first-match` or `all-match` next-action evaluation returns no results (per `scene-graph.md §8`).

---

## 3. DSL Syntax

```
route "<chapter-id>" {
    match {
        <pattern> => <scene-id>,
        ...
        _ => <scene-id>
    }
}
```

### 3.1 Pattern Forms

#### Sequence pattern `[<path-item>, ...]`

A sequence pattern `[P₁, P₂, …, Pₙ]` matches the route history if each `Pᵢ` matches a contiguous block of history entries in order, with no gaps between blocks.

Each path item is a **scene-action path**:

| Path item form | Meaning |
|---|---|
| `scene-id.*` | scene-id ran at least one action (any single action matches) |
| `scene-id.<action-id>` | scene-id ran exactly that action |
| `scene-id.*.<action-id>` | scene-id ran any preceding actions, and its **last** executed action was `<action-id>` |

#### Catch-all `_`

The `_` pattern matches any route history unconditionally. It MUST appear at most once per `match` block and SHOULD be the last arm.

### 3.2 Match Result

`=> <scene-id>` specifies the **next scene to enter**. The named scene is entered starting from its declared `entry_actions` (per `scene-graph.md §2`).

---

## 4. Priority

When multiple patterns match the same history, the **narrower** pattern wins:

1. **Fewer `*` wildcards = higher priority** (most specific pattern wins).
2. When two patterns have the same wildcard count, **declaration order** (top-to-bottom) determines the winner.

`_` has lowest priority because it contains no path structure and always matches.

---

## 5. Terminal Behavior

If no pattern matches and no `_` catch-all is present, the chapter enters a **terminal `completed` state** — analogous to a scene with no matching next actions.

---

## 6. Example

```
route "chapter-1" {
    match {
        [scene-1.*.final_action] => scene-2,
        [scene-error.*]          => scene-2,
        _                        => scene-other
    }
}
```

Interpretation:

| History (last actions) | Matched arm | Target |
|---|---|---|
| scene-1 ran, last action = `final_action` | `[scene-1.*.final_action]` | `scene-2` |
| scene-error ran, any action | `[scene-error.*]` | `scene-2` |
| anything else | `_` | `scene-other` |
| no match, no `_` | (none) | chapter `completed` |

Cross-scene sequence example:

```
[scene-1.*, scene-2.*] => scene-3
```

Matches if scene-1 ran (any action) and then scene-2 ran (any action) in that contiguous order.

---

## 7. Balance Rules (CAN / CAN'T)

### CAN (OK)

- A `route` block can contain one `match` block with one or more pattern arms.
- A sequence pattern can mix literal action IDs and `*` wildcards across multiple scene path items.
- Multiple arms can target the same scene ID.
- A narrower arm declared after a broader arm still wins (priority overrides declaration order).
- Omitting `_` is valid; the chapter simply completes if no arm matches.

### CAN'T (NG)

- A `match` block cannot have more than one `_` catch-all arm (`DuplicateCatchAll`).
- A path item cannot omit the scene-id prefix; bare action names are invalid (`InvalidPathItem`).
- A match target cannot reference an undefined scene ID (`UnresolvedScene`).
- A `<~` or `<~>` sigil (from `effect-dsl-spec.md`) has no meaning inside a route pattern; route patterns are read-only against history.

---

## 8. Validation Rules

Before first chapter execution, implementations MUST validate:

1. Each `match` block has at most one `_` arm.
2. All `=> <scene-id>` targets reference scenes that exist within the chapter graph.
3. All path items in sequence patterns are well-formed (`<scene-id>.*`, `<scene-id>.<action-id>`, or `<scene-id>.*.<action-id>`).
4. A sequence pattern `[P₁, …, Pₙ]` with n > 1 references scene IDs in a plausible order (order validation MAY be deferred to runtime).

Validation failures MUST produce `invalid_route`.

---

## 9. Open Questions

| # | Question |
|---|---|
| 1 | **Multiple visits**: If a scene is visited more than once within a chapter, does `scene-id.*.final_action` match the most recent visit, any visit, or all visits? |
| 2 | **Contiguity of cross-scene sequences**: Does `[scene-1.*, scene-2.*]` require scene-1 and scene-2 to be adjacent in history, or is a subsequence match (other scenes may interleave) allowed? |
| 3 | **Identifier format**: `scene-1` uses hyphens, which differs from `[A-Za-z_][A-Za-z0-9_]*` used in `scene-graph.md`. Should hyphenated identifiers be explicitly allowed in scene-to-scene DSL? |
| 4 | **History reset**: Is the route history reset each time a chapter is entered, or does it persist across chapter re-entries? |

---

## 10. Error Catalogue

| Error code | Trigger condition |
|---|---|
| `DuplicateCatchAll` | More than one `_` arm in a `match` block |
| `InvalidPathItem` | A pattern path item is missing a scene-id prefix or is otherwise malformed |
| `UnresolvedScene` | A match target `=> <scene-id>` references a scene that does not exist |
| `invalid_route` | General route block validation failure (emitted as a `RouteDiagnostic`) |

---

## 11. Test Plan

### Domain Categories

| Domain | Coverage target |
|---|---|
| A. Pattern parsing | All path item forms parsed correctly (`.*`, `.<action-id>`, `.*.<action-id>`, `_`) |
| B. History accumulation | Route history grows in execution order; one entry per completed action |
| C. Pattern matching — single scene | `[scene-1.*]`, `[scene-1.final_action]`, `[scene-1.*.final_action]` match/reject correctly |
| D. Pattern matching — cross-scene | `[scene-1.*, scene-2.*]` matches only when both scenes appear in correct order |
| E. Priority resolution | Narrower patterns (fewer `*`) win; declaration order breaks ties among equal-wildcard patterns |
| F. Catch-all | `_` selected when no specific pattern matches; absent `_` → `completed` |
| G. Match result | `=> <scene-id>` causes entry from correct `entry_actions` |
| H. Error paths | All error codes trigger correctly and abort without partial state |

### Critical Paths (idempotency)

| # | Path | Idempotency check |
|---|---|---|
| 1 | Identical history → identical matched pattern | Re-run with same history; assert same target scene selected both times |
| 2 | `[scene-1.*.final_action]` matches only when `final_action` is last | History ending with `final_action` matches; any other last action does not |
| 3 | `_` selected when no specific pattern matches | Histories with no narrow match always route to `_` target |
| 4 | Narrow beats broad | Two patterns matching the same history; assert narrower (fewer `*`) selected |
| 5 | Cross-scene sequence order | `[scene-1.*, scene-2.*]` matches `scene-1 then scene-2` but not `scene-2 then scene-1` |

### Edge Cases

| Case | Expected behaviour |
|---|---|
| History is empty when match fires | Only `_` matches; chapter completes if no `_` |
| Two patterns with equal wildcard count | Declaration order: first arm wins |
| No `_` and no pattern matches | Chapter enters `completed` state |
| `_` declared before a more specific arm | Specific arm still wins (priority overrides order) |
| `=> target` where target scene is undefined | `UnresolvedScene` at compile/validate time |
| `DuplicateCatchAll`: two `_` arms | Validation error; no route evaluates |

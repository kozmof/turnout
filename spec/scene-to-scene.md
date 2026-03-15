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
        <path-expr> => <scene-id>,
        ...
        _ => <scene-id>
    }
}
```

A `<path-expr>` is either a single path or multiple paths joined with `|`:

```
match {
    scene-1.*.action-foo => scene-2,
    scene-error.*.action-end => scene-2,
    _ => scene-other
}
```

```
match {
    scene-1.*.action-foo |
    scene-error.*.action-end
        => scene-2,
    _ => scene-other
}
```

### 3.1 Pattern Forms

#### Path expression

A **path expression** matches the route history against a single scene's execution path. The **last segment must always be a specific action-id** — bare `scene-id.*` (with no terminal action) is not permitted, because the runtime cannot determine when to trigger a match without a concrete terminal action.

| Path form | Meaning |
|---|---|
| `scene-id.<action-id>` | scene-id ran exactly that action as its terminal action |
| `scene-id.*.<action-id>` | scene-id ran any preceding actions, and its **last** executed action was `<action-id>` |

#### OR expression `\|`

Multiple path forms can be OR-joined within a single arm using `|`. All branches of a `|` expression must share the same `=> <scene-id>` target. Each branch is evaluated independently; the arm matches if any branch matches.

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
        scene-1.*.final_action |
        scene-error.*.action-end
            => scene-2,
        _ => scene-other
    }
}
```

Equivalent using separate arms:

```
route "chapter-1" {
    match {
        scene-1.*.final_action   => scene-2,
        scene-error.*.action-end => scene-2,
        _                        => scene-other
    }
}
```

Interpretation:

| History (last actions) | Matched arm | Target |
|---|---|---|
| scene-1 ran, last action = `final_action` | `scene-1.*.final_action` | `scene-2` |
| scene-error ran, last action = `action-end` | `scene-error.*.action-end` | `scene-2` |
| anything else | `_` | `scene-other` |
| no match, no `_` | (none) | chapter `completed` |

---

## 7. Balance Rules (CAN / CAN'T)

### CAN (OK)

- A `route` block can contain one `match` block with one or more pattern arms.
- A path form can use `*` wildcard before a terminal action-id (`scene-id.*.<action-id>`).
- Multiple arms (or `|` branches) can target the same scene ID.
- A narrower arm declared after a broader arm still wins (priority overrides declaration order).
- Omitting `_` is valid; the chapter simply completes if no arm matches.
- A `|` expression can combine any number of path forms within a single arm.

### CAN'T (NG)

- A `match` block cannot have more than one `_` catch-all arm (`DuplicateCatchAll`).
- A path form cannot use bare `scene-id.*` with no terminal action-id (`BareWildcardPath`).
- A path item cannot omit the scene-id prefix; bare action names are invalid (`InvalidPathItem`).
- A match target cannot reference an undefined scene ID (`UnresolvedScene`).
- A `<~` or `<~>` sigil (from `effect-dsl-spec.md`) has no meaning inside a route pattern; route patterns are read-only against history.

---

## 8. Validation Rules

Before first chapter execution, implementations MUST validate:

1. Each `match` block has at most one `_` arm.
2. All `=> <scene-id>` targets reference scenes that exist within the chapter graph.
3. All path forms are well-formed (`<scene-id>.<action-id>` or `<scene-id>.*.<action-id>`); bare `<scene-id>.*` is rejected.
4. All branches within a `|` expression share a common `=> <scene-id>` target (enforced by syntax).

Validation failures MUST produce `invalid_route`.

---

## 9. Open Questions

| # | Question |
|---|---|
| 1 | **Multiple visits**: If a scene is visited more than once within a chapter, does `scene-id.*.final_action` match the most recent visit, any visit, or all visits? |
| 2 | **Identifier format**: `scene-1` uses hyphens, which differs from `[A-Za-z_][A-Za-z0-9_]*` used in `scene-graph.md`. Should hyphenated identifiers be explicitly allowed in scene-to-scene DSL? |
| 3 | **History reset**: Is the route history reset each time a chapter is entered, or does it persist across chapter re-entries? |

---

## 10. Error Catalogue

| Error code | Trigger condition |
|---|---|
| `DuplicateCatchAll` | More than one `_` arm in a `match` block |
| `BareWildcardPath` | A path form uses `scene-id.*` with no terminal action-id |
| `InvalidPathItem` | A pattern path item is missing a scene-id prefix or is otherwise malformed |
| `UnresolvedScene` | A match target `=> <scene-id>` references a scene that does not exist |
| `invalid_route` | General route block validation failure (emitted as a `RouteDiagnostic`) |

---

## 11. Test Plan

### Domain Categories

| Domain | Coverage target |
|---|---|
| A. Pattern parsing | All path forms parsed correctly (`.<action-id>`, `.*.<action-id>`, `_`, `\|` OR) |
| B. History accumulation | Route history grows in execution order; one entry per completed action |
| C. Pattern matching — exact action | `scene-1.final_action` matches/rejects correctly based on terminal action |
| D. Pattern matching — wildcard prefix | `scene-1.*.final_action` matches when last action is `final_action`, rejects otherwise |
| E. OR expression | `path1 \| path2` arm matches when either branch matches |
| F. Priority resolution | Narrower patterns (fewer `*`) win; declaration order breaks ties among equal-wildcard patterns |
| G. Catch-all | `_` selected when no specific pattern matches; absent `_` → `completed` |
| H. Match result | `=> <scene-id>` causes entry from correct `entry_actions` |
| I. Error paths | All error codes trigger correctly and abort without partial state |

### Critical Paths (idempotency)

| # | Path | Idempotency check |
|---|---|---|
| 1 | Identical history → identical matched pattern | Re-run with same history; assert same target scene selected both times |
| 2 | `scene-1.*.final_action` matches only when `final_action` is last | History ending with `final_action` matches; any other last action does not |
| 3 | `_` selected when no specific pattern matches | Histories with no narrow match always route to `_` target |
| 4 | Narrow beats broad | Two patterns matching the same history; assert narrower (fewer `*`) selected |
| 5 | OR expression consistency | `path1 \| path2` and two separate arms with the same targets produce identical routing decisions |

### Edge Cases

| Case | Expected behaviour |
|---|---|
| History is empty when match fires | Only `_` matches; chapter completes if no `_` |
| Two patterns with equal wildcard count | Declaration order: first arm wins |
| No `_` and no pattern matches | Chapter enters `completed` state |
| `_` declared before a more specific arm | Specific arm still wins (priority overrides order) |
| `=> target` where target scene is undefined | `UnresolvedScene` at compile/validate time |
| `DuplicateCatchAll`: two `_` arms | Validation error; no route evaluates |
| Bare `scene-id.*` with no terminal action | `BareWildcardPath` validation error |

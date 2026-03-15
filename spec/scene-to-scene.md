# Scene-to-Scene Routing Specification

> **Status**: Draft for implementation
> **Scope**: Route-level routing — determining which scene to enter next after a scene within a route reaches its terminal state

---

## 1. Purpose

This spec defines a routing DSL that evaluates cross-scene execution history within a **route** to determine the next scene to enter. It operates at the layer above `scene-graph.md` (which governs within-scene action transitions).

---

## 2. Core Concepts

### 2.1 Route Node

A `route "<route_id>"` block defines a **route node** in a higher-level scene graph. A route:

- Groups and coordinates execution across one or more scenes.
- Maintains a **route history** — the ordered sequence of `scene_id.action_id` entries appended as actions complete.
- Evaluates its `match` block each time a scene within it reaches a terminal state.

### 2.2 STATE Sharing

STATE is global within a route. When the route transitions from one scene to another, STATE is not reset — the destination scene starts with the same STATE (`S_n`) that the previous scene left behind. STATE persists across all scene boundaries within a single route invocation.

### 2.3 Route History

Each time an action completes within a route, the runtime appends `<scene_id>.<action_id>` to the route's route history. History grows in execution order and is scoped to a single route invocation. **History MUST be reset to empty each time the route is entered; it does not persist across route re-entries.**

When a scene is visited more than once within a route (i.e., its actions appear in history non-contiguously), pattern evaluation considers **all** contiguous blocks of that scene's entries in execution order. The **first contiguous block** (earliest in history) that satisfies the pattern determines a match. If no contiguous block matches, the arm does not match.

Example history after `scene_1` executes `intro`, `quiz`, then `final_action`:

```
[scene_1.intro, scene_1.quiz, scene_1.final_action]
```

### 2.3 Trigger

The `match` block is evaluated when a scene inside the route reaches a **terminal state** — i.e., when `first-match` or `all-match` next-action evaluation returns no results (per `scene-graph.md §8`).

---

## 3. DSL Syntax

```
route "<route_id>" {
    match {
        <path-expr> => <scene_id>,
        ...
        _ => <scene_id>
    }
}
```

A `<path-expr>` is either a single path or multiple paths joined with `|`:

```
match {
    scene_1.*.action_foo => scene_2,
    scene_error.*.action_end => scene_2,
    _ => scene_other
}
```

```
match {
    scene_1.*.action_foo |
    scene_error.*.action_end
        => scene_2,
    _ => scene_other
}
```

### 3.1 Pattern Forms

#### Path expression

A **path expression** matches the route history against a single scene's execution path. The **last segment must always be a specific action_id** — bare `scene_id.*` (with no terminal action) is not permitted, because the runtime cannot determine when to trigger a match without a concrete terminal action.

| Path form | Meaning |
|---|---|
| `scene_id.<action_id>` | The scene's contiguous block in history consists of exactly that one action as its terminal entry |
| `scene_id.*.<action_id>` | The scene's contiguous block ends with `<action_id>`, preceded by any number of actions from that scene |
| `scene_id.*.<action_id>.<action_id>…` | The scene's contiguous block ends with the given action sequence (last N entries in order); any actions may precede them |

#### Contiguous-block matching

When evaluating a path expression, the runtime identifies the **contiguous block** of history entries that belong to the named scene — the longest uninterrupted run of `scene_id.*` entries ending at the current tail of the history. If entries from other scenes interrupt the sequence, the block ends before that interruption. A `*` wildcard matches zero or more entries within this contiguous block only; it does not match across scene boundaries.

A path expression with a single `*` is permitted. **Multiple `*` wildcards in a single path expression are not permitted** (`MultipleWildcards`).

#### OR expression `\|`

Multiple path forms can be OR-joined within a single arm using `|`. All branches of a `|` expression must share the same `=> <scene_id>` target. Each branch is evaluated independently; the arm matches if any branch matches.

#### Catch-all `_`

The `_` pattern matches any route history unconditionally. It MUST appear at most once per `match` block and SHOULD be the last arm.

### 3.2 Match Result

`=> <scene_id>` specifies the **next scene to enter**. The named scene is entered starting from its **first declared** `entry_actions` entry (per `scene-graph.md §2`). When the target scene declares multiple entry actions, only the first is launched on route-driven entry.

---

## 4. Priority

When multiple patterns match the same history, the **narrower** pattern wins:

1. **Fewer `*` wildcards = higher priority** (most specific pattern wins).
2. When two patterns have the same wildcard count, **longer specific suffix = higher priority** — more action segments after the `*` wins (e.g. `scene.*.foo.bar` beats `scene.*.bar`).
3. When two patterns have the same wildcard count and the same suffix length, **declaration order** (top-to-bottom) determines the winner.

`_` has lowest priority because it contains no path structure and always matches.

---

## 5. Terminal Behavior

If no pattern matches and no `_` catch-all is present, the route enters a **terminal `completed` state** — analogous to a scene with no matching next actions.

---

## 6. Example

```
route "route_1" {
    match {
        scene_1.*.final_action |
        scene_error.*.action_end
            => scene_2,
        _ => scene_other
    }
}
```

Equivalent using separate arms:

```
route "route_1" {
    match {
        scene_1.*.final_action   => scene_2,
        scene_error.*.action_end => scene_2,
        _                        => scene_other
    }
}
```

Interpretation:

| History (last actions) | Matched arm | Target |
|---|---|---|
| `scene_1` ran, last action = `final_action` | `scene_1.*.final_action` | `scene_2` |
| `scene_error` ran, last action = `action_end` | `scene_error.*.action_end` | `scene_2` |
| anything else | `_` | `scene_other` |
| no match, no `_` | (none) | route `completed` |

---

## 7. Balance Rules (CAN / CAN'T)

### CAN (OK)

- A `route` block can contain one `match` block with one or more pattern arms.
- A path form can use one `*` wildcard before a terminal action_id (`scene_id.*.<action_id>`).
- Multiple arms (or `|` branches) can target the same scene ID.
- A narrower arm declared after a broader arm still wins (priority overrides declaration order).
- Omitting `_` is valid; the route simply completes if no arm matches.
- A `|` expression can combine any number of path forms within a single arm.

### CAN'T (NG)

- A `match` block cannot have more than one `_` catch-all arm (`DuplicateCatchAll`).
- A path form cannot use bare `scene_id.*` with no terminal action_id (`BareWildcardPath`).
- A path form cannot use more than one `*` wildcard (`MultipleWildcards`).
- A path item cannot omit the scene_id prefix; bare action names are invalid (`InvalidPathItem`).
- A match target cannot reference an undefined scene ID (`UnresolvedScene`).
- A `<~` or `<~>` sigil (from `effect-dsl-spec.md`) has no meaning inside a route pattern; route patterns are read-only against history.

---

## 8. Validation Rules

Before first route execution, implementations MUST validate:

1. Each `match` block has at most one `_` arm.
2. All `=> <scene_id>` targets reference scenes that exist in the global scene registry.
3. All path forms are well-formed (`<scene_id>.<action_id>` or `<scene_id>.*.<action_id>(.<action_id>)*`) with exactly zero or one `*`; bare `<scene_id>.*` and multiple `*` are rejected.
4. All branches within a `|` expression share a common `=> <scene_id>` target (enforced by syntax).

Validation failures MUST produce an `invalid_route` diagnostic. Each failure emits a `RouteDiagnostic` (see §10) carrying the applicable specific error code as `code`; `invalid_route` is the top-level `stage` marker on that diagnostic, not a separate emission.

---

## 9. Open Questions

No open questions remain.

**Resolved:**

| # | Resolution |
|---|------------|
| 1 | **Multiple visits**: `scene_id.*.final_action` evaluates all contiguous blocks of `scene_id` entries in execution order. The **first** contiguous block (earliest in history) that satisfies the pattern determines a match. See §2.3 for full semantics. |
| 4 | **`RouteDiagnostic` payload**: `routeId` is required (non-optional); `armIndex` and `patternText` remain optional. |
| 5 | **Scope of `=> <scene_id>` targets**: A target may reference any scene in the global scene registry; it is not restricted to scenes declared within the same route block. |

---

## 10. Error Catalogue

Each validation or runtime failure emits a `RouteDiagnostic`. The specific error codes below are carried in the `code` field; all route-block validation failures are identified by `stage: "route_validation"`.

```ts
type RouteDiagnostic = {
  code: string;
  severity: "error" | "warning";
  stage: "route_validation" | "route_execute";
  routeId: string;         // required: the ID of the route that produced the diagnostic
  armIndex?: number;       // zero-based index of the failing match arm
  patternText?: string;    // the pattern source text that triggered the error
  message: string;
  details?: Record<string, unknown>;
};
```

| Error code | Trigger condition |
|---|---|
| `DuplicateCatchAll` | More than one `_` arm in a `match` block |
| `BareWildcardPath` | A path form uses `scene_id.*` with no terminal action_id |
| `MultipleWildcards` | A path form contains more than one `*` wildcard |
| `InvalidPathItem` | A pattern path item is missing a scene_id prefix or is otherwise malformed |
| `UnresolvedScene` | A match target `=> <scene_id>` references a scene that does not exist |

---

## 11. Test Plan

### Domain Categories

| Domain | Coverage target |
|---|---|
| A. Pattern parsing | All path forms parsed correctly (`.<action_id>`, `.*.<action_id>`, `_`, `\|` OR) |
| B. History accumulation | Route history grows in execution order; one entry per completed action; reset on each route entry |
| C. Pattern matching — exact action | `scene_1.final_action` matches/rejects correctly based on terminal action |
| D. Pattern matching — wildcard prefix | `scene_1.*.final_action` matches when last action in contiguous block is `final_action`, rejects otherwise |
| E. OR expression | `path1 \| path2` arm matches when either branch matches |
| F. Priority resolution | Narrower patterns (fewer `*`) win; declaration order breaks ties among equal-wildcard patterns |
| G. Catch-all | `_` selected when no specific pattern matches; absent `_` → `completed` |
| H. Match result | `=> <scene_id>` causes entry from first declared `entry_actions` of target scene |
| I. Error paths | All error codes trigger correctly and abort without partial state |
| J. Contiguous-block matching | Interleaved actions from another scene break the contiguous block; pattern does not match across the break |

### Critical Paths (idempotency)

| # | Path | Idempotency check |
|---|---|---|
| 1 | Identical history → identical matched pattern | Re-run with same history; assert same target scene selected both times |
| 2 | `scene_1.*.final_action` matches only when `final_action` is last in contiguous block | History ending with `final_action` matches; any other last action does not |
| 3 | `_` selected when no specific pattern matches | Histories with no narrow match always route to `_` target |
| 4 | Narrow beats broad | Two patterns matching the same history; assert narrower (fewer `*`) selected |
| 5 | OR expression consistency | `path1 \| path2` and two separate arms with the same targets produce identical routing decisions |
| 6 | Longer suffix beats shorter | `scene.*.foo.bar` and `scene.*.bar` both match; assert `scene.*.foo.bar` selected |

### Edge Cases

| Case | Expected behaviour |
|---|---|
| Two patterns with equal wildcard count | Declaration order: first arm wins |
| No `_` and no pattern matches | Route enters `completed` state |
| `_` declared before a more specific arm | Specific arm still wins (priority overrides order) |
| `=> target` where target scene is undefined | `UnresolvedScene` at compile/validate time |
| `DuplicateCatchAll`: two `_` arms | Validation error; no route evaluates |
| Bare `scene_id.*` with no terminal action | `BareWildcardPath` validation error |
| Path with two `*` wildcards | `MultipleWildcards` validation error |
| Interleaved history `[scene_1.a, scene_2.x, scene_1.final]` | `scene_1` contiguous block is `[scene_1.a]` only; `scene_1.*.final` does not match |
| History `[scene_1.a, scene_1.final, scene_2.x, scene_1.b, scene_1.final]` (scene_1 visited twice) | First contiguous block `[scene_1.a, scene_1.final]` matches `scene_1.*.final`; the second block is not evaluated |

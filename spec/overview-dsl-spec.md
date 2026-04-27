# Overview DSL Specification (Action Nodes Flow) v0.1

> Status: Proposed spec for implementation
> Scope: Scene-level structural declaration and enforcement for action node flow

## 1. Purpose

The Overview DSL provides a lightweight, author-maintained declaration of the intended action graph structure within a scene. It serves two roles:

1. **Documentation** — the flow block is a human-readable map of which actions exist and how they connect.
2. **Enforcement** — at scene validation time the declared structure is checked against the actual action graph using one of three configurable enforcement modes.

The Overview DSL lives inside a `view "overview" { ... }` block in the HCL scene definition. It is optional; scenes without it run without structural enforcement.

## 2. Conventions

### 2.1 Normative keywords

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are to be interpreted as described in RFC 2119.

### 2.2 Identifiers

Action IDs in the flow string use the same identifier rule as the scene graph: `IDENT = [A-Za-z_][A-Za-z0-9_]*`.

### 2.3 Relationship to scene-graph.md

This spec extends [scene-graph.md](scene-graph.md). All terms defined there (`ActionId`, `impl_nodes`, `impl_data_edges`, enforce modes) are used here with the same meaning. Where the two specs conflict, this spec is authoritative for the Overview DSL.

## 3. HCL Surface Syntax

The overview block appears at scene level, alongside `entry_actions`, `next_policy`, and `action` blocks:

```hcl
scene "loan_flow" {
  entry_actions = ["score"]
  next_policy   = "first-match"

  view "overview" {
    flow = <<-EOT
      score
        |=> approve
        |=> reject
    EOT
    enforce = "at_least"
  }

  action "score" { ... }
  action "approve" { ... }
  action "reject" { ... }
}
```

### 3.1 Attributes

| Attribute | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `flow`    | string | yes      | Multi-line flow DSL text (heredoc or quoted string) |
| `enforce` | string | yes      | Enforcement mode: `"nodes_only"`, `"at_least"`, or `"strict"` |

- `flow` MUST be a non-empty string. An empty or whitespace-only string MUST fail with `OVW_FLOW_EMPTY`.
- `enforce` MUST be one of the three enumerated values. Any other value MUST fail with `OVW_ENFORCE_UNKNOWN`.
- A scene MUST NOT contain more than one `view "overview"` block. A duplicate MUST fail with `OVW_DUPLICATE`.
- The view name MUST be the literal string `"overview"`. Any other name MUST fail with `OVW_UNKNOWN_VIEW`.

## 4. Flow DSL Grammar

The `flow` attribute value is parsed line-by-line according to the following rules.

### 4.1 Line types

After splitting the string on newlines, each line is classified as follows (in order of precedence):

1. **Blank line** — a line that, after trimming all leading and trailing whitespace, is empty. Blank lines are silently ignored.
2. **Edge line** — a line whose content, after trimming leading whitespace, starts with `|=>`. The remainder after `|=>` is trimmed of leading whitespace and treated as the target `ActionId`.
3. **Chain line** — a line whose content, after trimming leading whitespace, does not start with `|=>` but contains `|=>` as a substring. The line is split on `|=>` (stripping surrounding whitespace from each part) to produce an ordered list of `ActionId` segments.
4. **Node line** — any non-blank line that does not start with `|=>` and does not contain `|=>`. The entire trimmed content is the source `ActionId`.

> **Why is a line starting with `|=>` always an edge line, never a chain line?** Classification is by the leading characters of the trimmed line. If a line starts with `|=>`, it is unconditionally an edge line regardless of what follows. This means `|=> bar |=> baz` is an edge line whose target is `bar |=> baz` — which then fails `OVW_INVALID_IDENT` because `|` is not a valid `IDENT` character. Authors who want a chain MUST begin with a node identifier.

### 4.2 Parse algorithm

```
nodes   := empty ordered set of ActionId
edges   := empty ordered set of (ActionId, ActionId)
current := null

for each line L in flow.split("\n"):
  trimmed := L.trim()
  if trimmed == "":
    continue                          # blank — skip

  if trimmed.startsWith("|=>"):
    # --- edge line ---
    target := trimmed.slice(3).trim()
    if target == "":
      fail OVW_EDGE_NO_TARGET
    if current == null:
      fail OVW_EDGE_WITHOUT_SOURCE
    validate IDENT(target)            # fail OVW_INVALID_IDENT if not IDENT
    edges.add((current, target))

  else if trimmed.contains("|=>"):
    # --- chain line ---
    parts := trimmed.split("|=>").map(p => p.trim())
    if parts[last] == "":
      fail OVW_CHAIN_NO_TARGET
    for each part in parts:
      validate IDENT(part)            # fail OVW_INVALID_IDENT if not IDENT
    for i in 0 .. parts.length - 2:
      nodes.add(parts[i])             # all except last become nodes
    for i in 0 .. parts.length - 2:
      edges.add((parts[i], parts[i+1]))
    current := parts[last]            # last element becomes current (not added to nodes)

  else:
    # --- node line ---
    source := trimmed
    validate IDENT(source)            # fail OVW_INVALID_IDENT if not IDENT
    nodes.add(source)
    current := source
```

The result is an `OverviewGraph`:

```ts
type OverviewGraph = {
  nodes: ReadonlySet<string>; // ActionIds, in declaration order
  edges: ReadonlySet<readonly [string, string]>; // (source, target) pairs, in declaration order
};
```

### 4.3 Constraints

- The same `ActionId` MAY appear as a node more than once in the flow text; duplicate node lines MUST be treated as re-setting `current` without adding the node a second time. `nodes` is a set; order is determined by first occurrence.
- The same `(source, target)` edge pair MAY appear more than once; duplicate edges MUST be silently de-duplicated.
- An `ActionId` that appears only as an edge target — via a standalone `|=>` line or as the last element of a chain — is NOT automatically added to `nodes`. If enforcement requires node checking, such IDs are not counted as declared nodes.
- **Chain lines add all elements except the last to `nodes`.** This mirrors the standalone `|=>` behavior: the target of each `|=>` is not a node declaration. In `foo |=> bar |=> baz`, `foo` and `bar` are added to `nodes`; `baz` is the final target and is not.
- After a chain line, `current` is set to the last element. Subsequent `|=>` lines extend edges from that last element, even though it is not in `nodes`.

> **Rationale**: The inline `|=>` chain is purely syntactic sugar for the expanded multi-line form. Each `|=>` in the chain behaves identically to a standalone `|=>` edge line: the right-hand side is a target, not a node declaration. This keeps the two forms strictly equivalent and avoids any special-casing for chain lines in enforcement.

### 4.4 Compile step

After parsing, implementations MUST compile the `OverviewGraph` into the sets used by enforcement:

```
overview_nodes      := graph.nodes
overview_data_edges := graph.edges
```

Both sets are then ready for comparison with the scene's implementation sets.

## 5. Enforcement Modes

Enforcement compares the overview declaration against the actual scene structure derived at validation time.

### 5.1 Implementation sets

```
impl_nodes      := { action.actionId | action ∈ scene.actions }
impl_data_edges := { (action.actionId, next.action) | action ∈ scene.actions, next ∈ action.next }
```

These sets are computed from the fully-parsed, pre-execution scene model.

### 5.2 Mode semantics

| Mode          | Nodes check                                    | Edges check                                             |
|---------------|------------------------------------------------|---------------------------------------------------------|
| `nodes_only`  | `overview_nodes ⊆ impl_nodes`                 | none                                                    |
| `at_least`    | `overview_nodes ⊆ impl_nodes`                 | `overview_data_edges ⊆ impl_data_edges`                |
| `strict`      | `overview_nodes = impl_nodes`                  | `overview_data_edges = impl_data_edges`                |

Violations:

- **`nodes_only`**: any `overview_node` not in `impl_nodes` → `OVW_NODE_MISSING`
- **`at_least`** (nodes): same as `nodes_only`
- **`at_least`** (edges): any `overview_data_edge` not in `impl_data_edges` → `OVW_EDGE_MISSING`
- **`strict`** (nodes): any `overview_node` not in `impl_nodes` → `OVW_NODE_MISSING`; any `impl_node` not in `overview_nodes` → `OVW_NODE_EXTRA`
- **`strict`** (edges): any `overview_data_edge` not in `impl_data_edges` → `OVW_EDGE_MISSING`; any `impl_data_edge` not in `overview_data_edges` → `OVW_EDGE_EXTRA`

All violations are errors (severity `"error"`). Implementations MUST report all violations found before stopping, not just the first.

### 5.3 Choice guidance

| Mode         | When to use |
|--------------|-------------|
| `nodes_only` | Sketching: you want all named nodes to exist but don't need to pin every edge yet. |
| `at_least`   | Normal authoring: the declared edges are the minimum contract; the impl may have more. |
| `strict`     | Finalized scenes: the overview is the exact specification; any deviation is a bug. |

## 6. Examples

### 6.1 Simple binary branch (at_least)

```hcl
view "overview" {
  flow = <<-EOT
    score
      |=> approve
      |=> reject
  EOT
  enforce = "at_least"
}
```

Parsed: `nodes = {score}`, `edges = {(score,approve),(score,reject)}`

Valid if the scene has an action `score` with at least two `next` entries targeting `approve` and `reject`. Actions `approve` and `reject` are referenced as edge targets but are NOT required to be in `overview_nodes`; however, they must exist in `impl_nodes` (validated separately by scene-graph rules).

### 6.2 Multi-level flow (at_least)

```hcl
view "overview" {
  flow = <<-EOT
    choose_route
      |=> forest_trail
      |=> city_gate
      |=> sewer_tunnel
      |=> campfire_wait
    forest_trail
      |=> shrine_discovery
    city_gate
      |=> courtyard_arrival
    sewer_tunnel
      |=> hidden_archive
    campfire_wait
      |=> chapter_end
    shrine_discovery
      |=> chapter_end
    courtyard_arrival
      |=> chapter_end
    hidden_archive
      |=> chapter_end
  EOT
  enforce = "at_least"
}
```

Parsed:
- `nodes = {choose_route, forest_trail, city_gate, sewer_tunnel, campfire_wait, shrine_discovery, courtyard_arrival, hidden_archive}`
- `edges = {(choose_route,forest_trail), (choose_route,city_gate), (choose_route,sewer_tunnel), (choose_route,campfire_wait), (forest_trail,shrine_discovery), (city_gate,courtyard_arrival), (sewer_tunnel,hidden_archive), (campfire_wait,chapter_end), (shrine_discovery,chapter_end), (courtyard_arrival,chapter_end), (hidden_archive,chapter_end)}`

### 6.3 Strict mode

```hcl
view "overview" {
  flow = <<-EOT
    start
      |=> end
  EOT
  enforce = "strict"
}
```

The scene MUST contain exactly the actions `start` and `end`, and action `start` MUST have exactly one next rule targeting `end`. No other actions or next rules are allowed.

### 6.4 Chain syntax — linear path

A chain condenses a linear sequence into a single line. This:

```hcl
view "overview" {
  flow = <<-EOT
    foo |=> bar |=> baz
  EOT
  enforce = "at_least"
}
```

is exactly equivalent to:

```hcl
view "overview" {
  flow = <<-EOT
    foo
      |=> bar
    bar
      |=> baz
  EOT
  enforce = "at_least"
}
```

Parsed: `nodes = {foo, bar}`, `edges = {(foo,bar),(bar,baz)}`, `current = baz`.

`baz` is the final edge target and is NOT added to `nodes`, exactly as it would not be in the expanded form.

### 6.5 Chain syntax — continuing with `|=>` after a chain

`current` is set to the last chain element, so standalone `|=>` lines after a chain extend from it:

```
analyze |=> score |=> decide
  |=> approve
  |=> reject
```

Parsed:
- `nodes = {analyze, score}`
- `edges = {(analyze,score),(score,decide),(decide,approve),(decide,reject)}`
- `current = decide` after the chain line; `|=>` lines add edges from `decide`

`decide`, `approve`, and `reject` are edge targets only and are NOT added to `nodes`.

**Inline chaining from a standalone `|=>` line is not possible.** A line whose trimmed content starts with `|=>` is unconditionally an edge line; any `|=>` within it becomes part of the target string, which fails `OVW_INVALID_IDENT`. For example:

```
analyze |=> score |=> decide
  |=> approve |=> done     ← ERROR: edge line, target is "approve |=> done"
```

To continue chaining from a branch target, re-declare it as a standalone node line and then use edge lines or a new chain:

```
analyze |=> score |=> decide
  |=> approve
  |=> reject
approve
  |=> done
```

Parsed:
- `nodes = {analyze, score, approve}`
- `edges = {(analyze,score),(score,decide),(decide,approve),(decide,reject),(approve,done)}`
- After the `approve` node line, `current = approve`; `|=> done` adds edge `(approve,done)`

**Indentation depth has no semantic meaning.** `current` is updated only by node lines and chain lines, never by edge lines. Extra indentation on a `|=>` line does not change which node it sources from. The following looks like `done` and `recheck` branch from `approve`, but they actually branch from `decide`:

```
analyze |=> score |=> decide
  |=> approve
    |=> done       ← sources from decide, not approve
    |=> recheck    ← sources from decide, not approve
```

Parsed:
- `nodes = {analyze, score}`
- `edges = {(analyze,score),(score,decide),(decide,approve),(decide,done),(decide,recheck)}`

**Non-ASCII whitespace in indentation is a parse error.** If leading whitespace contains characters outside the ASCII whitespace set (e.g. the ideographic space U+3000), implementations that trim only ASCII whitespace will not recognize the line as starting with `|=>`. The remaining content — non-ASCII characters followed by `|=>` — is treated as a chain line whose first segment fails `OVW_INVALID_IDENT`. See §6.9 for an example.

### 6.6 Parse error — edge without source

```
|=> orphan
```

→ `OVW_EDGE_WITHOUT_SOURCE` because no node line preceded the edge line.

### 6.7 Parse error — empty target

```
hub
  |=>
```

→ `OVW_EDGE_NO_TARGET` because no identifier follows `|=>`.

### 6.8 Parse error — chain with no target

```
foo |=>
```

→ `OVW_CHAIN_NO_TARGET` because the segment after the last `|=>` is empty.

Note: `|=> bar |=> baz` starts with `|=>` so it is classified as an edge line (not a chain line), and its target `bar |=> baz` fails `OVW_INVALID_IDENT` because `|` is not a valid `IDENT` character.

### 6.9 Parse error — non-ASCII whitespace in indentation

```
analyze |=> score |=> decide
  |=> approve
　　|=> done
```

The third line uses ideographic spaces (U+3000) as indentation. After trimming ASCII whitespace only, the leading `　　` characters remain, so the line does not start with `|=>`. It contains `|=>` as a substring, so it is classified as a chain line. The split produces segments `["　　", "done"]`; the first segment `　　` fails `OVW_INVALID_IDENT` → `OVW_INVALID_IDENT`.

Implementations MUST document which whitespace characters are stripped during trimming. Implementations that strip Unicode whitespace (including U+3000) will instead classify this line as an edge line sourcing from `current` (i.e. `decide`), producing no error but silently ignoring the visual indentation intent. Authors MUST use only ASCII whitespace (U+0020 space or U+0009 tab) for indentation.

## 7. Validation Lifecycle

Overview validation occurs as part of scene-level validation (Section 6 of scene-graph.md), specifically as item 15: *"If `view` exists, overview parsing/compilation/enforcement succeeds for selected mode."*

The three sub-stages map to diagnostic stage values:

| Sub-stage   | Stage string          | What can fail |
|-------------|-----------------------|---------------|
| Parse       | `"overview_parse"`    | Grammar errors in the `flow` string |
| Compile     | `"overview_compile"`  | Structural errors after parse (e.g. `OVW_ENFORCE_UNKNOWN`) |
| Enforce     | `"overview_enforce"`  | Node/edge set comparison failures |

Failures at any sub-stage MUST produce `invalid_overview` (not `invalid_graph`) and MUST halt scene execution. Enforcement failures MUST NOT prevent collection of all violations before halting (i.e., report all missing/extra nodes and edges, not just the first).

## 8. Runtime Data Model

```ts
type OverviewView = {
  flow: string;           // raw flow DSL text as stored in the scene model
  enforce: "nodes_only" | "at_least" | "strict";
};

// Attached to Scene (optional):
// view?: OverviewView;
```

The parsed `OverviewGraph` is a compilation artifact; it is not stored in the runtime scene model.

## 9. Diagnostics

### 9.1 Parse errors (`stage: "overview_parse"`)

| Code                      | Condition |
|---------------------------|-----------|
| `OVW_FLOW_EMPTY`          | `flow` is empty or whitespace-only |
| `OVW_EDGE_WITHOUT_SOURCE` | Standalone edge line `|=>` appears before any node or chain line |
| `OVW_EDGE_NO_TARGET`      | Standalone `|=>` is not followed by an identifier |
| `OVW_CHAIN_NO_TARGET`     | Chain line ends with `|=>` (segment after the last `|=>` is empty) |
| `OVW_INVALID_IDENT`       | Any node, edge target, or chain segment fails the `IDENT` pattern |

### 9.2 Compile errors (`stage: "overview_compile"`)

| Code                    | Condition |
|-------------------------|-----------|
| `OVW_ENFORCE_UNKNOWN`   | `enforce` value is not one of the three valid strings |
| `OVW_DUPLICATE`         | More than one `view "overview"` block in a scene |
| `OVW_UNKNOWN_VIEW`      | View block name is not `"overview"` |

### 9.3 Enforcement errors (`stage: "overview_enforce"`)

| Code               | Mode(s)              | Condition |
|--------------------|----------------------|-----------|
| `OVW_NODE_MISSING` | `nodes_only`, `at_least`, `strict` | `overview_node ∉ impl_nodes` |
| `OVW_NODE_EXTRA`   | `strict`             | `impl_node ∉ overview_nodes` |
| `OVW_EDGE_MISSING` | `at_least`, `strict` | `overview_edge ∉ impl_data_edges` |
| `OVW_EDGE_EXTRA`   | `strict`             | `impl_edge ∉ overview_data_edges` |

### 9.4 Diagnostic payload

Overview diagnostics use the same `SceneDiagnostic` shape defined in scene-graph.md:

```ts
{
  code: "OVW_NODE_MISSING",
  severity: "error",
  stage: "overview_enforce",
  message: "overview node 'approve' not found in scene actions",
  details: { node: "approve" }
}

{
  code: "OVW_EDGE_MISSING",
  severity: "error",
  stage: "overview_enforce",
  message: "overview edge (score → approve) not found in scene next rules",
  details: { source: "score", target: "approve" }
}
```

## 10. Conformance Checklist

1. A scene without a `view` block runs without any overview enforcement.
2. A `flow` that is empty or whitespace-only fails `OVW_FLOW_EMPTY` at parse stage.
3. An edge line before any node line fails `OVW_EDGE_WITHOUT_SOURCE`.
4. A duplicate `view "overview"` block fails `OVW_COMPILE_DUPLICATE`.
5. `nodes_only` enforcement passes when `overview_nodes ⊆ impl_nodes`, regardless of edges.
6. `at_least` enforcement passes when `overview_nodes ⊆ impl_nodes` AND `overview_data_edges ⊆ impl_data_edges`.
7. `strict` enforcement fails if the scene has actions not listed in the overview, or if the scene has next-rule edges not declared in the flow.
8. All enforcement violations are collected and reported before halting; implementations MUST NOT stop at the first violation.
9. Overview failures produce `invalid_overview`, not `invalid_graph`.
10. An action that appears only as an edge target — via standalone `|=>` or as the last element of a chain — is NOT in `overview_nodes` and triggers `OVW_NODE_EXTRA` under `strict` mode if it exists in `impl_nodes`. Authors MUST declare it as a standalone node line or as a non-terminal chain element to include it in the strict contract.
11. Duplicate node lines and duplicate edge pairs in the flow text are silently de-duplicated.
12. Re-running validation on the same scene model with the same `view` block produces identical enforcement results.
13. A chain line `a |=> b |=> c` adds `a` and `b` to `nodes`, adds edges `(a,b)` and `(b,c)`, and sets `current` to `c`. `c` is NOT added to `nodes`.
14. After a chain line, subsequent standalone `|=>` lines add edges from the last chain element (`current`), not from the first.
15. A chain line ending with `|=>` and no following identifier fails `OVW_CHAIN_NO_TARGET`.

# E2E Test Framework — Implementation Plan

> **Pipeline under test**: `.turn` → Go CLI converter → canonical HCL → TypeScript scene runner → STATE assertions

---

## Architecture: Three Layers

```
Route executor          ← cross-scene coordinator (scene-to-scene.md)
  └── Scene executor    ← within-scene action graph (scene-graph.md)
        └── Action executor  ← per-action compute lifecycle
              └── executeGraph (packages/ts/runtime)
```

**Route** groups one or more scenes, maintains a growing route history (`scene_id.action_id` entries), and evaluates `match` patterns whenever a scene reaches a terminal state to decide the next scene to enter. STATE is shared and never reset across scene boundaries within a route.

---

## Overview

The Go converter is complete. The TypeScript runtime has a compute-graph engine (`executeGraph`, `ctx()` builder) but no orchestration above the compute graph. This framework adds all three layers:

1. **JSON output from the Go converter** — TypeScript consumes the parsed model without an HCL parser
2. **A new `packages/ts/scene-runner/` package** — action/scene/route executors, STATE management, `from_state`/`from_action`/`from_hook` stubs, route history + pattern matching, and a test harness API
3. **E2E test suite** — covers both single-scene and multi-scene (route) workflows

---

## Phase 0 — Extend Go Converter: JSON Output

Add `-format json` flag to the CLI so the converter emits the lowered model as JSON alongside the existing `-format hcl` default.

### Tasks

- [ ] Add `EmitJSON(model *lower.Model) ([]byte, error)` in `packages/go/converter/internal/emit/`
- [ ] Add `-format` flag to `packages/go/converter/cmd/turnout/main.go` (`hcl` | `json`, default `hcl`)
- [ ] Write unit tests for JSON emitter

### JSON top-level shape

```json
{
  "state": { "namespaces": [...] },
  "scenes": [
    {
      "id": "scene_1",
      "entry_actions": ["analyze_request"],
      "next_policy": "first-match",
      "actions": [ { "id": "...", "compute": {...}, "prepare": [...], "merge": [...], "next": [...] } ]
    }
  ],
  "routes": [
    {
      "id": "route_1",
      "match": [
        { "patterns": [{ "scene_id": "scene_1", "wildcard": true, "suffix": ["final_action"] }], "target": "scene_2" },
        { "patterns": [{ "catch_all": true }], "target": "scene_other" }
      ]
    }
  ]
}
```

Note: `scenes` is an array (multiple scenes per file); `routes` is optional (may be absent for single-scene files).

---

## Phase 1 — TypeScript Scene Model Types

**File**: `src/types/scene-model.ts`

```typescript
type TurnModel        = { state: StateModel; scenes: SceneBlock[]; routes: RouteModel[] }
type StateModel       = { namespaces: NamespaceModel[] }
type NamespaceModel   = { name: string; fields: FieldModel[] }
type FieldModel       = { name: string; type: FieldTypeStr; value: Literal }

// Scene layer
type SceneBlock       = { id: string; entry_actions: string[]; next_policy: 'first-match' | 'all-match'; actions: ActionModel[] }
type ActionModel      = { id: string; compute: ComputeModel; prepare: PrepareEntry[]; merge: MergeEntry[]; publish?: string[]; next: NextRuleModel[] }
type ComputeModel     = { root: string; prog: ProgModel }
type ProgModel        = { name: string; bindings: BindingModel[] }
type BindingModel     = { name: string; type: FieldTypeStr; value?: Literal; expr?: ExprModel }
type ExprModel        = { combine: CombineExpr } | { pipe: PipeExpr } | { cond: CondExpr }
type PrepareEntry     = { binding: string } & ({ from_state: string } | { from_hook: string } | { from_literal: Literal })
type MergeEntry       = { binding: string; to_state: string }
type NextRuleModel    = { compute: NextComputeModel; prepare?: NextPrepareEntry[]; action: string }
type NextPrepareEntry = { binding: string } & ({ from_action: string } | { from_state: string } | { from_literal: Literal })

// Route layer
type RouteModel       = { id: string; match: MatchArm[] }
type MatchArm         = { patterns: PathPattern[]; target: string }  // patterns are OR-joined
type PathPattern      = CatchAllPattern | PathExprPattern
type CatchAllPattern  = { catch_all: true }
type PathExprPattern  = { scene_id: string; wildcard: boolean; suffix: string[] }
// wildcard=false: suffix=[action_id] → exact  e.g. scene_1.final
// wildcard=true:  suffix=[...] → prefix wildcard  e.g. scene_1.*.foo.bar
```

**File**: `src/types/harness-types.ts`

```typescript
type HarnessOptions = {
  turnFile?: string       // invokes Go CLI
  jsonFile?: string       // loads pre-converted JSON
  entryScene: string      // which scene (or route) to start from
  initialState: Record<string, AnyValue>
  hooks?: HookRegistry
}
type HarnessResult = { finalState: Record<string, AnyValue>; trace: ExecutionTrace; model: TurnModel }
type ExecutionTrace = { routes: RouteTrace[] }
type RouteTrace     = { routeId: string; scenes: SceneTrace[] }
type SceneTrace     = { sceneId: string; actions: ActionTrace[] }
type ActionTrace    = { actionId: string; computeRootValue: AnyValue; nextActionIds: string[] }
```

### Tasks

- [ ] Write `src/types/scene-model.ts`
- [ ] Write `src/types/harness-types.ts`

---

## Phase 2 — Converter Bridge

**File**: `src/converter/bridge.ts`

```typescript
function runConverter(turnFilePath: string): TurnModel   // invokes Go CLI, returns parsed model
function loadJsonModel(jsonFilePath: string): TurnModel  // loads pre-built JSON
```

### Tasks

- [ ] Implement `src/converter/bridge.ts`

---

## Phase 3 — State Manager

**File**: `src/state/state-manager.ts`

STATE is a flat `Record<string, AnyValue>` keyed by dotted path (`"request.query"`). No nested structures — flat map only. STATE is shared and carried across scene boundaries within a route; it is never reset between scenes.

```typescript
class StateManager {
  constructor(private readonly state: Record<string, AnyValue>) {}

  read(path: string): AnyValue | undefined
  write(path: string, value: AnyValue): StateManager   // immutable, returns new instance
  snapshot(): Readonly<Record<string, AnyValue>>
  static fromSchema(stateModel: StateModel): StateManager  // populate defaults from schema
}
```

### Tasks

- [ ] Implement `src/state/state-manager.ts`
- [ ] Unit tests: read, write (immutability), `fromSchema`

---

## Phase 4 — HCL Context Builder

**File**: `src/executor/hcl-context-builder.ts`

Translates a `ProgModel` + injected prepare values → `ExecutionContext` using the existing builder API.

```typescript
type BuiltContext = {
  exec: ExecutionContext
  ids: Record<string, FuncId | ValueId>
  nameToValueId: Record<string, ValueId>   // needed for from_action lookup
}

function buildContextFromProg(
  prog: ProgModel,
  injectedValues: Record<string, AnyValue>
): BuiltContext
```

Lowering rules: value binding → `val()`, combine → `combine()`, pipe → `pipe()`, cond → `cond()`. Injected prepare values override the prog's declared placeholder default.

**Reuses**: `ctx`, `combine`, `pipe`, `cond`, `val`, `ref` from `packages/ts/runtime/src/compute-graph/builder/index.ts`

### Tasks

- [ ] Implement `src/executor/hcl-context-builder.ts`
- [ ] Unit tests with sample `ProgModel` fixtures

---

## Phase 5 — Prepare Resolver (Stubs)

**File**: `src/executor/prepare-resolver.ts`

### Action-level prepare (`from_state` | `from_hook` | `from_literal`)

```typescript
function resolveActionPrepare(
  entries: PrepareEntry[],
  state: StateManager,
  hooks: HookRegistry
): Record<string, AnyValue>
```

| Source | Resolution |
|--------|-----------|
| `from_state` | `state.read(path)` — **from_state stub** |
| `from_hook` | `hooks[hookName](ctx)` → extract field matching binding name — **from_hook stub** |
| `from_literal` | wrap with `buildNumber` / `buildString` / `buildBoolean` |

### Next-rule prepare (`from_action` | `from_state` | `from_literal`)

```typescript
function resolveNextPrepare(
  entries: NextPrepareEntry[],
  state: StateManager,
  prevResult: ActionExecutionResult
): Record<string, AnyValue>
```

| Source | Resolution |
|--------|-----------|
| `from_action` | `prevResult.bindingValues[name]` — **from_action stub** |
| `from_state` | `state.read(path)` (post-merge S_{n+1}) |
| `from_literal` | wrap literal |

### Hook registry

```typescript
type HookContext  = { readState: (path: string) => AnyValue | undefined }
type HookHandler  = (ctx: HookContext) => Record<string, AnyValue>
type HookRegistry = Record<string, HookHandler>
```

### Tasks

- [ ] Implement `src/executor/prepare-resolver.ts`
- [ ] Unit tests for each source type

---

## Phase 6 — Action Executor

**File**: `src/executor/action-executor.ts`

```typescript
type ActionExecutionResult = {
  actionId: string
  computeRootValue: AnyValue
  bindingValues: Record<string, AnyValue>   // all prog binding values by name
  stateAfterMerge: StateManager
}

function executeAction(
  action: ActionModel,
  state: StateManager,
  hooks: HookRegistry
): ActionExecutionResult
```

Steps: resolve prepare → build context → `assertValidContext` → `executeGraph` → extract binding values via `nameToValueId` → apply merge to STATE.

**Reuses**: `assertValidContext`, `executeGraph` from `packages/ts/runtime`

### Tasks

- [ ] Implement `src/executor/action-executor.ts`
- [ ] Unit tests with mock `ActionModel`

---

## Phase 7 — Scene Executor

**File**: `src/executor/scene-executor.ts`

```typescript
type SceneExecutionResult = {
  sceneId: string
  stateAfterScene: StateManager
  trace: ActionTrace[]
  terminatedAt: string[]    // final action IDs (no matching next rule)
}

function executeScene(
  scene: SceneBlock,
  state: StateManager,
  hooks?: HookRegistry
): SceneExecutionResult
```

Algorithm:
1. `queue = [...scene.entry_actions]`
2. While non-empty: dequeue action → `executeAction` → update state → evaluate next rules → route per `next_policy`
3. For each next rule: build & execute its `compute.prog` with `resolveNextPrepare` injected → condition bool → collect matches
4. `first-match`: push first match and break; `all-match`: push all matches

### Tasks

- [ ] Implement `src/executor/scene-executor.ts`
- [ ] Unit tests: first-match, all-match, no-match termination

---

## Phase 8 — Route History & Pattern Matching

**File**: `src/executor/route-pattern.ts`

Route history is a `string[]` of `"scene_id.action_id"` entries accumulated across all scenes in a route invocation. It resets each time the route is entered.

### Contiguous-block extraction

For a given `scene_id`, find the **longest uninterrupted run** of `scene_id.*` entries at the tail of the current history (i.e., ending at the current last entry). Entries from other scenes break the block.

```typescript
function extractContiguousBlock(history: string[], sceneId: string): string[]
// Returns the action_id sequence for the most recent contiguous block of scene_id
// e.g. history = ["s1.a", "s2.x", "s1.b", "s1.final"], sceneId = "s1"
//      → ["b", "final"]  (second contiguous block, ending at tail)
```

Wait — per spec §2.3, if scene is visited more than once, the **first** contiguous block (earliest in history) that satisfies the pattern determines a match. So pattern evaluation checks all contiguous blocks, not just the tail.

```typescript
function extractAllContiguousBlocks(history: string[], sceneId: string): string[][]
// Returns all contiguous blocks of scene_id entries in history order
```

### Pattern matching

```typescript
function matchesPattern(block: string[], pattern: PathExprPattern): boolean
// wildcard=false: block's last entry === suffix[0] (and block.length === 1)
// wildcard=true:  block ends with suffix sequence (in order)

function evaluateMatchArm(history: string[], arm: MatchArm): boolean
// true if any pattern in arm.patterns matches (OR semantics)
// CatchAllPattern always returns true

function selectNextScene(history: string[], arms: MatchArm[]): string | null
// Apply priority:
//   1. Fewer wildcards = higher priority
//   2. Same wildcard count: longer suffix = higher priority
//   3. Same count + length: declaration order
// Returns target scene_id, or null if no match (route enters completed state)
```

### Tasks

- [ ] Implement `src/executor/route-pattern.ts`
- [ ] Unit tests covering all match forms, priority rules, OR patterns, catch-all, interleaved history, multiple-visit semantics

---

## Phase 9 — Route Executor

**File**: `src/executor/route-executor.ts`

```typescript
type RouteExecutionResult = {
  routeId: string
  finalState: Record<string, AnyValue>
  history: string[]               // final route history
  trace: SceneTrace[]
  status: 'completed' | 'matched_exhausted'
}

function executeRoute(
  route: RouteModel,
  scenes: Record<string, SceneBlock>,   // all scenes keyed by id
  entrySceneId: string,
  initialState: Record<string, AnyValue>,
  hooks?: HookRegistry
): RouteExecutionResult
```

Algorithm:
1. Reset `history = []`; `state = StateManager.fromSchema(...) + initialState`
2. `currentSceneId = entrySceneId`
3. Loop:
   a. `result = executeScene(scenes[currentSceneId], state, hooks)`
   b. Append each `sceneId.actionId` from `result.trace` to `history`
   c. `state = result.stateAfterScene`
   d. `nextSceneId = selectNextScene(history, route.match)`
   e. If `nextSceneId` is null → `status = 'completed'`, break
   f. `currentSceneId = nextSceneId`

### Tasks

- [ ] Implement `src/executor/route-executor.ts`
- [ ] Unit tests: single-scene route, two-scene route, catch-all fallback, completed state

---

## Phase 10 — Harness API

**File**: `src/harness/harness.ts`

```typescript
function runHarness(options: HarnessOptions): HarnessResult
```

- If `entryScene` matches a `route.id` → use `executeRoute`
- If `entryScene` matches a `scene.id` directly → use `executeScene` (single-scene mode, no history)
- Returns `HarnessResult` with `finalState`, full `ExecutionTrace`, and `TurnModel`

### Tasks

- [ ] Implement `src/harness/harness.ts`
- [ ] `src/index.ts` — export public API

---

## Phase 11 — E2E Test Suite

**Location**: `packages/ts/scene-runner/tests/e2e/`

### Single-scene tests (current examples, no `route` block)

#### `llm-workflow.test.ts`

| Test | Key STATE | Expected |
|------|-----------|----------|
| Retrieval path | `need_grounding=true, kb_enabled=true, toxicity=1, pii=0` | `workflow.status="sent"`, `last_response` contains query + doc_hint |
| Direct draft path | `need_grounding=false, toxicity=1, pii=0` | `workflow.status="sent"`, `last_response` starts with `"Direct answer: "` |
| Human review path | any draft, `toxicity=5` | `workflow.status="awaiting_human"`, `review.note` starts with `"Review needed: "` |

#### `scene-graph-with-actions.test.ts`, `detective-phase.test.ts`, `adventure-story-graph-with-actions.test.ts`

Similar path-coverage tests (2–3 paths per file).

### Route-level tests

Route-level E2E tests require multi-scene `.turn` files with `route` blocks. These will be authored alongside the test files as fixtures in `tests/fixtures/`:

#### `tests/fixtures/two-scene-route.turn` (to be written)

A minimal two-scene workflow:
- `scene_intake` → collects data, terminates at `intake_done`
- `scene_process` → uses STATE left by `scene_intake`, terminates at `process_done`
- `route "main" { match { scene_intake.*.intake_done => scene_process, _ => scene_process } }`

#### `route-execution.test.ts`

| Test | Scenario | Expected |
|------|----------|----------|
| Two-scene route | scene_1 terminal → matches pattern → enters scene_2 | final STATE reflects both scenes' merges |
| Catch-all fallback | scene_1 terminal with no specific match | `_` routes to fallback scene |
| Completed state | no `_`, no match | `status = 'completed'` |
| History accumulation | STATE shared across scenes | scene_2 reads STATE written by scene_1 |
| Priority: exact beats wildcard | Two arms match; exact `scene.action` vs `scene.*.action` | exact arm selected |

### Tasks

- [ ] `tests/e2e/llm-workflow.test.ts`
- [ ] `tests/e2e/scene-graph-with-actions.test.ts`
- [ ] `tests/e2e/detective-phase.test.ts`
- [ ] `tests/e2e/adventure-story-graph-with-actions.test.ts`
- [ ] `tests/fixtures/two-scene-route.turn`
- [ ] `tests/e2e/route-execution.test.ts`

---

## Package Setup

### Tasks

- [ ] Create `packages/ts/scene-runner/package.json` with dependency on `@turnout/runtime`
- [ ] Create `packages/ts/scene-runner/tsconfig.json`
- [ ] Create `packages/ts/scene-runner/vitest.config.ts`

---

## File Map

```
packages/go/converter/
  internal/emit/emit.go          ← add EmitJSON()
  cmd/turnout/main.go            ← add -format flag

packages/ts/scene-runner/        ← new package
  src/
    types/
      scene-model.ts             ← TurnModel, SceneBlock, RouteModel, PathPattern, etc.
      harness-types.ts           ← HarnessOptions, HarnessResult, ExecutionTrace
    converter/
      bridge.ts                  ← runConverter(), loadJsonModel()
    state/
      state-manager.ts           ← StateManager (flat KV, immutable writes)
    executor/
      hcl-context-builder.ts     ← ProgModel → ExecutionContext
      prepare-resolver.ts        ← from_state / from_action / from_hook stubs
      action-executor.ts         ← executeAction()
      scene-executor.ts          ← executeScene()
      route-pattern.ts           ← history extraction, pattern matching, priority
      route-executor.ts          ← executeRoute()
    harness/
      harness.ts                 ← runHarness() (dispatches to scene or route executor)
    index.ts
  tests/
    fixtures/
      two-scene-route.turn       ← minimal multi-scene fixture
    e2e/
      llm-workflow.test.ts
      scene-graph-with-actions.test.ts
      detective-phase.test.ts
      adventure-story-graph-with-actions.test.ts
      route-execution.test.ts
  package.json
  tsconfig.json
  vitest.config.ts
```

---

## Runtime Package — Reused Components (read-only)

| Component | Path |
|-----------|------|
| `ctx`, `combine`, `pipe`, `cond`, `val`, `ref` | `packages/ts/runtime/src/compute-graph/builder/index.ts` |
| `executeGraph`, `executeGraphSafe` | `packages/ts/runtime/src/compute-graph/runtime/exec/executeGraph.ts` |
| `assertValidContext` | `packages/ts/runtime/src/compute-graph/runtime/validateContext.ts` |
| `buildNumber`, `buildString`, `buildBoolean`, `buildArray` | `packages/ts/runtime/src/state-control/value-builders.ts` |
| `AnyValue`, type guards | `packages/ts/runtime/src/state-control/value.ts` |

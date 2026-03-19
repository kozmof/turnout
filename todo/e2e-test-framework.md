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

## Phase 0 — Extend Go Converter: JSON Output ✅

Add `-format json` flag to the CLI so the converter emits the lowered model as JSON alongside the existing `-format hcl` default.

### Tasks

- [x] Add `EmitJSON(w io.Writer, model *lower.Model) error` in `packages/go/converter/internal/emit/json.go`
- [x] Add `-format` flag to `packages/go/converter/cmd/turnout/main.go` (`hcl` | `json`, default `hcl`)
- [x] Write unit test `TestEmitJSONBasic` in `emit_test.go`

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
        { "patterns": ["scene_1.*.final_action"], "target": "scene_2" },
        { "patterns": ["_"], "target": "scene_other" }
      ]
    }
  ]
}
```

Notes:
- `scenes` is always an array; the current converter emits one scene per file (single-element array)
- `routes` is omitted when absent
- Route patterns are raw strings (`"_"`, `"scene.action"`, `"scene.*.action.action"`) — parsed by the TypeScript side
- `step_ref` uses a JSON pointer so `step_ref=0` serialises correctly as `0`

---

## Phase 1 — TypeScript Scene Model Types ✅

**Package**: `packages/ts/scene-runner/` (new; depends on `turnout` runtime via `file:../runtime`)

### Files created

- `src/types/scene-model.ts` — `TurnModel`, `SceneBlock`, `ActionModel`, `BindingModel`, `ExprModel` (discriminated union), `ArgModel` (discriminated union), `PrepareEntry`, `NextPrepareEntry`, `RouteModel`, `MatchArm`
- `src/types/harness-types.ts` — `HarnessOptions`, `HarnessResult`, `HookRegistry`, `HookContext`, `ExecutionTrace` (discriminated: `scene` | `route`), `ActionTrace`, `SceneTrace`, `RouteTrace`
- `package.json`, `tsconfig.json` — package scaffolding; `pnpm install` run

### Key design notes

- `PrepareEntry` is a discriminated union: `from_state` XOR `from_hook` (action-level; `from_literal` not emitted at action level by the converter)
- `NextPrepareEntry` is a discriminated union: `from_action` XOR `from_state` XOR `from_literal`
- `MatchArm.patterns` is `string[]` — raw strings from the converter, parsed into structured form by `route-pattern.ts`
- `HarnessOptions.entryId` dispatches to scene or route executor based on whether it matches a `route.id` or `scene.id`

---

## Phase 2 — Converter Bridge ✅

**File**: `src/converter/bridge.ts`

```typescript
function runConverter(turnFilePath: string): TurnModel   // invokes Go CLI, returns parsed model
function loadJsonModel(jsonFilePath: string): TurnModel  // loads pre-built JSON
```

- `runConverter` calls `execFileSync('turnout', ['convert', path, '-o', '-', '-format', 'json'])`
- Falls back to looking for the binary next to the Go converter source if not on PATH
- Both functions throw with a descriptive message on failure

---

## Phase 3 — State Manager ✅

**File**: `src/state/state-manager.ts`

STATE is a flat `Record<string, AnyValue>` keyed by dotted path (`"request.query"`). No nested structures. STATE is shared and carried across scene boundaries within a route; it is never reset between scenes.

```typescript
class StateManager {
  static from(initial: Record<string, AnyValue>): StateManager
  static fromSchema(stateModel: StateModel, overrides?: Record<string, AnyValue>): StateManager
  read(path: string): AnyValue | undefined
  write(path: string, value: AnyValue): StateManager   // immutable — returns new instance
  snapshot(): Readonly<Record<string, AnyValue>>
}
```

Also exports `literalToValue(value, type)` for use by the prepare resolver.

**Tests**: `tests/state-manager.test.ts` — 7 passing unit tests covering `from`, `fromSchema`, `read`, `write` immutability, `snapshot`, override precedence.

---

## Phase 4 — HCL Context Builder ✅

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

- [x] Implement `src/executor/hcl-context-builder.ts`
- [x] Unit tests with sample `ProgModel` fixtures

---

## Phase 5 — Prepare Resolver (Stubs) ✅

**File**: `src/executor/prepare-resolver.ts`

### Action-level prepare (`from_state` | `from_hook`)

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
| `from_literal` | `literalToValue(value, bindingType)` |

### Tasks

- [x] Implement `src/executor/prepare-resolver.ts`
- [x] Unit tests for each source type

---

## Phase 6 — Action Executor ✅

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

- [x] Implement `src/executor/action-executor.ts`
- [x] Unit tests with mock `ActionModel`

---

## Phase 7 — Scene Executor ✅

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

- [x] Implement `src/executor/scene-executor.ts`
- [x] Unit tests: first-match, all-match, no-match termination

---

## Phase 8 — Route History & Pattern Matching ✅

**File**: `src/executor/route-pattern.ts`

Route history is a `string[]` of `"scene_id.action_id"` entries accumulated across all scenes in a route invocation. It resets each time the route is entered.

### Contiguous-block extraction

Per spec §2.3: when a scene is visited more than once, the **first** contiguous block (earliest in history) that satisfies the pattern determines a match.

```typescript
// Returns all contiguous blocks of scene_id entries in history order
function extractAllContiguousBlocks(history: string[], sceneId: string): string[][]
```

### Pattern matching

Patterns arrive as raw strings from the converter JSON:
- `"_"` → catch-all
- `"scene_id.action_id"` → exact (no wildcard)
- `"scene_id.*.action_id"` → wildcard prefix
- `"scene_id.*.action_a.action_b"` → wildcard prefix + multi-step suffix

```typescript
function evaluateMatchArm(history: string[], arm: MatchArm): boolean
// true if any pattern in arm.patterns matches (OR semantics)

function selectNextScene(history: string[], arms: MatchArm[]): string | null
// Priority: fewer wildcards > longer suffix > declaration order
// Returns null if no arm matches (route enters completed state)
```

### Tasks

- [x] Implement `src/executor/route-pattern.ts`
- [x] Unit tests: exact, wildcard, OR, catch-all, priority, interleaved history, multiple-visit semantics

---

## Phase 9 — Route Executor ✅

**File**: `src/executor/route-executor.ts`

```typescript
type RouteExecutionResult = {
  routeId: string
  finalState: Record<string, AnyValue>
  history: string[]
  trace: SceneTrace[]
  status: 'completed' | 'matched_exhausted'
}

function executeRoute(
  route: RouteModel,
  scenes: Record<string, SceneBlock>,
  entrySceneId: string,
  initialState: Record<string, AnyValue>,
  hooks?: HookRegistry
): RouteExecutionResult
```

Algorithm:
1. Reset `history = []`; `state = StateManager.fromSchema(...) + initialState`
2. `currentSceneId = entrySceneId`
3. Loop: execute scene → append `sceneId.actionId` entries to history → update state → `selectNextScene` → repeat or break

### Tasks

- [x] Implement `src/executor/route-executor.ts`
- [x] Unit tests: single-scene route, two-scene route, OR pattern, STATE propagation, completed state

---

## Phase 10 — Harness API ✅

**File**: `src/harness/harness.ts`

```typescript
function runHarness(options: HarnessOptions): HarnessResult
```

- If `entryId` matches a `route.id` → use `executeRoute`
- If `entryId` matches a `scene.id` directly → use `executeScene` (single-scene mode, no history)
- Returns `HarnessResult` with `finalState`, full `ExecutionTrace`, and `TurnModel`

### Tasks

- [x] Implement `src/harness/harness.ts`
- [x] `src/index.ts` — export public API

---

## Phase 11 — E2E Test Suite ✅

**Location**: `packages/ts/scene-runner/tests/e2e/`

### Single-scene tests (current examples, no `route` block)

> Note: example `.turn` files in `spec/examples/` have no `state` block. The bridge must prepend a minimal `state {}` or the tests must supply a state file. The converter requires a state source.

#### `llm-workflow.test.ts`

| Test | Key STATE | Expected |
|------|-----------|----------|
| Retrieval path | `need_grounding=true, kb_enabled=true, toxicity=1, pii=0` | `workflow.status="sent"`, `last_response` contains query + doc_hint |
| Direct draft path | `need_grounding=false, toxicity=1, pii=0` | `workflow.status="sent"`, `last_response` starts with `"Direct answer: "` |
| Human review path | any draft, `toxicity=5` | `workflow.status="awaiting_human"`, `review.note` starts with `"Review needed: "` |

#### `scene-graph-with-actions.test.ts`, `detective-phase.test.ts`, `adventure-story-graph-with-actions.test.ts`

Similar path-coverage tests (2–3 paths per file).

### Route-level tests

#### `tests/fixtures/two-scene-route.turn` (to be authored)

A minimal two-scene workflow with a `state` block, two scenes, and a `route` block.

#### `route-execution.test.ts`

| Test | Scenario | Expected |
|------|----------|----------|
| Two-scene route | scene_1 terminal → matches pattern → enters scene_2 | final STATE reflects both scenes' merges |
| Catch-all fallback | scene_1 terminal with no specific match | `_` routes to fallback scene |
| Completed state | no `_`, no match | `status = 'completed'` |
| STATE shared across scenes | scene_2 reads STATE written by scene_1 | correct STATE propagation |
| Priority: exact beats wildcard | two arms match | exact arm (`scene.action`) selected over `scene.*.action` |

### Tasks

- [x] `tests/e2e/workflow.test.ts` (simplified workflow fixture)
- [x] `tests/e2e/scene-graph.test.ts`
- [~] `tests/e2e/detective-phase.test.ts` (deferred — multi-scene needs converter fix)
- [~] `tests/e2e/adventure-story-graph-with-actions.test.ts` (deferred)
- [x] `tests/fixtures/two-scene-route.json` (hand-crafted; converter bug with multi-scene files)
- [x] `tests/e2e/route-execution.test.ts`

---

## File Map

```
packages/go/converter/
  internal/emit/
    emit.go                        (existing — HCL emitter)
    json.go                     ✅ EmitJSON() — JSON emitter
  cmd/turnout/main.go             ✅ -format hcl|json flag

packages/ts/scene-runner/        ✅ new package (pnpm, vitest, @types/node)
  src/
    types/
      scene-model.ts              ✅ TurnModel, SceneBlock, RouteModel, ArgModel, etc.
      harness-types.ts            ✅ HarnessOptions, HarnessResult, ExecutionTrace
    converter/
      bridge.ts                   ✅ runConverter(), loadJsonModel()
    state/
      state-manager.ts            ✅ StateManager (flat KV, immutable writes, fromSchema)
    executor/
      types.ts                    ✅ ActionExecutionResult (shared type)
      hcl-context-builder.ts      ✅ ProgModel → ExecutionContext
      prepare-resolver.ts         ✅ from_state / from_action / from_hook stubs
      action-executor.ts          ✅ executeAction()
      scene-executor.ts           ✅ executeScene()
      route-pattern.ts            ✅ history extraction, pattern matching, priority
      route-executor.ts           ✅ executeRoute()
    harness/
      harness.ts                     runHarness()
    index.ts
  tests/
    state-manager.test.ts         ✅ 7 passing unit tests
    fixtures/
      two-scene-route.turn
    e2e/
      llm-workflow.test.ts
      scene-graph-with-actions.test.ts
      detective-phase.test.ts
      adventure-story-graph-with-actions.test.ts
      route-execution.test.ts
  package.json                    ✅
  tsconfig.json                   ✅
```

---

## Runtime Package — Reused Components (read-only)

| Component | Path |
|-----------|------|
| `ctx`, `combine`, `pipe`, `cond`, `val`, `ref` | `packages/ts/runtime/src/compute-graph/builder/index.ts` |
| `executeGraph`, `executeGraphSafe` | `packages/ts/runtime/src/compute-graph/runtime/exec/executeGraph.ts` |
| `assertValidContext` | `packages/ts/runtime/src/compute-graph/runtime/validateContext.ts` |
| `buildNumber`, `buildString`, `buildBoolean`, `buildArray`, `buildNull` | `packages/ts/runtime/src/state-control/value-builders.ts` |
| `AnyValue`, type guards (`isPureNumber`, `isPureString`, …) | `packages/ts/runtime/src/state-control/value.ts` |

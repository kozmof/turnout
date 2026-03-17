# E2E Test Framework — Implementation Plan

> **Pipeline under test**: `.turn` → Go CLI converter → canonical HCL → TypeScript scene runner → STATE assertions

---

## Overview

The Go converter is complete. The TypeScript runtime has a compute-graph engine (`executeGraph`, `ctx()` builder) but no scene orchestration. This framework adds:

1. **JSON output from the Go converter** — so TypeScript can consume the parsed model without an HCL parser
2. **A new `packages/ts/scene-runner/` package** — scene orchestration, STATE management, `from_state`/`from_action`/`from_hook` resolution, and a test harness API
3. **E2E test suite** — one file per example `.turn` file, covering multiple execution paths

---

## Phase 0 — Extend Go Converter: JSON Output

Add `-format json` flag to the CLI so the converter can emit the lowered model as JSON (alongside the existing `-format hcl` default). TypeScript consumes this directly—no HCL parsing needed.

### Tasks

- [ ] Add `EmitJSON(model *lower.Model) ([]byte, error)` in `packages/go/converter/internal/emit/`
- [ ] Add `-format` flag to `packages/go/converter/cmd/turnout/main.go` (`hcl` | `json`, default `hcl`)
- [ ] Write unit tests for JSON emitter (parallel to existing `emit_test.go`)

### JSON schema (key shape)

```json
{
  "state": {
    "namespaces": [
      { "name": "request", "fields": [{ "name": "query", "type": "str", "value": "" }] }
    ]
  },
  "scene": {
    "id": "llm_support_workflow",
    "entry_actions": ["analyze_request"],
    "next_policy": "first-match",
    "actions": [
      {
        "id": "analyze_request",
        "compute": {
          "root": "analysis_ready",
          "prog": {
            "name": "analyze_request_graph",
            "bindings": [
              { "name": "need_grounding", "type": "bool", "value": false },
              { "name": "analysis_ready", "type": "bool", "expr": { "combine": { "fn": "bool_and", "args": [{ "ref": "need_grounding" }, { "lit": true }] } } }
            ]
          }
        },
        "prepare":  [{ "binding": "need_grounding", "from_state": "request.flags.need_grounding" }],
        "merge":    [{ "binding": "workflow_stage",  "to_state":   "workflow.stage" }],
        "next": [
          {
            "compute": { "condition": "go_retrieve", "prog": { "name": "to_retrieve_context", "bindings": [...] } },
            "prepare": [{ "binding": "retrieve_ready", "from_action": "retrieve_ready" }],
            "action":  "retrieve_context"
          }
        ]
      }
    ]
  }
}
```

---

## Phase 1 — TypeScript Scene Model Types

**Package**: `packages/ts/scene-runner/`
**File**: `src/types/scene-model.ts`

Mirrors the JSON schema exactly. Key types:

```typescript
type SceneModel       = { state: StateModel; scene: SceneBlock }
type StateModel       = { namespaces: NamespaceModel[] }
type NamespaceModel   = { name: string; fields: FieldModel[] }
type FieldModel       = { name: string; type: FieldTypeStr; value: Literal }
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
```

### Tasks

- [ ] Write `src/types/scene-model.ts` with all types above
- [ ] Write `src/types/harness-types.ts` (`HarnessOptions`, `HarnessResult`, `ActionTrace`)

---

## Phase 2 — Converter Bridge

**File**: `src/converter/bridge.ts`

Invokes the Go CLI and returns a parsed `SceneModel`. Also supports loading a pre-built JSON file to skip the CLI (useful for CI speed).

```typescript
// Invoke Go CLI; returns SceneModel
function runConverter(turnFilePath: string): SceneModel

// Load pre-built JSON directly
function loadJsonModel(jsonFilePath: string): SceneModel
```

Uses `execFileSync('turnout', ['convert', turnFilePath, '-o', '-', '-format', 'json'])`.

### Tasks

- [ ] Implement `src/converter/bridge.ts`

---

## Phase 3 — State Manager

**File**: `src/state/state-manager.ts`

STATE is a plain `Record<string, AnyValue>` keyed by dotted paths (`"request.query"`). No nested objects — flat map only.

```typescript
class StateManager {
  constructor(private readonly state: Record<string, AnyValue>) {}

  read(path: string): AnyValue | undefined          // "request.query" → AnyValue
  write(path: string, value: AnyValue): StateManager // immutable, returns new instance
  snapshot(): Readonly<Record<string, AnyValue>>
  // Initialize from STATE schema with default values
  static fromSchema(stateModel: StateModel): StateManager
}
```

Path format: `"namespace.field"` (matches `from_state` / `to_state` values in the HCL).

### Tasks

- [ ] Implement `src/state/state-manager.ts`
- [ ] Unit tests: read, write (immutability), `fromSchema` default values

---

## Phase 4 — HCL Context Builder

**File**: `src/executor/hcl-context-builder.ts`

Translates a `ProgModel` + injected prepare values → `ExecutionContext` using the existing builder API from `packages/ts/runtime`.

```typescript
type BuiltContext = {
  exec: ExecutionContext
  ids: Record<string, FuncId | ValueId>   // binding name → ID
  nameToValueId: Record<string, ValueId>  // binding name → ValueId (for from_action lookup)
}

function buildContextFromProg(
  prog: ProgModel,
  injectedValues: Record<string, AnyValue>  // pre-resolved prepare values override prog defaults
): BuiltContext
```

Lowering rules per binding type:
- `binding.value` present → `val(injectedValues[name] ?? literalToAnyValue(binding.value))`
- `expr.combine` → `combine(fn, { a: resolveArg(a), b: resolveArg(b) })`
- `expr.pipe` → `pipe(argBindings, steps)`
- `expr.cond` → `cond(condition, thenRef, elseRef)`

**Reuses**: `ctx`, `combine`, `pipe`, `cond`, `val`, `ref` from `packages/ts/runtime/src/compute-graph/builder/index.ts`

### Tasks

- [ ] Implement `src/executor/hcl-context-builder.ts`
- [ ] Unit tests with sample `ProgModel` fixtures

---

## Phase 5 — Prepare Resolver (Stubs)

**File**: `src/executor/prepare-resolver.ts`

This is where `from_state` and `from_action` are concretely implemented for the test context.

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
| `from_hook` | `hooks[hookName](hookCtx)` → extract field matching `binding` name — **from_hook stub** |
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
| `from_action` | `prevResult.bindingValues[bindingName]` — **from_action stub** (reads from the previous action's compute result via `nameToValueId` map) |
| `from_state` | `state.read(path)` (reads post-merge S_{n+1}) |
| `from_literal` | wrap literal |

### Hook registry

```typescript
type HookContext = { readState: (path: string) => AnyValue | undefined }
type HookHandler = (ctx: HookContext) => Record<string, AnyValue>
type HookRegistry = Record<string, HookHandler>
```

### Tasks

- [ ] Implement `src/executor/prepare-resolver.ts`
- [ ] Unit tests for each source type including missing-hook fallback

---

## Phase 6 — Action Executor

**File**: `src/executor/action-executor.ts`

```typescript
type ActionExecutionResult = {
  actionId: string
  computeRootValue: AnyValue
  bindingValues: Record<string, AnyValue>  // all prog bindings by name
  stateAfterMerge: StateManager
}

function executeAction(
  action: ActionModel,
  state: StateManager,
  hooks: HookRegistry
): ActionExecutionResult
```

Execution steps:
1. `resolveActionPrepare(action.prepare, state, hooks)` → `preparedValues`
2. `buildContextFromProg(action.compute.prog, preparedValues)` → `{ exec, ids, nameToValueId }`
3. `assertValidContext(exec)` (from runtime package)
4. Root func ID = `ids[action.compute.root]` as `FuncId`
5. `executeGraph(rootFuncId, validatedCtx)` → `result`
6. Build `bindingValues`: for each `[name, valueId]` in `nameToValueId`, look up `result.updatedValueTable[valueId]`
7. Apply merge: for each `MergeEntry` → `state.write(toState, bindingValues[binding])`
8. Return `ActionExecutionResult`

**Reuses**: `assertValidContext`, `executeGraph` from `packages/ts/runtime`

### Tasks

- [ ] Implement `src/executor/action-executor.ts`
- [ ] Unit tests with mock `ActionModel` and controlled STATE

---

## Phase 7 — Scene Executor

**File**: `src/executor/scene-executor.ts`

```typescript
type SceneExecutionResult = {
  finalState: Record<string, AnyValue>
  trace: ActionTrace[]
  terminatedAt: string[]   // action IDs with no matching next rule
}

type ActionTrace = {
  actionId: string
  preparedValues: Record<string, AnyValue>
  computeRootValue: AnyValue
  nextActionIds: string[]
}

function executeScene(
  model: SceneModel,
  initialState: Record<string, AnyValue>,
  hooks?: HookRegistry
): SceneExecutionResult
```

Algorithm:
1. `state = StateManager.fromSchema(model.state)` + overlay `initialState` values
2. `queue = [...model.scene.entry_actions]`
3. While queue non-empty:
   - Dequeue `actionId` → find `ActionModel`
   - `result = executeAction(action, state, hooks)`
   - `state = result.stateAfterMerge`
   - For each `next` rule in action:
     - `resolveNextPrepare(next.prepare, state, result)` → `nextValues`
     - `buildContextFromProg(next.compute.prog, nextValues)` + execute → condition value (bool)
     - If condition is `true`:
       - `first-match`: push next action to queue and `break`
       - `all-match`: collect all matching, push all
   - Record trace entry
4. Return `SceneExecutionResult`

### Tasks

- [ ] Implement `src/executor/scene-executor.ts`
- [ ] Unit tests: first-match routing, all-match routing, no-match termination

---

## Phase 8 — Harness API

**File**: `src/harness/harness.ts`

```typescript
type HarnessOptions = {
  turnFile?: string    // invokes Go CLI converter
  jsonFile?: string    // loads pre-converted JSON (skips CLI)
  initialState: Record<string, AnyValue>
  hooks?: HookRegistry
}

type HarnessResult = SceneExecutionResult & { model: SceneModel }

function runHarness(options: HarnessOptions): HarnessResult
```

### Tasks

- [ ] Implement `src/harness/harness.ts`
- [ ] `src/index.ts` — export `runHarness`, `HookRegistry`, `HarnessOptions`, `HarnessResult`

---

## Phase 9 — E2E Test Suite

**Location**: `packages/ts/scene-runner/tests/e2e/`

One test file per example `.turn` file in `spec/examples/`. Each file covers 2–3 distinct execution paths.

### `llm-workflow.test.ts`

| Test | Initial STATE | Expected outcome |
|------|--------------|-----------------|
| Retrieval path | `need_grounding=true, kb_enabled=true, toxicity=1, pii=0` | `workflow.status="sent"`, `conversation.last_response` contains `"what is ML? :: ML is machine learning"` |
| Direct draft path | `need_grounding=false, toxicity=1, pii=0` | `workflow.status="sent"`, `conversation.last_response` starts with `"Direct answer: "` |
| Human review path | `need_grounding=false, toxicity=5` | `workflow.status="awaiting_human"`, `review.note` starts with `"Review needed: "` |

### `scene-graph-with-actions.test.ts`, `detective-phase.test.ts`, `adventure-story-graph-with-actions.test.ts`

Similar path-coverage tests based on each scene's branching structure.

### Tasks

- [ ] `tests/e2e/llm-workflow.test.ts`
- [ ] `tests/e2e/scene-graph-with-actions.test.ts`
- [ ] `tests/e2e/detective-phase.test.ts`
- [ ] `tests/e2e/adventure-story-graph-with-actions.test.ts`

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
      scene-model.ts
      harness-types.ts
    converter/
      bridge.ts
    state/
      state-manager.ts
    executor/
      hcl-context-builder.ts
      prepare-resolver.ts        ← from_state / from_action / from_hook stubs
      action-executor.ts
      scene-executor.ts
    harness/
      harness.ts
    index.ts
  tests/
    e2e/
      llm-workflow.test.ts
      scene-graph-with-actions.test.ts
      detective-phase.test.ts
      adventure-story-graph-with-actions.test.ts
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

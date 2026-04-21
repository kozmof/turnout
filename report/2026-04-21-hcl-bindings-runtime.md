# HCL Bindings in TypeScript Runtime

## Binding Definition

A `BindingModel` (defined in `schema/turnout-model.proto:79-86`) has:
- `name` — unique identifier
- `type` — `"number"`, `"str"`, `"bool"`, `"arr<number>"`, `"arr<str>"`, `"arr<bool>"`
- **either** `value` (literal default) **or** `expr` (computed expression — exactly one is present)

Bindings are stored as `ProgModel.bindings[]` — a list within a computation graph.

---

## Two Kinds of Bindings

### Value Bindings (no `expr`)
- Store literal defaults (e.g., `x = 5`)
- May be overridden by injected values from STATE or hooks during the Prepare phase
- Land directly in the runtime's `valueTable`

### Expression Bindings (has `expr`)
Three sub-types, all evaluated lazily:

| Sub-type | Description |
|----------|-------------|
| **Combine** | Binary operation on two values (e.g., `a + b`) |
| **Pipe** | Sequential chain of combine steps |
| **Cond** | If-then-else conditional branching |

Expression bindings are registered in `funcTable`, not `valueTable`.

See `packages/ts/scene-runner/src/executor/hcl-context-builder.ts:138-174`.

---

## Execution Flow

`packages/ts/scene-runner/src/executor/action-executor.ts:18-96`

```
1. Prepare   → from_state / from_hook → injected binding values
2. Build ctx → merge injected values + literal defaults into ExecutionContext
3. Execute   → evaluate root binding (lazy sub-graphs evaluated on demand)
4. Extract   → pull all binding values out of the context
5. Merge     → write binding values → STATE[dotted.path]
```

### Prepare Sources (`prepare-resolver.ts`)

**Action Prepare:**
- `from_state` — reads `STATE[dotted.path]` (e.g., `applicant.income`)
- `from_hook` — calls hook handler, extracts binding field

**Next Rule Prepare:**
- `from_action` — reads binding value from previous action's result
- `from_state` — reads from post-merge STATE
- `from_literal` — inline literal converted to `AnyValue`

---

## Runtime Context Architecture

`packages/ts/runtime/src/compute-graph/builder/context.ts:253-332` builds in 3 passes:

1. **Collect values** — all value bindings → `valueTable`
2. **Register functions** — two-pass for forward-reference support:
   - Pass 1: register function return IDs
   - Pass 2: validate and build function definitions
   - Populates `funcTable`, `combineFuncDefTable`, `pipeFuncDefTable`, `condFuncDefTable`
3. **Assemble** — final `ExecutionContext` with all tables

### Name → ID Mapping

```typescript
type BuiltContext = {
  exec: ExecutionContext;
  ids: Record<string, FuncId | ValueId>;    // name → function/value ID
  nameToValueId: Record<string, ValueId>;   // name → value ID (for extraction)
};
```

- Value bindings: direct `ValueId` lookup
- Function bindings: returns the function's **return** `ValueId` (not `FuncId`)

---

## STATE Integration

Bindings bridge to STATE (see `spec/state-shape-spec.md`):

- **Prepare** (`from_state`): `STATE[dotted.path]` → overrides binding's literal default
- **Merge** (`to_state`): binding result → `STATE[dotted.path]` (atomic write)
- **Type constraint**: binding type must match STATE field type (checked at convert time)

---

## Key File References

| Component | File | Key Lines |
|-----------|------|-----------|
| Binding model definition | `schema/turnout-model.proto` | 79-86, 123-136 |
| Proto TypeScript generated | `packages/ts/scene-runner/src/types/turnout-model_pb.ts` | 240-265 |
| HCL → Runtime context builder | `packages/ts/scene-runner/src/executor/hcl-context-builder.ts` | 90-201 |
| Action executor (full flow) | `packages/ts/scene-runner/src/executor/action-executor.ts` | 18-96 |
| Prepare resolver | `packages/ts/scene-runner/src/executor/prepare-resolver.ts` | 16-91 |
| Runtime context builder | `packages/ts/runtime/src/compute-graph/builder/context.ts` | 226-332 |
| Builder types | `packages/ts/runtime/src/compute-graph/builder/types.ts` | 113-128 |
| State spec | `spec/state-shape-spec.md` | 6-309 |

# Redesign the Zig runtime around loaded scene units

> Status: in progress — steps 1-3 landed, steps 4-8 open
> Origin: two observations — the Zig code barely uses comptime, and the types it
> needs at runtime were already decided by the Go converter. Revised with three
> constraints: the program is a derived runtime entity and never a wire format,
> the action is the atomic execution unit, and scenes will be merged dynamically.

## Progress

**Step 1 landed.** `preset.zig` (836 lines) split into `preset/kernel.zig` (pure
transformations), `preset/table.zig` (the comptime table), and a 337-line facade.
Dispatch is now an `@Enum`-generated integer and a `StaticStringMap` in place of a
39-entry alias scan plus a 43-comparison `std.mem.eql` chain. `fn_aliases.resolve`
became a comptime perfect hash through the generator. Gate: 133 Zig, 820 TypeScript,
79 end-to-end tests pass.

**Steps 2 and 3 landed.** `runtime/src/program/` holds the IR (`ir.zig`), the
loader (`load.zig`, the only `std.json` on the execution path), and the
evaluator (`eval.zig`). `compute.zig` is now a facade over them with its public
API unchanged. Every action compute and next-rule compute is lowered once when
`RuntimeModel` is created, into a single arena, and cached by scene, action, and
rule index — alongside the validation pass that already visited each one.

Measured on a five-binding numeric program, 300k iterations, ReleaseFast, against
the tree interpreter at `30c2cfa`:

| Path | Before | After |
| --- | ---: | ---: |
| Compute program, lowering each time | 0.46 s | 0.85 s |
| Compute program, lowered once | 0.46 s | **0.12 s** |
| Full action through `RuntimeModel` | 0.38 s | **0.15 s** |

Evaluation is 3.8x faster than the interpreter it replaces, and a full action —
prepare, compute, merge, STATE snapshot — is 2.5x faster. The middle row is the
finding worth keeping: lowering costs about 2.4 us, so lowering per execution is
*slower* than interpreting. The split is only a win once the load is hoisted,
which is why step 3 was pulled forward and merged into this batch rather than
left until step 4.

One deviation from what this plan originally said. It proposed deleting
`inputType`, `parameterType`, `arity`, `passTransform`, and `returnType` and
replacing them with table metadata. That is wrong: they answer by name *prefix*,
deliberately including names the table does not list, and `zig-parity.test.ts`
depends on that for hand-written graphs from the builder API. They stay as they
were, now documented as authoring-time rules rather than runtime typing. The
table carries only what dispatch needs.

## The diagnosis

The Zig runtime is a JSON tree interpreter. `std.json.Value` is not the input
format; it *is* the runtime IR. Every execution re-walks that tree, re-checks
shapes, and re-resolves names by string comparison.

`RuntimeModel` is one field (`model.zig:59`):

```zig
pub const RuntimeModel = struct {
    parsed: std.json.Parsed(std.json.Value),
};
```

Everything above it does string-keyed lookups against that tree. Finding the
action to run is a nested linear scan (`model.zig:287`):

```zig
for (scenes.array.items) |scene| {
    if (scene.object.get("id") ... !std.mem.eql(u8, id.string, scene_id)) continue;
    for (actions.array.items) |action| { ... std.mem.eql(u8, candidate.string, action_id) ... }
}
```

That scan runs again in `sceneEntryAction` (`model.zig:79`), `actionEffectSchedule`,
`selectNextAfterAction`, `findScene` (`scene.zig:333`), and `findRoute`
(`route.zig:320`) — several O(scenes × actions) passes per step.

Inside an action it repeats one level down. `resolvePipeArgument`
(`compute.zig:208`) probes five string keys to discover which variant an
argument is, then does a hash lookup to resolve a reference that was fixed the
moment the model was compiled. Function dispatch is a linear scan of 39 aliases
(`fn_aliases.zig:48`) followed by a 43-comparison `std.mem.eql` chain
(`preset.zig:94-143`) — per pipe step, per execution.

The measured consequence is in `docs/performance-baseline.md`: the Zig/WASM
engine runs at 533–553 runs/s against 956–996 for the TypeScript it replaced.
Zig is 1.8× *slower* on compute-heavy work. That number is the argument. A
systems language losing to an interpreted one on arithmetic means the work being
done is not arithmetic — it is string comparison and JSON tree traversal.

Three further symptoms of the same root cause:

- **Types are thrown away and partly re-derived.** `BindingModel.type` carries a
  resolved `FieldType` for every binding, set at `lower.go:247` and preserved
  through `emit/json.go`. Zig execution never reads it. Instead
  `graph_validate.zig` re-infers types from scratch across 1088 lines, and
  `preset.zig:18-92` recovers them by prefix-matching function names
  (`startsWith(name, "transformFnNumber::")`).
- **STATE schemas are re-parsed per check.** A field's type lives as the string
  `"arr<number>"`; `SchemaParser` (`state.zig:331-391`) re-parses it on every
  write validation.
- **Nothing is pure and everything allocates.** Every preset takes an allocator
  and returns `OwnedTaggedValue`; `add` allocates twice to return a float. Every
  reference resolution deep-clones (`value.build(source.value, source.tags, ...)`)
  because there is no ownership model that would let it borrow. The manual
  `errdefer` choreography in `value.zig:fromJson` and `compute.zig:executePipe` is
  the cost of that.

## Three constraints that shape the design

**The program is a derived runtime entity.** JSON is the serialized form; the
loaded program is what it becomes in memory. There is no second wire contract,
which `runtime-contract.md` deliberately avoided and this redesign does not
reopen. The IR is therefore free to use arena-allocated slices and pointers
wherever they read better — it is never relocated, never written out, never
version-negotiated. Indices are used because they are fast and comparable, not
because anything needs to serialize them.

**The action is the atomic execution unit.** This settles memory ownership: a
scratch arena lives for one action and is reset wholesale at the boundary. It
also names the transaction. `writeBatch` (`state.zig:233`) already builds a *new*
`State` from a snapshot rather than mutating in place, so the commit point is
already atomic in fact; the redesign makes it atomic by construction.

**Scenes will be merged dynamically.** This is the constraint with teeth, and it
rules out the obvious version of the redesign. See below.

## Why "one model, one arena, global indices" is wrong

The natural way to lower a JSON model is one flat program with one string pool
and one index space. Dynamic scene merging kills it: every merge would
invalidate every index and force re-lowering the whole model.

Worse, the current code has a latent version of the same problem. Auditing what
borrows from the parsed JSON tree:

| Borrows from the model tree | Lifetime |
| --- | --- |
| `RouteDriver.arms: std.json.Value` (`runner.zig:682`) | whole run |
| `RouteDriver.route_id`, `.current_scene_id`, `.pending_scene_id` | whole run |
| `RouteDriver.history[].scene_id` / `.action_id` | whole run, read by route matching |
| `ActionTrace.action_id` / `.next_action_id` | `clone` copies these by reference (`scene.zig:60`) |
| `MergeWarning.binding` / `.to_state` | until the trace is serialized |
| `unchecked_write_paths` — aliases `batch.keys()` ← `to_state.string` | same |
| `SceneTrace.scene_id` | same |

Against that, `State` is clean: it dupes paths, schema types, and values
(`state.zig:271`, `state.zig:124-140`), so it is already model-independent and
already merge-safe.

So today the model must be immortal relative to the run, and nothing enforces it.
Merge a model, replace the tree, and every retained trace and history entry
dangles. Fixing this is not optional overhead for the merge feature — it is a
correctness bug waiting for the feature to arrive.

## The shape of the fix

Two lowering steps, not one, with the **scene** as the unit of loading and the
**action** as the unit of execution.

```
scene JSON ──[load]──> SceneUnit  (immutable, own arena, refcounted)
                          │
   many SceneUnits ──[link]──> Registry generation (ids → units, unified schema, routes)
                          │
        Registry + State ──[drivers]──> execution, per-action scratch arena
```

- **`load`** is per scene, pure, and cacheable: `(bytes, arena) -> SceneUnit`. It
  verifies structure, resolves every *internal* reference to an index, and
  enforces the size limits. It is the only place `std.json` appears on the
  execution path.
- **`link`** is cheap and produces an immutable registry generation: scene id
  table, unified STATE schema, resolved route targets.
- **Merging** is `load` the new scenes, then `link` a new generation. Already
  loaded units are untouched and unrelowered. Old generations stay alive while
  anything pins them.

The boundary this replaces already exists in the right place:
`turnout_runtime_create` (`abi.zig:683`) builds one `Instance` that many
`turnout_runtime_step` calls reuse. Today it holds a JSON tree; it should hold a
registry generation.

### Resolution tiers

The rule that makes merging nearly free: **no index ever crosses a scene
boundary.** Resolve to indices where lookup is hot, keep names where it is rare.

| Reference | Frequency | Representation |
| --- | --- | --- |
| binding / param / step / literal ref | per node, per execution | index, resolved at `load` |
| `next` → action within a scene | once per action | scene-local action index, resolved at `load` |
| route target, `next` → scene | once per transition | name, resolved through the registry |

A merge cannot invalidate an index because indices are scene-local and scene
units are immutable. Cross-scene edges were always going to need a lookup, and
one hash probe per scene transition is free.

### The IR

```zig
pub const SceneUnit = struct {
    arena: std.heap.ArenaAllocator,
    refs: std.atomic.Value(u32),
    id: []const u8,                  // owned by this arena
    actions: []const Action,
    by_action_id: StaticStringMapLike, // built at load
    entry: u32,
};

pub const Action = struct {
    id: []const u8,
    program: Program,
    prepare: []const PrepareEntry,
    merge: []const MergeEntry,       // to_state pre-resolved to a schema slot
    publish: []const HookRef,
    next: []const NextRule,          // action targets already indices
};

pub const Program = struct {
    bindings: []const Binding,       // already in execution order
    root: ?u32,
};

pub const Body = union(enum) {
    literal: Value,
    input: void,                     // supplied by prepare
    combine: Combine,
    pipe: Pipe,
    cond: Cond,
};

pub const Ref = union(enum) { binding: u32, param: u32, step: u32, literal: u32 };
```

`Ref` is the load-time answer to the five-key probe in `resolvePipeArgument`. At
eval time an argument is a tag plus an index into a slice — no hashing, no string
comparison, no allocation.

### Lifetimes, restated as a rule

- **Step-scoped structures borrow** from the pinned `SceneUnit`: traces, merge
  warnings, write paths. They are serialized at the ABI boundary
  (`eventResponse`, `abi.zig:794`) before the step returns, so the borrow is
  short and the unit trivially outlives it.
- **Run-scoped structures own their strings.** That is exactly one thing:
  `RouteDriver.history`. It is bounded by `max_transitions × actions`, so
  duplicating two short ids per entry is nothing, and it removes the last
  long-lived borrow.
- **Drivers pin what they execute.** A driver holds a refcount on its
  `SceneUnit` and a handle to the registry generation it started on. An in-flight
  action is unaffected by a merge; it finishes against the generation it began
  with, and new transitions resolve against the newest.

`RouteDriver.arms: std.json.Value` disappears entirely — match arms become
resolved data on the registry generation.

### Atomicity: the action as a transaction

With the scratch arena settled, the core of the runtime becomes one pure
function:

```zig
fn runAction(
    unit: *const SceneUnit,
    index: u32,
    state: *const State,
    prepared: Inputs,
    scratch: Allocator,   // reset wholesale after the call
    out: Allocator,       // only the committed State and the trace land here
) !ActionOutcome
```

All intermediate binding values, pipe step results, and params live in `scratch`.
No individual frees, no `errdefer` ladders. Only the committed `State` and the
trace are copied to `out`.

One precision: an action *suspends* at prepare and publish effect requests, so it
is not a single uninterrupted call. Atomicity is a claim about the commit, not
about the call: state changes land at the merge point, once, or not at all. The
scratch arena therefore lives across suspension — one arena per in-flight action,
which is also what a future concurrent-actions design would need.

### Where comptime actually earns its keep

Comptime is not the answer to everything here — the model arrives at runtime, so
per-model Zig types are off the table (see Non-goals). Three places pay for
themselves.

**1. The preset table.** One declarative table, comptime-expanded into the enum,
the name map, the signature metadata, and the dispatch switch:

```zig
const presets = .{
    .{ "combineFnNumber::add", "add", kernel.add },
    .{ "combineFnNumber::greaterThan", "gt", kernel.gt },
    // ...
};

pub const Fn = ComptimeEnum(presets);                            // one integer
pub const byName = std.StaticStringMap(Fn).initComptime(...);    // perfect hash, load-time only
pub fn call(f: Fn, args: []const TaggedValue, a: Allocator) !OwnedTaggedValue {
    switch (f) { inline else => |tag| return invoke(implOf(tag), args, a) }
}
```

This replaces `preset.call`'s 43-comparison chain with a jump table, and
`fn_aliases.resolve`'s linear scan with a comptime perfect hash consulted once
per scene load. It also deletes `inputType`, `parameterType`, `arity`,
`passTransform`, and `returnType` (`preset.zig:18-92`, ~90 lines of prefix
matching) — that metadata becomes fields on the table entry, and
`spec/fn-aliases.json` stays the generator's source of truth exactly as it is
today.

**2. Deriving the wrapper from the kernel signature.** `invoke` above reads
`@typeInfo(@TypeOf(impl))` to learn arity and argument types, then does the
`TaggedValue` unpacking, the type check, and the tag merge generically. Every
preset kernel drops to its actual content:

```zig
pub fn add(a: f64, b: f64) f64 { return a + b; }
pub fn divide(a: f64, b: f64) !f64 { ... }
pub fn strStarts(s: []const u8, p: []const u8) bool { ... }
```

No allocator, no `TaggedValue`, no `requireArity`, no hand-written type guard.
`numberBinary`/`numberCompare`/`numberUnary`/`booleanBinary`/`stringPredicate`
(`preset.zig:168-278`) exist only to share that boilerplate; they go away with
it. Arity mismatches become compile errors in the table rather than runtime
`error.InvalidArity`.

**3. Type ids instead of type strings.** `FieldType` parses once at load into an
interned `TypeId` over a type-node array owned by the registry generation.
`matchesSchemaType` becomes a walk over pre-parsed nodes; the common scalar cases
become an integer compare. `SchemaParser` leaves the write path entirely. Because
the type pool is registry-level and append-only, merging is append-and-dedupe.

### Purity

The split the redesign is organised around: **load, link, and eval are pure
functions of their input; only the drivers touch the world.**

- `kernel.zig` — pure, total or explicitly fallible, no allocator. Directly
  testable and fuzzable, which the existing JSON-vector fixtures cannot be.
- `load.zig` — `(bytes, arena) -> SceneUnit | LoadError`. Deterministic. Every
  fixture in `runtime/src/fixtures/` becomes a load-then-compare test.
- `link.zig` — `([]SceneUnit) -> Registry | LinkError`. Pure over immutable
  inputs, so a merge is testable without a runtime.
- `eval.zig` — `(Program, inputs, scratch) -> Value`. No I/O, no hooks, no
  hidden state.
- `action.zig`'s merge batch (`action.zig:91-119`) is already a pure
  `computed.bindings -> batch` transform wrapped in JSON walking. Once the walk
  is gone it can be a plain function over typed data.

The drivers (`Runtime`, `ActionDriver`, `SceneDriver`, `RouteDriver` in
`runner.zig`) stay stateful — they are a resumable state machine and should be.
The point is that nothing below them needs to be.

### Validation: defensive about shape, trusting about types — with one exception

Today the runtime is both defensive and trusting, in the wrong proportions. It
re-type-checks programs it received from a compiler that already type-checked
them, while re-verifying JSON shape on every execution rather than once.

Proposed rule: **`load` is the only place that rejects a scene.** It verifies
structure, resolves every internal reference, and enforces the size limits
(`max_program_bindings`, `max_graph_nodes`). Expression and binding type checking
stays in Go, where it can report `file:line:col`; Zig consumes the resolved
`type` field rather than re-deriving it. `eval` then has no shape errors to
raise.

The exception dynamic merging forces: **`link` is a second rejection point, for
things no single Go invocation could have checked.** Scenes merged at runtime
were compiled separately, so nothing has yet verified that they agree. `link`
must check scene id collisions, STATE schema compatibility across units, and
route target resolvability. This is name resolution and schema agreement, not
expression typing — it does not undermine the rule that type checking lives in
Go, but it is real new work in Zig and should be scoped as such rather than
discovered during the merge feature.

`graph_validate.zig` and `graph_compute.zig` are not deleted. Both back the
TypeScript builder API through `abi.zig:176` and `:186` — `graph-validation.ts`
and `compute-graph/runtime/exec/executeGraph.ts` respectively. They move to
`authoring/`, off the execution path, so their 1401 lines stop being confused
with runtime validation and runtime execution. Their own tests calling them
"legacy" is the tell: this is a second, older engine sharing a module tree with
the current one.

## Proposed layout

```
runtime/src/
  value.zig          Value, TaggedValue — no JSON, no schema strings
  preset/
    kernel.zig       pure functions, no allocator
    table.zig        comptime fn enum, signatures, dispatch
  program/
    ir.zig           Program, Binding, Body, Ref
    load.zig         JSON -> Program
    eval.zig         Program -> Value, scratch-arena scoped
  authoring/
    graph_validate.zig   builder-time only, off the execution path
    graph_compute.zig    same
scene-runner/src/
  unit.zig           SceneUnit: actions, id tables, arena, refcount
  load.zig           scene JSON -> SceneUnit
  link.zig           []SceneUnit -> Registry generation
  registry.zig       generations, pinning, merge
  ...                drivers, unchanged in shape, typed in substance
```

## Sequencing

Each step is independently shippable and independently verifiable against the
existing vector fixtures and the TypeScript conformance suite. Nothing here
implements dynamic merging; steps 1–5 make it a feature rather than a rewrite.

1. **Preset table and pure kernels.** Self-contained inside `runtime/src/preset*`.
   Nothing above it changes. Delete the string-metadata functions. Land the
   comptime table and the derived wrapper.
2. **Program IR and loader for compute.** `load.zig` + `eval.zig` behind the
   existing `executeProgram` signature, so `action.zig` is untouched. Existing
   `compute-vectors.json` and `compute-error-vectors.json` gate it.
3. ~~**Hoist the lowering.**~~ Done: programs are lowered once per model, not
   once per execution. The per-action scratch arena is still open — evaluation
   allocates each value individually — and moves with step 4.
4. **SceneUnit, load, and link.** Kills the repeated `findAction` scans and gives
   `RuntimeModel` real fields. `abi.zig` builds one generation in
   `createInstance`. Link starts trivial — one unit per model, no merging.
5. **Close the borrows.** `RouteDriver.arms` becomes resolved data; route history
   owns its ids; drivers take refcounts. This is the correctness fix, and it is
   worth landing even if merging never ships.
6. **Typed STATE schema.** `TypeId` replaces the schema-type strings on the
   registry; retire `SchemaParser` from the write path.
7. **Move `graph_validate` and `graph_compute` to `authoring/`.** No behaviour
   change; it makes the two engines visibly separate.
8. **Re-measure.** Re-run the `docs/performance-baseline.md` workload. The
   success condition for this whole redesign is beating the TypeScript baseline,
   not merely improving on 553 runs/s.

Steps 1–2 are where most of the win is; 4 is where most of the code deletion is;
5 is the prerequisite for the merge feature and a bug fix in its own right.

## Non-goals

- **Serializing the loaded program.** It is a derived runtime entity. JSON stays
  the only wire format.
- **Per-model comptime specialisation.** Generating Zig types from a specific
  `.tu` file, or having the Go converter emit Zig source compiled ahead of time,
  would be genuine comptime specialisation and would be faster still. It also
  gives up loading models at runtime, which is the product — and is flatly
  incompatible with merging scenes dynamically. Recorded so it is not re-proposed
  as an accident of "use more comptime".
- **A Zig protobuf decoder.** `docs/runtime-contract.md` evaluated and rejected
  both candidates. JSON stays the transport; this redesign only stops JSON from
  being the *IR*.
- **Changing the WASM ABI or the canonical Value envelope.** The boundary
  encoding is fine. This is entirely behind `turnout_runtime_create`.
- **Implementing dynamic scene merging.** This plan only ensures the architecture
  admits it.

## Open questions, for the merge feature rather than for this plan

These are semantics, not structure. The architecture above is indifferent to how
they land, which is the point of writing it down now.

- **Collision policy.** Two merged scenes sharing an id: reject, qualify, or
  last-wins? Reject-by-default with an explicit rename seems right.
- **STATE schema union.** Same path and same type is fine; same path and
  different type is an error. Same path, same type, different default — error, or
  first-wins? The Go compiler has never had to answer this because it only ever
  saw one schema.
- **Do routes merge too, or only scenes?** Route arms reference scene ids, so
  merging scenes can make previously dead targets live. Whether new arms can
  arrive with new scenes is a language question, not a runtime one.
- **Merge before run, or mid-run?** The registry-generation design admits both at
  the same cost, so this need not be decided now. Mid-run raises questions the
  runtime cannot answer alone: what happens to route history that references a
  scene no longer in the newest generation, and whether the currently executing
  scene may be replaced under a running driver.

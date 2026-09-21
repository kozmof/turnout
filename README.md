# Turnout

Turnout is a small language for writing branching, stateful flows. A source file
describes scenes, the actions inside them, and how state moves between them. A
compiler checks the whole thing and hands a runtime an executable model.

Flows like this usually end up as hand-wired conditionals. Turnout makes the
shape explicit, so a wrong state path or an unreachable action is a compile
error instead of a production bug.

## Status

Turnout is under active development and has not had a release. Both TypeScript
packages are private at version `0.0.0`, and nothing is published to a registry.

Expect breaking changes. The language syntax, the model format in
`schema/turnout-model.proto`, and the runtime API all still move. Most documents
in `spec/` are marked draft or proposed rather than settled. `todo/` holds the
open design questions and proposals; finished work is not kept there.

Reading the code, running the examples, and filing what looks wrong are all
useful right now. Building anything durable on it is not. Pin a commit before
trying it anyway.

## The language

Source files use the `.tu` extension.

```
state {
  machine {
    stock_count:number  = 0
    coin_balance:number = 0
    dispensed:bool      = false
  }
}

scene "vend" {
  entry_action = check_availability

  action "check_availability" {
    compute "availability_graph" {
      stock_count:number  <~ @machine.stock_count
      coin_balance:number <~ @machine.coin_balance

      in_stock:bool = stock_count > 0
      paid:bool     = coin_balance >= 100

      can_vend:bool := (in_stock & paid) ~> @machine.dispensed
    }

    next can_vend -> dispense
    next refuse
  }

  # ... dispense and refuse follow
}
```

Read `<~` as "comes from state" and `~>` as "goes to state". The `:=` binding is
the action's result. More examples live in `spec/examples/`.

## How it fits together

Turnout compiles ahead of time and executes behind a host.

```
.tu source  ──[Go compiler]──>  HCL or JSON model  ──[host]──>  Zig engine  ──>  state changes
```

The compiler parses the source, resolves the state schema, lowers everything to
a protobuf model, and type-checks it. Nothing reaches the runtime until it
passes.

Execution is a Zig engine: values, preset functions, computation graphs, STATE,
and the action, scene, and route drivers all live there. A host drives it and
supplies the two things it cannot have — the hooks, which are code in the host's
own language, and that language's public API.
`packages/ts/scene-runner` reaches the engine through WASM;
`packages/zig/host` is a native CLI that calls it directly, for running a
compiled model with no JavaScript in reach. Both are held to the same
conformance vectors. `spec/runtime-hosts.md` records where the boundary falls.

Splitting it this way means authoring errors surface once, at build time, and
the runtime only ever sees a model that already type-checks.

## Packages

| Path | What it is |
| --- | --- |
| `packages/go/converter` | The compiler and the `turnout` CLI |
| `packages/ts/runtime` | `turnout-runtime` — computation graph engine, value types, and builder API |
| `packages/ts/scene-runner` | `turnout-scene-runner` — runs compiled models through Zig/WASM and provides a Node bridge to the CLI |
| `packages/zig` | The execution engine, its WASM ABI, and the native `turnout-run` host |
| `apps/vscode/tu-language` | Syntax highlighting for `.tu` files |

`schema/turnout-model.proto` defines the model both sides exchange. Running
`pnpm generate` regenerates the Go and TypeScript types from it, so neither
language hand-writes the wire format.

## Compiling a flow

Build the CLI, then convert a source file.

```sh
cd packages/go/converter
go build -o turnout ./cmd/turnout
./turnout convert flow.tu -o flow.json -format json
```

Three commands are available.

- `turnout convert <input.tu> [-o output] [-state-file path] [-allow-unconfined-state-file] [-format hcl|json]` — compile to HCL or JSON
- `turnout validate <input.tu> [-state-file path] [-allow-unconfined-state-file]` — type-check without writing output
- `turnout version` — print the build version

A source names the file its STATE comes from, so a compiler that resolves that
name anywhere is an arbitrary read primitive for whoever wrote the source. It
does not: a `state_file` must resolve inside the base directory, and a symlink
out of it is rejected too. `-state-file` sets that base directory, which
otherwise is the input's own.

Pass `-allow-unconfined-state-file` when a schema genuinely lives outside the
tree and the sources being compiled are as trusted as the machine compiling
them. The Go API spells the same opt-out `Options.AllowUnconfinedStateFile`.

Use `-format hcl` for canonical HCL that reads and diffs cleanly. Use
`-format json` for the model the TypeScript runtime consumes. Both come from
the same validated model.

Errors report a file, line, and column.

```
flow.tu:20:7: error [StateTypeMismatch]: action "check_availability": merge binding "can_vend" has type bool but STATE field "machine.coin_balance" has type number
```

## Running a compiled model

Load a JSON model and run it.

```ts
import { createRunner } from "turnout-scene-runner";

const runner = createRunner(model, { entryId: "vend", initialState: {} });
const result = await runner.run();

console.log(result.finalState);
```

Step through it instead to inspect each action as it runs.

```ts
for await (const step of runner.runAsync()) {
  if (!step.done && step.kind === "action") console.log(step.actionId);
}
```

`runner.next(steps)` advances by a fixed number of actions, one by default, and
returns the steps it took. Use it when something outside the flow drives it.

Running the same model repeatedly, prepare it once. `createRunner` otherwise
snapshots, re-validates, re-encodes, and re-loads the model on every call, which
is most of what creating a runner costs — about 850 µs of a 930 µs run on a
20-action scene, against 13 µs from a prepared model.

```ts
import { createRunner, prepareModel } from "turnout-scene-runner";

const prepared = prepareModel(model);
for (const request of requests) {
  const result = await createRunner(prepared, { entryId: "vend", initialState: {} }).run();
}
prepared.release();
```

Each runner still gets its own STATE; only the model is shared. `release()` frees
the runtime's copy, and runners created before it keep working until they
finish.

Scenes compiled separately can be combined into one model.

```ts
import { mergeModels, prepareModel } from "turnout-scene-runner";

const merged = mergeModels([baseFlow, checkoutScenes], { labels: ["base", "checkout"] });
const prepared = prepareModel(merged);
```

Every collision is an error, never an override: two models that both define a
scene have no defensible winner, and picking one silently would turn a packaging
mistake into a behavioural one. A STATE field or named type declared by more than
one input must be declared identically. All conflicts are reported together, each
naming the inputs it came from.

```
ModelMergeError: cannot merge models:
  scene "review" is declared by base and checkout
  STATE field "app.total" is declared as str by checkout and as number by base
```

A model can also grow while it runs. An action declares the hooks it extends
from, and each returned model is merged in before the action prepares.

```
action "load_plugins" {
  extend {
    model = "fetch_checkout_scenes"
  }

  compute "pick_lane" {
    lane:str <~ @cart.lane
    (lane) ~> @cart.lane
  }

  next on lane to {
    "checkout" -> review,     # a scene that arrived from the hook
    _          -> browse
  }
}
```

```ts
runner.useExtendHook("fetch_checkout_scenes", async () => checkoutScenes);
```

Each value in `extend` names a hook; a model is what the hook returns, which is
what the attribute says. Hooks fire in declaration order and merge left to
right, under the same rules as `mergeModels` — a collision fails the action
rather than overriding anything, with the running model named `model` and every
other input named by its hook. Because a model can grow, a route arm may name a
scene that has not arrived yet.

Hooks let an action pull values from outside the model or publish state
somewhere else. Register them before running.

```ts
runner.usePrepareHook("fetch_price", async () => ({ price: 250 }));
runner.usePublishHook("emit_receipt", async (ctx) => { await send(ctx.state()); });
```

A prepare hook returns the bindings it resolved. A publish hook reads the final
state and returns either nothing or an outcome recording whether it succeeded.
An extend hook returns a model, and is registered with `useExtendHook`.

For a single call that wires hooks and runs to completion, use `runHarness`.
For the Node-only bridge that shells out to the `turnout` binary, import from
`turnout-scene-runner/server`.

## State

State is declared once, in namespaces, with a type and a default for every
field.

```
state {
  machine {
    stock_count:number = 0
    message:str        = ""
  }
}
```

Three scalars, `arr<T>` for a list of any type, and `rec<K, V>` for a record
keyed by `str` or by `number`. The two constructors compose, so the fourteen
below are the vocabulary both languages pre-declare rather than the whole of
what you may write — `arr<arr<number>>` is a type, and so is
`rec<str, arr<rec<str, bool>>>`.

| Type | Holds |
| --- | --- |
| `number` | A number |
| `str` | A string |
| `bool` | A boolean |
| `arr<number>`, `arr<str>`, `arr<bool>` | A list of that scalar |
| `rec<str, number>`, `rec<str, str>`, `rec<str, bool>` | A string-keyed record of that scalar |
| `rec<number, number>`, `rec<number, str>`, `rec<number, bool>` | A number-keyed record of that scalar |
| `arr<rec<str, number>>` | A list of string-keyed number records |
| `rec<str, arr<number>>` | A string-keyed record of number lists |

`spec/examples/06-record-state.tu` works through the record types.

Both languages assert this vocabulary against `spec/field-types.json`, so a
rename in one cannot drift from the other. Function names are pinned the same
way through `spec/fn-aliases.json`.

Composition is bounded. A type is built from one node per `arr<`, one per
`rec<`, and one for the scalar at the bottom, and the runtime holds
`spec/limits.json`'s `stateTypeNodes` of them — so nesting is finite, and the
compiler refuses a deeper type against the file it parsed rather than leaving
it to fail at load.

Reading an undeclared path is an error, and writing the wrong type is an error.
Larger schemas can move to their own file with `state_file = "schema.tu"`.

## Development

Turnout needs Go, Node 22 or newer, and pnpm.

```sh
pnpm install
pnpm check
```

`pnpm check` is the full gate. It regenerates the protobuf bindings and Zig function-alias map and fails if either drifted, then checks formatting, type-checks,
lints, runs `go vet` and the race detector, and runs both test suites with
coverage floors.

Narrower commands are available while working.

```sh
pnpm test:go      # Go tests
pnpm test:ts      # TypeScript tests
pnpm test:e2e     # End-to-end scene-runner tests
pnpm format       # gofmt and oxfmt
pnpm generate     # Regenerate types from the proto schema
```

CI runs the same gate on Node 22 and 24, plus staticcheck and bounded fuzzing of
the lexer and parser.

## Specifications

`spec/` holds the normative documents. Start with `spec/convert-runtime-spec.md`
for the pipeline, then `spec/runtime-hosts.md` for the split between the engine
and the host that drives it, then `spec/scene-graph.md` for the scene and action
model. The rest cover the type system, hooks, routes, and state shape.

Several files in `spec/` are data rather than prose, each read by more than one
language and gated against drift: `fn-aliases.json`, `field-types.json`,
`runtime-projection.json`, `runtime-versions.json`, `limits.json`,
`structural-rules.json`, `runtime-events.json`, and `error-codes.json`. The
first three pin shared names, the fourth pins
shared versions, and the fifth pins shared bounds — a limit the compiler and
the engine each chose alone is how a model the compiler accepted became one the
engine refused to load. `structural-rules.json` pins the structural checks the engine and the
TypeScript host both run, records the two the host adds on purpose, and maps
each onto the compiler diagnostic that catches it at build time instead — so a
rule appearing in one of the three alone has to be classified before it passes.
`runtime-events.json` does the same for the event stream coming back out of the
engine, which the model schema does not cover: the engine hand-encodes each
event and the host hand-declares a union mirroring it, so an event or warning
kind added on one side alone would otherwise be dropped in silence. It also
pins the fields of the `needEffect` envelope across all three sides that spell
it out by hand, the native host included — a field added to the request reached
two of them and was dropped by the third in silence.

`error-codes.json` covers the last vocabulary with nothing behind it. The
boundary carries `@errorName(err)`, so a host code naming an engine error is
coupled to the spelling of a Zig error: rename the error and the host goes on
matching a string that no longer arrives, with no compile error and no failing
test. Every code in the gated host unions is now classified as shared with the
engine, deliberately renamed, raised by the host alone, or vestigial — and a
code in none of the four fails the gate.

Two of them are stronger than pinned: `fn-aliases.json` and `limits.json` are
*generated* into each language rather than compared against it, so the sides
cannot be edited into disagreement at all. `pnpm generate:fn-map` and
`pnpm generate:limits` rewrite them, and `pnpm check` fails if either moved.
`capabilities.json` lists what a host must be able to do, and
`conformance/host/` holds the vectors that prove it can.

## License

MIT. See `LICENCE`.

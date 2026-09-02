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
in `spec/` are marked draft or proposed rather than settled. `todo/` mixes
finished work with open design questions and a known bug.

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

Turnout runs in two phases.

```
.tu source  ──[Go compiler]──>  HCL or JSON model  ──[TypeScript runtime]──>  state changes
```

The compiler parses the source, resolves the state schema, lowers everything to
a protobuf model, and type-checks it. Nothing reaches the runtime until it
passes. The runtime loads the model and executes each action's computation
graph, merging results into state at the points the source declared.

Splitting it this way means authoring errors surface once, at build time, and
the runtime only ever sees a model that already type-checks.

## Packages

| Path | What it is |
| --- | --- |
| `packages/go/converter` | The compiler and the `turnout` CLI |
| `packages/ts/runtime` | Computation graph engine, value types, and builder API |
| `packages/ts/scene-runner` | Runs compiled models through Zig/WASM and provides a Node bridge to the CLI |
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

- `turnout convert <input.tu> [-o output] [-state-file path] [-format hcl|json]` — compile to HCL or JSON
- `turnout validate <input.tu> [-state-file path]` — type-check without writing output
- `turnout version` — print the build version

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

Hooks let an action pull values from outside the model or publish state
somewhere else. Register them before running.

```ts
runner.usePrepareHook("fetch_price", async () => ({ price: 250 }));
runner.usePublishHook("emit_receipt", async (ctx) => { await send(ctx.state()); });
```

A prepare hook returns the bindings it resolved. A publish hook reads the final
state and returns either nothing or an outcome recording whether it succeeded.

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

Six types are available.

| Type | Holds |
| --- | --- |
| `number` | A number |
| `str` | A string |
| `bool` | A boolean |
| `arr<number>` | A list of numbers |
| `arr<str>` | A list of strings |
| `arr<bool>` | A list of booleans |

Both languages assert this vocabulary against `spec/field-types.json`, so a
rename in one cannot drift from the other. Function names are pinned the same
way through `spec/fn-aliases.json`.

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
for the pipeline, then `spec/scene-graph.md` for the scene and action model.
The rest cover the type system, hooks, routes, and state shape.

## License

MIT. See `LICENCE`.

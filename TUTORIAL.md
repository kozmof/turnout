# Turnout syntax tutorial

Turnout is a declarative language for typed, stateful workflows. Programs describe persistent state, scenes made of actions, computation graphs, transitions, hooks, and routes.

This guide covers the current beta syntax. Use `|>` for pipelines and `rec<K, V>` for records. Older forms such as `pipe(...)` and `Record<...>` are no longer supported.

## 1. A first program

```hcl
state {
  app {
    count:number = 0
    message:str = ""
  }
}

scene "counter" {
  entry_action = increment

  action "increment" {
    compute "increment_graph" {
      count:number <~ @app.count
      next_count:number = count + 1
      message:str = "count=${next_count}"

      (next_count) ~> @app.count
      result:str := (message) ~> @app.message
    }
  }
}
```

Read this from the outside in:

1. `state` declares durable values grouped under `app`.
2. `scene "counter"` begins at its `increment` action.
3. The compute graph reads state, derives local values, and writes state.
4. `:=` marks the graph's single result and must appear last.

Bindings describe a dependency graph, not a sequence of mutable assignments. Comments begin with `#` and continue to the end of the line.

## 2. State and types

The primitive types are `number`, `str`, and `bool`. State fields require a type and default value:

```hcl
state {
  profile {
    name:str = "guest"
    visits:number = 0
    active:bool = true
  }
}
```

Containers are homogeneous and recursive:

```hcl
state {
  data {
    scores:arr<number> = []
    tags:arr<str> = []
    counters:rec<str, number> = {}
    names:rec<number, str> = {}
    rows:arr<rec<str, number>> = []
    buckets:rec<str, arr<number>> = {}
    matrix:rec<str, arr<rec<str, bool>>> = {}
  }
}
```

An `arr<T>` contains values of type `T`. A `rec<K, V>` uses `str` or `number` keys and values of type `V`. Arrays and records can contain one another at any depth.

State may instead live in another file:

```hcl
state_file = "./state.tu"
```

Use either an inline `state` block or `state_file`, not both.

## 3. Scenes, actions, and compute graphs

A scene names its starting action with `entry_action`:

```hcl
scene "checkout" {
  entry_action = validate

  action "validate" {
    """
    Optional action documentation uses a triple-quoted string.
    """

    compute "validation_graph" {
      total:number <~ @cart.total
      valid:bool := total >= 0
    }

    next valid -> charge
  }

  action "charge" {
    compute "charge_graph" {
      total:number <~ @cart.total
      (total) ~> @orders.last_total
    }
  }
}
```

Action and compute labels are strings. References such as `entry_action = validate` and `next ... -> charge` use identifiers.

## 4. Bindings and state I/O

The operators around a binding describe its source and destination:

| Form | Meaning |
|---|---|
| `x:number = 1` | Local value |
| `x:number <~ @group.field` | Read state |
| `x:str <~ hook("prepare")` | Read a hook source |
| `x:number = (expr) ~> @group.field` | Named value and state write |
| `x:number := expr` | Graph result |
| `x:number := (expr) ~> @group.field` | Graph result and state write |
| `(expr) ~> @group.field` | Anonymous state write |
| `x:number <~ @source.field ~> @target.field` | Read and forward |

State paths begin with `@`, and their types must match the binding. Parenthesize a computed expression before writing it:

```hcl
(subtotal + tax) ~> @orders.total
```

A compute graph can expose one root result with `:=`. If present, it must be the final binding. A graph can instead end with an anonymous state write if no result is needed.

## 5. Expressions

Turnout supports:

- arithmetic: `+`, `-`, `*`, `/`, `%`.
- comparison: `>`, `>=`, `<`, `<=`.
- equality: `==`, `!=`.
- boolean operations: `&`, `|`.

```hcl
subtotal:number = price * quantity
discounted:number = subtotal - discount
eligible:bool = active & (subtotal >= 100)
label:str = "order-" + order_id
different:bool = left != right
```

### Conditionals and matching

`if` is an expression:

```hcl
fee:number = if(priority, 25, 5)
```

Use `case` for pattern matching:

```hcl
level:number = case(
  (queue, escalated),
  ("technical", true) -> 1,
  ("billing", _) -> 2,
  _ -> 3
)
```

`_` is a wildcard. Patterns can contain literals, tuples, identifiers, and template destructuring patterns.

## 6. String interpolation

Double-quoted strings interpolate local primitive bindings with JavaScript-style placeholders:

```hcl
name:str = "Ada"
attempt:number = 3
ready:bool = true
message:str = "user=${name}; attempt=${attempt}; ready=${ready}"
```

`str`, `number`, and `bool` values are stringified automatically. A placeholder contains a binding identifier, not an arbitrary expression. Bind a complex expression first:

```hcl
next_attempt:number = attempt + 1
message:str = "attempt=${next_attempt}"
```

Escape a placeholder to retain it literally:

```hcl
example:str = "write \${name} to interpolate later"
```

## 7. Pipelines

The pipeline operator passes a value through expressions. Inside each step, `#it` is the previous result:

```hcl
clamped:number = first_reading
  |> max(#it, 0)
  |> min(#it, 1000)
```

`#it` is valid only inside a pipeline step.

## 8. Built-in functions

| Area | Functions |
|---|---|
| Numbers | `add`, `sub`, `mul`, `div`, `mod`, `min`, `max`, `gt`, `gte`, `lt`, `lte` |
| Booleans | `bool_and`, `bool_or`, `bool_xor` |
| Strings | `str_concat`, `str_includes`, `str_starts`, `str_ends` |
| Equality | `eq`, `neq` |
| Arrays | `arr_concat`, `arr_get`, `arr_includes`, typed `arr_get_*` |
| Records | `record_get`, `record_set`, typed `record_get_*` |

Typed getters end in `_number`, `_str`, `_bool`, `_array`, or `_record`. For example, use `arr_get_record` when an array contains records and `record_get_array` when a record contains arrays.

## 9. Arrays and records

Containers are immutable. Operations produce new values rather than changing their inputs:

```hcl
readings:arr<number> <~ @sensor.readings
first:number = arr_get(readings, 0)
has_zero:bool = arr_includes(readings, 0)
extended:arr<number> = arr_concat(readings, [100])
```

`record_set` returns an updated record:

```hcl
counters:rec<str, number> <~ @analytics.counters
updated:rec<str, number> = record_set(counters, "visits", 1)
visits:number = record_get(updated, "visits")
(updated) ~> @analytics.counters
```

Nested containers use typed getters:

```hcl
rows:arr<rec<str, number>> <~ @analytics.rows
row:rec<str, number> = arr_get_record(rows, 0)
score:number = record_get(row, "score")

buckets:rec<str, arr<number>> <~ @analytics.buckets
scores:arr<number> = record_get_array(buckets, "scores")
first_score:number = arr_get(scores, 0)
```

## 10. Action transitions

An action can be terminal or use deterministic, guarded, matched, or computed transitions.

```hcl
next finish
```

```hcl
next approved -> finish
next rejected -> revise
```

A guard refers to a boolean binding from the action's compute graph. Match-based transitions choose from several targets:

```hcl
next on (queue, escalated) to {
  ("technical", true) -> specialist,
  ("billing", _) -> generalist,
  _ -> generalist
}
```

A transition may compute its own boolean guard:

```hcl
next {
  compute "retry_guard" {
    attempts:number <~ action(attempts)
    allowed:bool := attempts < 3
  }
  action = retry
}
```

Transition compute graphs may read action bindings with `action(name)`, literals, and state. They must return a boolean and cannot write state.

## 11. Scene overviews

An overview documents and validates action flow:

```hcl
overview at_least {
  validate |-> charge
  validate |-> reject
  charge |-> finish
}
```

| Mode | Contract |
|---|---|
| `nodes_only` | Declared nodes must exist; edges are ignored |
| `at_least` | Declared nodes and edges must exist; extras are allowed |
| `strict` | Declared and implemented nodes and edges must match exactly |

An edge target is not automatically a node declaration. Declare it as a source line when strict node coverage requires it.

## 12. Hooks and publishing

Hooks connect graphs to host-provided data and effects:

```hcl
request_id:str <~ hook("request_id")
```

An action can publish bindings through a named hook:

```hcl
publish "audit" {
  request_id = request_id
  status = status
}
```

Hook names and payload contracts are supplied by the host application.

## 13. Routes between scenes

Routes compose scene files into a larger workflow:

```hcl
route "fulfillment" {
  entry = picking

  scene "picking" {
    file = "./picking.tu"
  }

  scene "shipping" {
    file = "./shipping.tu"
  }

  to {
    picking = shipping
  }
}
```

`entry` selects the first scene, each scene points to a Turnout file, and `to` declares scene-to-scene edges.

## 14. Literal and template types

Literal aliases constrain domain values:

```hcl
type Queue = "billing" | "technical" | "account"
type Escalated = true | false
```

Template types describe structured strings. `integer` represents whole numbers in this type system:

```hcl
type TicketRef = "TKT-{queue: Queue}-{serial: integer}"
```

Construct a template value by providing its captures:

```hcl
queue:Queue = "technical"
serial:integer = 42
reference:TicketRef = TicketRef {
  queue = queue
  serial = serial
}
```

Template values can be destructured in `case` patterns:

```hcl
assignee:str = case(
  reference,
  TicketRef { queue: "billing", serial } -> "billing_desk",
  TicketRef { queue: "technical", serial } -> "sre_oncall",
  _ -> "general_queue"
)
```

## 15. Common mistakes

- Use `value |> fn(#it)`, not removed `pipe(value, ...)` syntax.
- Spell container types `arr<T>` and `rec<K, V>`.
- Bind or write the new record returned by `record_set`.
- Use typed getters for nested arrays and records.
- Put the single `:=` result last in a compute graph.
- Parenthesize computed expressions before `~>`.
- Keep `${...}` placeholders to local binding identifiers.
- Ensure state paths, entry actions, transition targets, and route targets exist.

## 16. Further reading

Compiler-tested programs live in [`spec/examples`](spec/examples). For precise validation rules, see:

- [`effect-dsl-spec.md`](spec/effect-dsl-spec.md) for compute bindings and I/O.
- [`hcl-context-spec.md`](spec/hcl-context-spec.md) for expressions and built-ins.
- [`state-shape-spec.md`](spec/state-shape-spec.md) for state declarations.
- [`scene-to-scene.md`](spec/scene-to-scene.md) for routes.
- [`overview-dsl-spec.md`](spec/overview-dsl-spec.md) for overview enforcement.
- [`literal-template-types-spec.md`](spec/literal-template-types-spec.md) for domain types.

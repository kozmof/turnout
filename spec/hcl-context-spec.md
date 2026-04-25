# HCL ContextSpec — Refined Specification

> **Status**: Phase 1 ready for implementation; Phase 2 (loops) requires runtime extension.
> **Target API**: `ctx(spec: ContextSpec): BuildResult<T>` in `src/compute-graph/builder/context.ts`

---

## Overview

A typed-key DSL that declares a `ContextSpec` object and passes it to `ctx()`.
The compiler reads DSL input, lowers it to canonical plain HCL syntax, validates it, and emits a TypeScript `ContextSpec`.

## DSL Layer and Lowering to Plain HCL

This spec defines two layers:

1. **Surface DSL** (authoring syntax): includes typed keys (`name:type`), function-call expressions (`add(v1, v2)`), infix expressions (`name:bool = lhs >= rhs`, `name:str = lhs + rhs`), and bare references (`v1`).
2. **Canonical plain HCL** (lowered syntax): uses only standard HCL identifiers/blocks/attributes so a stock HCL parser can parse it.

### Canonical plain HCL shape

```hcl
prog "main" {
  binding "v1" {
    type  = "number"
    value = 5
  }

  binding "sum" {
    type = "number"
    expr = {
      combine = {
        fn   = "add"
        args = [{ ref = "v1" }, { ref = "v2" }]
      }
    }
  }
}
```

### Lowering rules (DSL -> plain HCL)

| Surface DSL | Canonical plain HCL |
|-------------|---------------------|
| `name:type = literal` | `binding "name" { type = "type" value = literal }` |
| `name:type = identifier` (single bare identifier; see §2.1 for disambiguation) | `binding "name" { type = "type" expr = { combine = { fn = "<identity-fn>" args = [arg(identifier), arg(identity-rhs)] } } }` where identity-fn and identity-rhs are type-dependent (see identity-combine table below) |
| `name:type = fn_alias(x, y)` | `binding "name" { type = "type" expr = { combine = { fn = "fn_alias" args = [arg(x), arg(y)] } } }` |
| `name:type = fn_alias(a: x, b: y)` | `binding "name" { type = "type" expr = { combine = { fn = "fn_alias" args = [arg(x), arg(y)] } } }` |
| `name:bool = lhs & rhs` | `binding "name" { type = "bool" expr = { combine = { fn = "bool_and" args = [arg(lhs), arg(rhs)] } } }` |
| `name:bool = lhs >= rhs` | `binding "name" { type = "bool" expr = { combine = { fn = "gte" args = [arg(lhs), arg(rhs)] } } }` |
| `name:bool = lhs <= rhs` | `binding "name" { type = "bool" expr = { combine = { fn = "lte" args = [arg(lhs), arg(rhs)] } } }` |
| `name:str = lhs + rhs` | `binding "name" { type = "str" expr = { combine = { fn = "str_concat" args = [arg(lhs), arg(rhs)] } } }` |
| `name:number = lhs - rhs` | `binding "name" { type = "number" expr = { combine = { fn = "sub" args = [arg(lhs), arg(rhs)] } } }` |
| `name:number = lhs * rhs` | `binding "name" { type = "number" expr = { combine = { fn = "mul" args = [arg(lhs), arg(rhs)] } } }` |
| `name:number = lhs / rhs` | `binding "name" { type = "number" expr = { combine = { fn = "div" args = [arg(lhs), arg(rhs)] } } }` |
| `name:number = lhs + rhs` | `binding "name" { type = "number" expr = { combine = { fn = "add" args = [arg(lhs), arg(rhs)] } } }` |
| `name:number = lhs % rhs` | `binding "name" { type = "number" expr = { combine = { fn = "mod" args = [arg(lhs), arg(rhs)] } } }` |
| `name:bool = lhs > rhs` | `binding "name" { type = "bool" expr = { combine = { fn = "gt" args = [arg(lhs), arg(rhs)] } } }` |
| `name:bool = lhs < rhs` | `binding "name" { type = "bool" expr = { combine = { fn = "lt" args = [arg(lhs), arg(rhs)] } } }` |
| `name:bool = lhs \| rhs` | `binding "name" { type = "bool" expr = { combine = { fn = "bool_or" args = [arg(lhs), arg(rhs)] } } }` |
| `name:bool = lhs == rhs` | `binding "name" { type = "bool" expr = { combine = { fn = "eq" args = [arg(lhs), arg(rhs)] } } }` |
| `name:bool = lhs != rhs` | `binding "name" { type = "bool" expr = { combine = { fn = "neq" args = [arg(lhs), arg(rhs)] } } }` |
| `name:type = #if(cond, then_expr, else_expr)` | `binding "name" { type = "type" expr = { if = { cond = expr(cond) then = expr(then_expr) else = expr(else_expr) } } }` |
| `name:type = #case(subject, pattern => expr, _ => default)` | `binding "name" { type = "type" expr = { case = { subject = expr(subject) arms = [...] } } }` |
| `name:type = #pipe(initial_value, step1, step2, ...)` | `binding "name" { type = "type" expr = { pipe = { initial = expr(initial_value) steps = [expr(step1), expr(step2), ...] } } }` |

#### Identity-combine table (for single-reference form)

The single-reference form `name:type = identifier` lowers to a combine using a type-appropriate identity operation. The result is always a function binding, not a value binding.

| Declared type | Identity combine | Lowered canonical HCL (abbreviated) |
|---|---|---|
| `bool`        | `bool_and(identifier, true)` | `combine = { fn = "bool_and" args = [{ ref = "identifier" }, { lit = true }] }` |
| `number`      | `add(identifier, 0)`         | `combine = { fn = "add" args = [{ ref = "identifier" }, { lit = 0 }] }` |
| `str`         | `str_concat(identifier, "")` | `combine = { fn = "str_concat" args = [{ ref = "identifier" }, { lit = "" }] }` |
| `arr<T>`      | `arr_concat(identifier, [])` | `combine = { fn = "arr_concat" args = [{ ref = "identifier" }, { lit = [] }] }` |

The identity RHS literal (`true`, `0`, `""`, `[]`) is chosen so the combine always returns the value of `identifier` unchanged.

#### Disambiguation: single-reference form vs literal vs infix

After `name:type =`, the parser selects the form by examining the first and second tokens of the RHS:

| First token | Second token | Form |
|---|---|---|
| keyword literal (`true`, `false`) | any | value binding (literal) |
| numeric literal, string literal, `[` | any | value binding (literal) |
| bare `IDENT` (not `true`/`false`) | `(` | function call |
| bare `IDENT` (not `true`/`false`) | `&`, `>=`, `<=`, `+`, `-`, `*`, `/`, `%`, `>`, `<`, `|`, `==`, `!=` | infix expression |
| bare `IDENT` (not `true`/`false`) | end-of-line, `}`, or next `IDENT:` | **single-reference form** |
| `{` | any | block form (reserved constructs only; not used for v0 function expressions) |
| `#pipe` | any | pipe form |
| `#if` | any | if form |
| `#case` | any | case form |
| `#it` | any | valid only inside a `#pipe` step |
| no RHS after directional sigil `~>` / `<~>` | any | STATE-populated input declaration |

`_` is not a bare identifier and must not match the single-reference form. It is valid only as a `#case` wildcard pattern.

### End-to-end lowering example

Surface DSL:

```hcl
prog "main" {
  v1:number = 5
  v2:number = 3
  sum:number = v1 + v2
}
```

Lowered plain HCL:

```hcl
prog "main" {
  binding "v1" {
    type  = "number"
    value = 5
  }

  binding "v2" {
    type  = "number"
    value = 3
  }

  binding "sum" {
    type = "number"
    expr = {
      combine = {
        fn   = "add"
        args = [{ ref = "v1" }, { ref = "v2" }]
      }
    }
  }
}
```

`arg(x)` normalization:

- Positional call args `(x, y)` -> ordered pair `[arg(x), arg(y)]`
- Named call args `(a: x, b: y)` -> ordered pair `[arg(x), arg(y)]`
- Infix `lhs & rhs`  -> ordered pair `[arg(lhs), arg(rhs)]` with `fn = "bool_and"`
- Infix `lhs >= rhs` -> ordered pair `[arg(lhs), arg(rhs)]` with `fn = "gte"`
- Infix `lhs <= rhs` -> ordered pair `[arg(lhs), arg(rhs)]` with `fn = "lte"`
- Infix `lhs > rhs`  -> ordered pair `[arg(lhs), arg(rhs)]` with `fn = "gt"`
- Infix `lhs < rhs`  -> ordered pair `[arg(lhs), arg(rhs)]` with `fn = "lt"`
- Infix `lhs | rhs`  -> ordered pair `[arg(lhs), arg(rhs)]` with `fn = "bool_or"`
- Infix `lhs == rhs` -> ordered pair `[arg(lhs), arg(rhs)]` with `fn = "eq"`
- Infix `lhs != rhs` -> ordered pair `[arg(lhs), arg(rhs)]` with `fn = "neq"`
- Infix `lhs + rhs`  -> ordered pair `[arg(lhs), arg(rhs)]` with `fn = "add"` (for `name:number`) or `fn = "str_concat"` (for `name:str`) — type-dispatched
- Infix `lhs - rhs`  -> ordered pair `[arg(lhs), arg(rhs)]` with `fn = "sub"`
- Infix `lhs * rhs`  -> ordered pair `[arg(lhs), arg(rhs)]` with `fn = "mul"`
- Infix `lhs / rhs`  -> ordered pair `[arg(lhs), arg(rhs)]` with `fn = "div"`
- Infix `lhs % rhs`  -> ordered pair `[arg(lhs), arg(rhs)]` with `fn = "mod"`
- Single-reference form `name:type = identifier` -> identity combine args per the identity-combine table above
- DSL bare identifier `v` -> `{ ref = "v" }`
- DSL literal (`"s"`, `1`, `true`, `[1,2]`) -> `{ lit = <literal> }`
- `#it` inside a `#pipe` step -> reference to the current pipeline value for that step

### Balance rules (CAN / CAN'T)

CAN (OK):
- Authors can use typed keys in DSL (`v1:number = 5`).
- Authors can use bare identifiers as references in DSL (`add(v1, v2)`).
- Authors can write explicit named args (`add(a: v1, b: v2)`).
- Authors can write operator-only functions using their assigned DSL operator (`income_ok:bool = income >= min_income`, `big:bool = income > 0`, `small:bool = debt < limit`, `match:bool = a == b`, `diff:bool = a != b`, `either:bool = flag_a | flag_b`, `sum:number = a + b`, `approval_code:str = prefix + suffix`, `go:bool = flag_hi & flag_lo`, `remainder:number = total - discount`, `area:number = width * height`, `rate:number = amount / count`, `rem:number = total % count`).
- Authors can write call-only functions using call syntax (`max(v1, v2)`, `min(v1, v2)`, `str_includes(a, b)`).
- Authors can write pipes as `#pipe(initial_value, step1, step2, ...)`.
- Authors can use `#it` inside a `#pipe` step to refer to the current pipeline value.
- Authors can write binary choices as `#if(cond, then_expr, else_expr)`.
- Authors can write ordered classifications as `#case(subject, pattern => expr, _ => default_expr)`.
- Authors can write a single-reference binding `name:type = identifier` to pass another binding's value through as a function binding. The compiler lowers this to an identity combine per the identity-combine table.

CAN'T (NG):
- Lowered plain HCL cannot keep `name:type` as an attribute key.
- Lowered plain HCL cannot keep bare references in argument positions.
- Lowered plain HCL cannot encode branch references as untyped strings.
- Object-form function calls such as `{ add = [v1, v2] }`, block-style conditionals, and bracket-style pipe forms are not part of v0.
- A single binary call cannot mix positional and named argument forms.
- Operator-only functions (`bool_and`, `gte`, `lte`, `gt`, `lt`, `bool_or`, `eq`, `neq`, `add`, `str_concat`, `sub`, `mul`, `div`, `mod`) cannot be written in call form. Calling any of them by alias emits `OperatorOnlyFn`.
- Infix expressions support only `&`, `>=`, `<=`, `>`, `<`, `|`, `==`, `!=`, `+`, `-`, `*`, `/`, `%`, with exactly two operands.
- The single-reference form cannot reference a binding of a different type (`SingleRefTypeMismatch`).
- `#it` cannot appear outside a `#pipe` step.
- `_` cannot be used as a pipe placeholder or sigil placeholder. It is valid only as a wildcard pattern inside `#case`.
- The wildcard `_` and the keyword literals `true`/`false` are not valid as the single-reference identifier — they are handled by their own forms.

Correlation between CAN and CAN'T:
- Because DSL allows compact typed keys and bare refs, lowering must expand them into explicit `binding` blocks, reference nodes, and canonical expression nodes to stay parseable and unambiguous in plain HCL.
- Because the Surface DSL is parsed by the custom Go CLI (not a stock HCL parser), infix expressions can use plain `=` without a special marker — the parser distinguishes infix from function calls by token lookahead.
- Because operator-only functions have no callable alias in DSL (CAN'T), they are exclusively expressed through their operator syntax (CAN). This is a closed, exhaustive partition: every binary function is either call-only or operator-only.

### Runtime value types

| HCL type     | Runtime symbol | JS primitive | `val.*` builder             |
|--------------|----------------|--------------|-----------------------------|
| `number`     | `'number'`     | `number`           | `val.number(n)` / `n`  |
| `str`        | `'string'`     | `string`     | `val.string(s)` / `s`       |
| `bool`       | `'boolean'`    | `boolean`    | `val.boolean(b)` / `b`      |
| `arr<number>`| `'array'`      | —            | `val.array('number', [...])`|
| `arr<str>`   | `'array'`      | —            | `val.array('string', [...])`|
| `arr<bool>`  | `'array'`      | —            | `val.array('boolean', [...])`|

---

## 1. Program shape

```hcl
prog "main" {
  # bindings
}
```

A program is a single `prog "<name>" { ... }` block.
The `name` label is informational and does not affect the emitted ContextSpec.
Bindings are order-independent; forward references are allowed (the compiler resolves in two passes, matching `ctx()`'s own two-pass processing).

---

## 2. Value bindings (strict typed keys)

```
name:type = literal
```

- `name` must match `[A-Za-z_][A-Za-z0-9_]*`; names starting with `__` are reserved for compiler-generated bindings.
- `type` is one of: `number | str | bool | arr<number> | arr<str> | arr<bool>`
- In the DSL layer, keys are written as `name:type`; the lowering pass splits on the **first** `:` and emits canonical plain HCL `binding` blocks.

### Examples

```hcl
prog "main" {
  n:number        = 10
  msg:str         = "hello"
  flag:bool       = true
  xs:arr<number>  = [1, 2, 3]
  ys:arr<str>     = ["a", "b", "c"]
  bs:arr<bool>    = [true, false, true]
}
```

### Strict parse-time type rules

| Rule | Error |
|------|-------|
| Literal must match declared type | `TypeMismatch` |
| `:number` value must be a valid numeric literal (integers and decimals both accepted) | `NonIntegerValue` |
| All elements of `arr<T>` must be of type `T` | `HeterogeneousArray` |
| Nested arrays are not allowed as value literals | `NestedArrayNotAllowed` |
| Same `name` declared twice in the same `prog` | `DuplicateBinding` |

### ContextSpec emission

```typescript
// n:number = 10  →
{ n: 10 }

// xs:arr<number> = [1, 2, 3]  →
{ xs: val.array('number', [val.number(1), val.number(2), val.number(3)]) }
```

---

## 3. Function expressions

Function expressions in the Surface DSL use call syntax for binary combine functions, plus a parse-safe infix shorthand.
There are five forms: **combine** (call expression), **infix** (`= lhs OP rhs`), **#if**, **#case**, and **#pipe**.

---

### 3.1 Combine — binary operation

Binary functions are divided into two categories based on whether a DSL infix operator is assigned:

**Operator functions** — have an assigned DSL infix operator and **must** be written using it. Call-form alias is forbidden for these:

```hcl
name:bool   = lhs & rhs             # bool_and  — only valid form
name:bool   = lhs >= rhs            # gte        — only valid form
name:bool   = lhs <= rhs            # lte        — only valid form
name:bool   = lhs > rhs             # gt         — only valid form
name:bool   = lhs < rhs             # lt         — only valid form
name:bool   = lhs | rhs             # bool_or    — only valid form
name:bool   = lhs == rhs            # eq         — only valid form
name:bool   = lhs != rhs            # neq        — only valid form
name:number = lhs + rhs             # add        — only valid form
name:str    = lhs + rhs             # str_concat — only valid form  (same token, dispatched by declared type)
name:number = lhs - rhs             # sub        — only valid form
name:number = lhs * rhs             # mul        — only valid form
name:number = lhs / rhs             # div        — only valid form
name:number = lhs % rhs             # mod        — only valid form
```

**Call functions** — have no infix operator and **must** be written using call syntax:

```hcl
name:type = fn_alias(arg1, arg2)        # positional call
name:type = fn_alias(a: arg1, b: arg2) # named call
```

The parser distinguishes infix from function calls by the token following the first operand identifier: an infix operator (`&`, `>=`, `<=`, `+`, `-`, `*`, `/`, `%`, `>`, `<`, `|`, `==`, `!=`) signals an infix expression; `(` signals a function call.

Named calls are normalized during lowering to ordered args `[a, b]`.
Operator functions are normalized by operator:
- `lhs & rhs`  -> `bool_and(lhs, rhs)` (only valid for `name:bool`)
- `lhs >= rhs` -> `gte(lhs, rhs)` (only valid for `name:bool`)
- `lhs <= rhs` -> `lte(lhs, rhs)` (only valid for `name:bool`)
- `lhs > rhs`  -> `gt(lhs, rhs)` (only valid for `name:bool`)
- `lhs < rhs`  -> `lt(lhs, rhs)` (only valid for `name:bool`)
- `lhs | rhs`  -> `bool_or(lhs, rhs)` (only valid for `name:bool`)
- `lhs == rhs` -> `eq(lhs, rhs)` (only valid for `name:bool`)
- `lhs != rhs` -> `neq(lhs, rhs)` (only valid for `name:bool`)
- `lhs + rhs`  -> `add(lhs, rhs)` for `name:number`; `str_concat(lhs, rhs)` for `name:str` (type-dispatched)
- `lhs - rhs`  -> `sub(lhs, rhs)` (only valid for `name:number`)
- `lhs * rhs`  -> `mul(lhs, rhs)` (only valid for `name:number`)
- `lhs / rhs`  -> `div(lhs, rhs)` (only valid for `name:number`)
- `lhs % rhs`  -> `mod(lhs, rhs)` (only valid for `name:number`)

All forms are semantically identical after lowering.
The compiler always lowers to runtime combine args `{ a: <arg1>, b: <arg2> }`.

**Example:**

```hcl
prog "main" {
  v1:number = 5
  v2:number = 3

  diff:number   = v1 - v2
  prod:number   = v1 * v2
  quot:number   = v1 / v2
  txt:str       = "edge " + "mix"
  flag_hi:bool  = v1 >= v2
  flag_lo:bool  = v1 <= v2
  go:bool       = flag_hi & true
}
```

**Emitted ContextSpec:**

```typescript
{
  v1:      5,
  v2:      3,
  diff:    combine('binaryFnNumber::minus',              { a: 'v1', b: 'v2' }),
  prod:    combine('binaryFnNumber::multiply',           { a: 'v1', b: 'v2' }),
  quot:    combine('binaryFnNumber::divide',             { a: 'v1', b: 'v2' }),
  txt:     combine('binaryFnString::concat',             { a: 'edge ', b: 'mix' }),
  flag_hi: combine('binaryFnNumber::greaterThanOrEqual', { a: 'v1', b: 'v2' }),
  flag_lo: combine('binaryFnNumber::lessThanOrEqual',    { a: 'v1', b: 'v2' }),
  go:      combine('binaryFnBoolean::and',               { a: 'flag_hi', b: true }),
}
```

#### Built-in function alias table

Functions marked **operator-only** must be written using their DSL operator. Their alias cannot be used in call form.

| HCL alias      | Runtime `BinaryFnNames`                  | arg1 type | arg2 type | return type | DSL form         |
|----------------|------------------------------------------|-----------|-----------|-------------|------------------|
| `add`          | `binaryFnNumber::add`                    | `number`  | `number`  | `number`    | **operator-only** `+` (for `:number`) |
| `sub`          | `binaryFnNumber::minus`                  | `number`  | `number`  | `number`    | **operator-only** `-` |
| `mul`          | `binaryFnNumber::multiply`               | `number`  | `number`  | `number`    | **operator-only** `*` |
| `div`          | `binaryFnNumber::divide`                 | `number`  | `number`  | `number`    | **operator-only** `/` |
| `mod`          | `binaryFnNumber::mod`                    | `number`  | `number`  | `number`    | **operator-only** `%` |
| `max`          | `binaryFnNumber::max`                    | `number`  | `number`  | `number`    | call only        |
| `min`          | `binaryFnNumber::min`                    | `number`  | `number`  | `number`    | call only        |
| `gt`           | `binaryFnNumber::greaterThan`            | `number`  | `number`  | `bool`      | **operator-only** `>` |
| `gte`          | `binaryFnNumber::greaterThanOrEqual`     | `number`  | `number`  | `bool`      | **operator-only** `>=` |
| `lt`           | `binaryFnNumber::lessThan`               | `number`  | `number`  | `bool`      | **operator-only** `<` |
| `lte`          | `binaryFnNumber::lessThanOrEqual`        | `number`  | `number`  | `bool`      | **operator-only** `<=` |
| `str_concat`   | `binaryFnString::concat`                 | `str`     | `str`     | `str`       | **operator-only** `+`  |
| `str_includes` | `binaryFnString::includes`               | `str`     | `str`     | `bool`      | call only        |
| `str_starts`   | `binaryFnString::startsWith`             | `str`     | `str`     | `bool`      | call only        |
| `str_ends`     | `binaryFnString::endsWith`               | `str`     | `str`     | `bool`      | call only        |
| `bool_and`     | `binaryFnBoolean::and`                   | `bool`    | `bool`    | `bool`      | **operator-only** `&`  |
| `bool_or`      | `binaryFnBoolean::or`                    | `bool`    | `bool`    | `bool`      | **operator-only** `\|` |
| `bool_xor`     | `binaryFnBoolean::xor`                   | `bool`    | `bool`    | `bool`      | call only        |
| `eq`           | `binaryFnGeneric::isEqual`               | any       | any (same)| `bool`      | **operator-only** `==` |
| `neq`          | `binaryFnGeneric::isNotEqual`            | any       | any (same)| `bool`      | **operator-only** `!=` |
| `arr_includes` | `binaryFnArray::includes`                | `arr<T>`  | `T`       | `bool`      | call only        |
| `arr_get`      | `binaryFnArray::get`                     | `arr<T>`  | `number`  | `T`         | call only        |
| `arr_concat`   | `binaryFnArray::concat`                  | `arr<T>`  | `arr<T>`  | `arr<T>`    | call only        |

> **Parse-time checks**: the inferred return type of the function alias must match the binding's declared type. Argument value types must match the function's expected parameter types. Binary call args must be either `(x, y)` or `(a: x, b: y)` (`InvalidBinaryArgShape` otherwise). Infix form must be exactly `name:<type> = lhs OP rhs`; operator/type pairings are enforced: `&`/`>=`/`<=`/`>`/`<`/`|`/`==`/`!=` for `name:bool`; `+`/`-`/`*`/`/`/`%` for `name:number`; `+` (only) for `name:str`; `eq`/`neq` (`==`/`!=`) are the sole exceptions — they accept any homogeneous operand type (`InvalidInfixExpr` otherwise). Using a call-form alias for an operator-only function emits `OperatorOnlyFn`.

---

### 3.2 `#if` — binary conditional expression

```hcl
name:type = #if(cond, then_expr, else_expr)
```

`#if` selects between two expressions. The condition must resolve to `bool`, and only the selected branch is evaluated.

**Example:**

```hcl
prog "main" {
  temp_c:number = 24
  status:str = #if(temp_c < 28, "warmup", "run")
}
```

**Emitted ContextSpec:**

```typescript
{
  temp_c: 24,
  status: ifExpr(
    combine('binaryFnNumber::lessThan', { a: 'temp_c', b: 28 }),
    'warmup',
    'run'
  ),
}
```

**Rules:**

- `cond` must resolve to `bool`.
- `then_expr` and `else_expr` must resolve to the same type.
- The binding's declared type must match the branch type.
- `#if` is preferred for short binary decisions; use `#case` for three or more outcomes.

---

### 3.3 `#case` — ordered classification

```hcl
name:type = #case(
  subject,
  pattern1 => expr1,
  pattern2 => expr2,
  _ => default_expr
)
```

`#case` evaluates arms from top to bottom and returns the expression for the first matching pattern whose guard passes.

**Example:**

```hcl
prog "main" {
  unsafe:bool = false
  spindle_temp_c:number = 24

  route:str = #case(
    (unsafe, spindle_temp_c),
    (true, _) => "lockout",
    (false, t) if t < 28 => "warmup",
    _ => "run"
  )
}
```

**Emitted ContextSpec:**

```typescript
{
  unsafe: false,
  spindle_temp_c: 24,
  route: caseExpr(
    tuple('unsafe', 'spindle_temp_c'),
    [
      { pattern: tuple(true, wildcard()), expr: 'lockout' },
      { pattern: tuple(false, bind('t')), guard: combine('binaryFnNumber::lessThan', { a: 't', b: 28 }), expr: 'warmup' },
      { pattern: wildcard(), expr: 'run' },
    ]
  ),
}
```

**Rules:**

- Supported patterns are literals, wildcard `_`, variable binders, tuple patterns, and guarded arms.
- `_` matches any value and does not bind.
- Pattern binders are visible only in that arm's guard and expression.
- If no arm matches and no wildcard arm exists, evaluation fails.
- All arm expressions must resolve to a common type matching the binding's declared type.

---

### 3.4 `#pipe` — sequential steps

```hcl
name:type = #pipe(
  initial_value,
  step1,
  step2
)
```

`#pipe` evaluates `initial_value`, then evaluates each step in order with `#it` bound to the current pipeline value. The final step result is the pipe result.

**Example:**

```hcl
prog "main" {
  raw_temp_c:number = 24.4

  route:str = #pipe(
    raw_temp_c,
    round(#it, 1),
    #case(
      #it,
      t if t < 28 => "warmup",
      t if t > 90 => "hold",
      _ => "run"
    )
  )
}
```

**Emitted ContextSpec:**

```typescript
{
  raw_temp_c: 24.4,
  route: pipeExpr('raw_temp_c', [
    call('round', [it(), 1]),
    caseExpr(it(), [
      { pattern: bind('t'), guard: combine('binaryFnNumber::lessThan', { a: 't', b: 28 }), expr: 'warmup' },
      { pattern: bind('t'), guard: combine('binaryFnNumber::greaterThan', { a: 't', b: 90 }), expr: 'hold' },
      { pattern: wildcard(), expr: 'run' },
    ]),
  ]),
}
```

**Rules:**

- Each step is a full expression template and may refer to `#it`.
- `#it` is valid only inside a `#pipe` step.
- `_` is not a pipe placeholder.
- The binding's declared type must match the return type of the final step.
---

## 4. Reference types inside argument values

| HCL form | Emits | Valid in |
|----------|-------|----------|
| Bare identifier `v_name` | `'v_name'` (`ValueRef` string) | expressions and call args |
| `#it` | current pipeline value reference | `#pipe` steps only |
| `_` | wildcard pattern | `#case` patterns only |

#### Available transform function names (fully-qualified)

| Namespace | Functions |
|-----------|-----------|
| `transformFnNumber` | `pass`, `toStr`, `abs`, `floor`, `ceil`, `round`, `negate` |
| `transformFnString` | `pass` |
| `transformFnBoolean` | `pass` |
| `transformFnArray` | `pass` |
| `transformFnNull` | `pass` |

> **Note**: The table above lists the internal `pass` identity transform available for all types. The full set of DSL-surface transform methods (e.g. `.toStr()`, `.trim()`, `.abs()`, `.not()`, `.isEmpty()`) is defined in `transform-fn-dsl-spec.md`, which is the authoritative reference for authoring transform expressions.

---

## 5. Error catalogue

| Error code | Trigger condition |
|------------|------------------|
| `TypeMismatch` | Literal does not match declared `:type` |
| `NonIntegerValue` | Non-numeric literal assigned to `:number` binding |
| `HeterogeneousArray` | Mixed element types in `arr<T>` literal |
| `NestedArrayNotAllowed` | Array literal contains a sub-array in a value binding |
| `DuplicateProg` | More than one `prog` block declared in one file |
| `DuplicateBinding` | Same `name` declared twice in one `prog` |
| `ReservedName` | User binding name starts with `__` |
| `UnknownFnAlias` | Function alias not in the built-in table |
| `OperatorOnlyFn` | Call-form alias used for a function that requires operator syntax (`bool_and`, `gte`, `lte`, `str_concat`) |
| `UndefinedRef` | Bare identifier references an unknown binding |
| `UnsupportedBlockExpression` | Object-form function calls, block-style conditionals, or bracket-style pipe blocks appear in v0 source |
| `InvalidBinaryArgShape` | Binary call is not `(x, y)` and not `(a: ..., b: ...)` |
| `InvalidInfixExpr` | Infix expression is malformed, uses an unsupported operator, or violates operator/type pairing |
| `ArgTypeMismatch` | Argument value type does not match the function's expected parameter type |
| `ReturnTypeMismatch` | Function alias return type does not match binding's declared type |
| `CondNotBool` | `condition` binding does not resolve to `bool` |
| `BranchTypeMismatch` | `then` and `else` return types differ |
| `CaseArmTypeMismatch` | `#case` arm expressions do not resolve to a common type |
| `CaseNoMatch` | `#case` evaluation reaches no matching arm and no `_` wildcard arm exists |
| `ItOutsidePipe` | `#it` appears outside a `#pipe` step |
| `InvalidWildcardUse` | `_` appears anywhere other than a `#case` wildcard pattern |
| `SingleRefTypeMismatch` | Single-reference form `name:type = identifier` where `identifier` resolves to a different type than `type` |

---

## 6. Phase 2 — Loop constructs (runtime extension required)

The following constructs are syntactically reserved. They cannot be compiled to the current ContextSpec without adding new builder types, because:

1. `range(n)` is a **unary** operation — the current binary function model requires two arguments.
2. `map`, `filter`, `fold` take a **function reference** as an argument — `AnyValue` cannot hold a `FuncRef` in the current value type system.

### Reserved syntax (Phase 2)

```hcl
# range — produces [0, 1, ..., n-1]
xs:arr<number> = { range = { n = count } }

# map — applies fn to each element
ys:arr<number> = {
  map = {
    xs = source_arr
    fn = step_fn_name
  }
}

# filter — keeps elements where predicate returns true
zs:arr<number> = {
  filter = {
    xs   = source_arr
    pred = predicate_fn_name
  }
}

# fold — reduces array to single value
total:number = {
  fold = {
    xs   = source_arr
    init = zero_value
    fn   = step_fn_name
  }
}
```

### Required runtime additions (Phase 2)

| New builder type | New ContextSpec key | Description |
|-----------------|---------------------|-------------|
| `RangeBuilder`  | `{ __type: 'range'; count: ValueRef }` | Produces `arr<number>` |
| `MapBuilder`    | `{ __type: 'map'; xs: ValueRef; fn: FuncRef }` | Applies function to each element |
| `FilterBuilder` | `{ __type: 'filter'; xs: ValueRef; pred: FuncRef }` | Filters by boolean predicate |
| `FoldBuilder`   | `{ __type: 'fold'; xs: ValueRef; init: ValueRef; fn: FuncRef }` | Left fold |

These would extend `FunctionBuilder` and require new execution paths in `executeGraph`.

---

## 7. Complete Phase 1 example

```hcl
prog "main" {
  # --- Values ---
  n:number = 10
  msg:str  = "score"

  # --- Arithmetic (operator forms) ---
  doubled:number = n * n
  halved:number  = n / 2
  less:number    = n - 1

  # --- String ---
  label_hi:str = msg + " high"
  label_lo:str = msg + " low"

  # --- Condition via combine ---
  is_big:bool = doubled >= n

  # --- Pipe: (n * n) - n ---
  piped:number = #pipe(
    n,
    #it * #it,
    #it - n
  )

  # --- #case classification ---
  band:str = #case(
    piped,
    x if x >= 80 => "high",
    x if x >= 50 => "medium",
    _ => "low"
  )

  # --- #if binary choice ---
  final:str = #if(piped > doubled, msg + " !", msg + " .")
}
```

**Emitted ContextSpec:**

```typescript
ctx({
  n:                 10,
  msg:               'score',
  doubled:           combine('binaryFnNumber::multiply',         { a: 'n',      b: 'n' }),
  halved:            combine('binaryFnNumber::divide',           { a: 'n',      b: 2 }),
  less:              combine('binaryFnNumber::minus',            { a: 'n',      b: 1 }),
  label_hi:          combine('binaryFnString::concat',           { a: 'msg',    b: ' high' }),
  label_lo:          combine('binaryFnString::concat',           { a: 'msg',    b: ' low'  }),
  is_big:            combine('binaryFnNumber::greaterThanOrEqual', { a: 'doubled', b: 'n' }),
  piped:             pipeExpr('n', [
                       combine('binaryFnNumber::multiply', { a: it(), b: it() }),
                       combine('binaryFnNumber::minus',    { a: it(), b: 'n' }),
                     ]),
  band:              caseExpr('piped', [
                       { pattern: bind('x'), guard: combine('binaryFnNumber::greaterThanOrEqual', { a: 'x', b: 80 }), expr: 'high' },
                       { pattern: bind('x'), guard: combine('binaryFnNumber::greaterThanOrEqual', { a: 'x', b: 50 }), expr: 'medium' },
                       { pattern: wildcard(), expr: 'low' },
                     ]),
  final:             ifExpr(
                       combine('binaryFnNumber::greaterThan', { a: 'piped', b: 'doubled' }),
                       combine('binaryFnString::concat', { a: 'msg', b: ' !' }),
                       combine('binaryFnString::concat', { a: 'msg', b: ' .' }),
                     ),
})
```

---

## 8. Test plan

### Domain categories

| Domain | Coverage target |
|--------|----------------|
| A. Parser / tokenizer | Type annotation splitting, literal coercion |
| B. Type checker | Strict enforcement at parse time |
| C. Reference resolver | Two-pass forward-reference resolution |
| D. Combine emitter | All 24 function aliases |
| E. Pipe emitter | `#it` scoping and ordered step evaluation |
| F. `#if` emitter | condition/branch type checking and selected-branch evaluation |
| G. `#case` emitter | ordered pattern matching, guards, wildcard fallback |
| H. Error paths | All error codes |

### Critical paths

| # | Path | Idempotency check |
|---|------|------------------|
| 1 | Parse `name:arr<number> = [1,2,3]` → emit `val.array('number', [...])` | Re-parse emitted TS, compare AST |
| 2 | `add(v1, v2)` and `add(a: v1, b: v2)` → same `combine('binaryFnNumber::add', { a: 'v1', b: 'v2' })` | Both call forms emit identical ContextSpec |
| 3 | Pipe with `#it` in each step → current pipeline value resolved to the prior step result | Round-trip: ContextSpec → `ctx()` → same `ExecutionContext` shape |
| 4 | Forward reference: `result` defined before `flag` (its condition) | Compiler produces identical output regardless of declaration order |
| 5 | `#if(cond, then, else)` expression | Branch type and condition type checks are deterministic |
| 6 | `income_ok:bool = income >= min_income`, `debt_ok:bool = debt <= max_debt`, `approval_code:str = prefix + suffix`, `remainder:number = total - discount`, `area:number = w * h`, `rate:number = amount / count` | Operator forms are the only valid DSL; each lowers to the correct runtime `BinaryFnNames` |
| 7 | `#case` with guarded tuple arms and `_` fallback | First matching arm wins; fallback is selected only when no earlier arm matches |

### Edge cases

| Case | Expected behaviour |
|------|--------------------|
| `n:number = "hello"` | `TypeMismatch` error (string literal assigned to `number` type) |
| `xs:arr<number> = []` | Emit `val.array('number', [])` — empty array is valid |
| `#if(flag, 1, "one")` | `BranchTypeMismatch` error |
| `#case(x, 1 => "one", 2 => 2)` | `CaseArmTypeMismatch` error |
| `#case(x, 1 => "one")` with subject `2` | `CaseNoMatch` runtime error |
| `n:number = #it + 1` outside `#pipe` | `ItOutsidePipe` error |
| `n:number = _` outside a `#case` pattern | `InvalidWildcardUse` error |
| Two `prog` blocks in one file | `DuplicateProg` error — a file may contain at most one `prog` block |
| `add(a: v1)` | `InvalidBinaryArgShape` error (`b` missing) |
| `add(a: v1, b: v2, c: v3)` | `InvalidBinaryArgShape` error (extra key) |
| `go:bool = decision && income_ok` | `InvalidInfixExpr` error (unsupported operator token) |
| `go:bool = bool_and(flag_hi, flag_lo)` | `OperatorOnlyFn` error (`bool_and` requires `&` operator) |
| `ok:bool = gte(income, min)` | `OperatorOnlyFn` error (`gte` requires `>=` operator) |
| `ok:bool = gt(income, 0)` | `OperatorOnlyFn` error (`gt` requires `>` operator) |
| `ok:bool = lt(debt, max)` | `OperatorOnlyFn` error (`lt` requires `<` operator) |
| `ok:bool = bool_or(a, b)` | `OperatorOnlyFn` error (`bool_or` requires `|` operator) |
| `ok:bool = eq(a, b)` | `OperatorOnlyFn` error (`eq` requires `==` operator) |
| `ok:bool = neq(a, b)` | `OperatorOnlyFn` error (`neq` requires `!=` operator) |
| `sum:number = add(a, b)` | `OperatorOnlyFn` error (`add` requires `+` operator) |
| `rem:number = mod(a, b)` | `OperatorOnlyFn` error (`mod` requires `%` operator) |
| `label:str = str_concat(a, b)` | `OperatorOnlyFn` error (`str_concat` requires `+` operator) |
| `diff:number = sub(a, b)` | `OperatorOnlyFn` error (`sub` requires `-` operator) |
| `prod:number = mul(a, b)` | `OperatorOnlyFn` error (`mul` requires `*` operator) |
| `quot:number = div(a, b)` | `OperatorOnlyFn` error (`div` requires `/` operator) |
| `approval_code:str = prefix ++ suffix` | `InvalidInfixExpr` error (unsupported operator token) |
| `n:str = a - b` | `InvalidInfixExpr` error (`-` is only valid for `name:number`) |
| `n:str = a == b` | `InvalidInfixExpr` error (`==` produces `bool`, not `str`) |
| `n:number = a | b` | `InvalidInfixExpr` error (`|` is only valid for `name:bool`) |
| `__reserved:number = 1` | `ReservedName` error |
| `eq` with mismatched arg types (`int` vs `str`) | `ArgTypeMismatch` error |
| Block-style conditional form appears in source | `UnsupportedBlockExpression` error |

### Manual intervention points

- **`div` fractional results**: `binaryFnNumber::divide` may return a fractional result. Since the DSL type `number` maps to JavaScript `number` (which accepts fractions), this is no longer a type violation. Authors requiring integer results should chain `.floor()` or `.round()` after `div`.
- **Phase 2 activation**: Phase 2 loop syntax (`range`, `map`, `filter`, `fold`) encountered in a Phase 1 file is a hard parse error that aborts conversion.

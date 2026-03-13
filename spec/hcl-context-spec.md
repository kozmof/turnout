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
    type  = "int"
    value = 5
  }

  binding "sum" {
    type = "int"
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
| `name:type = identifier` (single bare identifier, not a literal; see §2.1 for disambiguation) | `binding "name" { type = "type" expr = { combine = { fn = "<identity-fn>" args = [arg(identifier), arg(identity-rhs)] } } }` where identity-fn and identity-rhs are type-dependent (see identity-combine table below) |
| `name:type = fn_alias(x, y)` | `binding "name" { type = "type" expr = { combine = { fn = "fn_alias" args = [arg(x), arg(y)] } } }` |
| `name:type = fn_alias(a: x, b: y)` | `binding "name" { type = "type" expr = { combine = { fn = "fn_alias" args = [arg(x), arg(y)] } } }` |
| `name:bool = lhs & rhs` | `binding "name" { type = "bool" expr = { combine = { fn = "bool_and" args = [arg(lhs), arg(rhs)] } } }` |
| `name:bool = lhs >= rhs` | `binding "name" { type = "bool" expr = { combine = { fn = "gte" args = [arg(lhs), arg(rhs)] } } }` |
| `name:bool = lhs <= rhs` | `binding "name" { type = "bool" expr = { combine = { fn = "lte" args = [arg(lhs), arg(rhs)] } } }` |
| `name:str = lhs + rhs` | `binding "name" { type = "str" expr = { combine = { fn = "str_concat" args = [arg(lhs), arg(rhs)] } } }` |
| `name:type = { fn_alias = [x, y] }` (compatibility input) | `binding "name" { type = "type" expr = { combine = { fn = "fn_alias" args = [arg(x), arg(y)] } } }` |
| `name:type = { fn_alias = [a: x, b: y] }` (compatibility input) | `binding "name" { type = "type" expr = { combine = { fn = "fn_alias" args = [arg(x), arg(y)] } } }` |
| `name:type = #pipe(p1:v1, p2:v2)[fn_alias(...), ...]` | `binding "name" { type = "type" expr = { pipe = { args = { p1 = ref(v1), p2 = ref(v2) } steps = [ { fn = "...", args = [arg(...), arg(...)] }, ... ] } } }` |
| `name:type = { pipe = { args = {...} steps = [fn_alias(...), ...] } }` (compatibility input) | `binding "name" { type = "type" expr = { pipe = { args = {...} steps = [ { fn = "...", args = [arg(...), arg(...)] }, ... ] } } }` |
| `cond = { condition = c then = t else = e }` | `expr = { cond = { condition = { ref = "c" } then = { func_ref = "t" } else = { func_ref = "e" } } }` |
| `#if` inline condition (`cond = fn_alias(...)`) | lowered to generated `binding "__if_<name>_cond"` + `cond` |

#### Identity-combine table (for single-reference form)

The single-reference form `name:type = identifier` lowers to a combine using a type-appropriate identity operation. The result is always a function binding, not a value binding.

| Declared type | Identity combine | Lowered canonical HCL (abbreviated) |
|---|---|---|
| `bool` | `bool_and(identifier, true)` | `combine = { fn = "bool_and" args = [{ ref = "identifier" }, { lit = true }] }` |
| `int` | `add(identifier, 0)` | `combine = { fn = "add" args = [{ ref = "identifier" }, { lit = 0 }] }` |
| `str` | `str_concat(identifier, "")` | `combine = { fn = "str_concat" args = [{ ref = "identifier" }, { lit = "" }] }` |
| `arr<T>` | `arr_concat(identifier, [])` | `combine = { fn = "arr_concat" args = [{ ref = "identifier" }, { lit = [] }] }` |

The identity RHS literal (`true`, `0`, `""`, `[]`) is chosen so the combine always returns the value of `identifier` unchanged.

#### Disambiguation: single-reference form vs literal vs infix

After `name:type =`, the parser selects the form by examining the first and second tokens of the RHS:

| First token | Second token | Form |
|---|---|---|
| keyword literal (`true`, `false`) | any | value binding (literal) |
| numeric literal, string literal, `[` | any | value binding (literal) |
| bare `IDENT` (not `true`/`false`) | `(` | function call |
| bare `IDENT` (not `true`/false`) | `&`, `>=`, `<=`, `+` | infix expression |
| bare `IDENT` (not `true`/`false`) | end-of-line, `}`, or next `IDENT:` | **single-reference form** |
| `{` | any | block form (cond/if/pipe compat) |
| `#pipe` | any | pipe form |
| `#if` | any | if form |
| `_` (with directional sigil prefix) | any | ingress placeholder |

The ingress placeholder `_` is not a bare identifier and must not match the single-reference form.

### End-to-end lowering example

Surface DSL:

```hcl
prog "main" {
  v1:int = 5
  v2:int = 3
  sum:int = add(v1, v2)
}
```

Lowered plain HCL:

```hcl
prog "main" {
  binding "v1" {
    type  = "int"
    value = 5
  }

  binding "v2" {
    type  = "int"
    value = 3
  }

  binding "sum" {
    type = "int"
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
- Infix `lhs & rhs` -> ordered pair `[arg(lhs), arg(rhs)]` with `fn = "bool_and"`
- Infix `lhs >= rhs` -> ordered pair `[arg(lhs), arg(rhs)]` with `fn = "gte"`
- Infix `lhs <= rhs` -> ordered pair `[arg(lhs), arg(rhs)]` with `fn = "lte"`
- Infix `lhs + rhs` -> ordered pair `[arg(lhs), arg(rhs)]` with `fn = "str_concat"`
- Single-reference form `name:type = identifier` -> identity combine args per the identity-combine table above
- Pipe header pair `#pipe(p: v)` -> `args = { p = ref(v) }`
- Compatibility object args `[x, y]` -> ordered pair `[arg(x), arg(y)]`
- Compatibility object args `[a: x, b: y]` -> ordered pair `[arg(x), arg(y)]`
- DSL bare identifier `v` -> `{ ref = "v" }`
- DSL literal (`"s"`, `1`, `true`, `[1,2]`) -> `{ lit = <literal> }`
- `{ func_ref = "fn" }` -> `{ func_ref = "fn" }`
- `{ step_ref = N }` -> `{ step_ref = N }`
- `{ transform = { ref = "v", fn = "transformFn..." } }` -> unchanged

### Balance rules (CAN / CAN'T)

CAN (OK):
- Authors can use typed keys in DSL (`v1:int = 5`).
- Authors can use bare identifiers as references in DSL (`add(v1, v2)`).
- Authors can write explicit named args (`add(a: v1, b: v2)`).
- Authors can write operator-only functions using their assigned DSL operator (`income_ok:bool = income >= min_income`, `approval_code:str = prefix + suffix`, `go:bool = flag_hi & flag_lo`).
- Authors can write call-only functions using call syntax (`add(v1, v2)`, `gt(v1, v2)`, `bool_or(a, b)`).
- Authors can write pipes as `#pipe(x:n)[step1, step2]`.
- Authors can write a single-reference binding `name:type = identifier` to pass another binding's value through as a function binding. The compiler lowers this to an identity combine per the identity-combine table.
- Compiler may accept legacy object input (`{ add = [v1, v2] }`, `{ add = [a: v1, b: v2] }`) and normalize it to call form.

CAN'T (NG):
- Lowered plain HCL cannot keep `name:type` as an attribute key.
- Lowered plain HCL cannot keep bare references in argument positions.
- Lowered plain HCL cannot encode branch references as untyped strings.
- A single binary call cannot mix positional and named argument forms.
- Operator-only functions (`bool_and`, `gte`, `lte`, `str_concat`) cannot be written in call form. `bool_and(a, b)`, `gte(a, b)`, `lte(a, b)`, `str_concat(a, b)` are all `OperatorOnlyFn` errors.
- Operator-only functions cannot appear as steps inside `#pipe(...)[ ]`, because pipe steps require call syntax. They must instead be expressed as call-form aliases — but since operator-only functions have no callable alias, they cannot be used as pipe steps.
- Infix expressions support only `&`, `>=`, `<=`, `+`, with exactly two operands.
- The single-reference form cannot reference a binding of a different type (`SingleRefTypeMismatch`).
- The ingress placeholder `_` and the keyword literals `true`/`false` are not valid as the single-reference identifier — they are handled by their own forms.

Correlation between CAN and CAN'T:
- Because DSL allows compact typed keys and bare refs, lowering must expand them into explicit `binding` blocks and typed reference objects (`ref`, `func_ref`) to stay parseable and unambiguous in plain HCL.
- Because the Surface DSL is parsed by the custom Go CLI (not a stock HCL parser), infix expressions can use plain `=` without a special marker — the parser distinguishes infix from function calls by token lookahead.
- Because operator-only functions have no callable alias in DSL (CAN'T), they are exclusively expressed through their operator syntax (CAN). This is a closed, exhaustive partition: every binary function is either call-only or operator-only.

### Runtime value types

| HCL type     | Runtime symbol | JS primitive | `val.*` builder             |
|--------------|----------------|--------------|-----------------------------|
| `int`        | `'number'`     | `number` (integer) | `val.number(n)` / `n`  |
| `str`        | `'string'`     | `string`     | `val.string(s)` / `s`       |
| `bool`       | `'boolean'`    | `boolean`    | `val.boolean(b)` / `b`      |
| `arr<int>`   | `'array'`      | —            | `val.array('number', [...])`|
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
- `type` is one of: `int | str | bool | arr<int> | arr<str> | arr<bool>`
- In the DSL layer, keys are written as `name:type`; the lowering pass splits on the **first** `:` and emits canonical plain HCL `binding` blocks.

### Examples

```hcl
prog "main" {
  n:int        = 10
  msg:str      = "hello"
  flag:bool    = true
  xs:arr<int>  = [1, 2, 3]
  ys:arr<str>  = ["a", "b", "c"]
  bs:arr<bool> = [true, false, true]
}
```

### Strict parse-time type rules

| Rule | Error |
|------|-------|
| Literal must match declared type | `TypeMismatch` |
| `:int` value must have no fractional part (`42` OK, `3.14` error) | `NonIntegerValue` |
| All elements of `arr<T>` must be of type `T` | `HeterogeneousArray` |
| Nested arrays are not allowed as value literals | `NestedArrayNotAllowed` |
| Same `name` declared twice in the same `prog` | `DuplicateBinding` |

### ContextSpec emission

```typescript
// n:int = 10  →
{ n: 10 }

// xs:arr<int> = [1, 2, 3]  →
{ xs: val.array('number', [val.number(1), val.number(2), val.number(3)]) }
```

---

## 3. Function expressions

Function expressions in the Surface DSL use call syntax for binary combine functions, plus a parse-safe infix shorthand.
There are five forms: **combine** (call expression), **infix** (`= lhs OP rhs`), **#pipe**, **cond**, and **#if** (sugar for cond).

---

### 3.1 Combine — binary operation

Binary functions are divided into two categories based on whether a DSL infix operator is assigned:

**Operator functions** — have an assigned DSL infix operator and **must** be written using it. Call-form alias is forbidden for these:

```hcl
name:bool = lhs & rhs               # bool_and  — only valid form
name:bool = lhs >= rhs              # gte        — only valid form
name:bool = lhs <= rhs              # lte        — only valid form
name:str  = lhs + rhs               # str_concat — only valid form
```

**Call functions** — have no infix operator and **must** be written using call syntax:

```hcl
name:type = fn_alias(arg1, arg2)        # positional call
name:type = fn_alias(a: arg1, b: arg2) # named call
```

The parser distinguishes infix from function calls by the token following the first operand identifier: an infix operator (`&`, `>=`, `<=`, `+`) signals an infix expression; `(` signals a function call.

Named calls are normalized during lowering to ordered args `[a, b]`.
Operator functions are normalized by operator:
- `lhs & rhs` -> `bool_and(lhs, rhs)`
- `lhs >= rhs` -> `gte(lhs, rhs)`
- `lhs <= rhs` -> `lte(lhs, rhs)`
- `lhs + rhs` -> `str_concat(lhs, rhs)` (only valid for `name:str`)

All forms are semantically identical after lowering.
The compiler always lowers to runtime combine args `{ a: <arg1>, b: <arg2> }`.

**Example:**

```hcl
prog "main" {
  v1:int = 5
  v2:int = 3

  sum:int      = add(v1, v2)
  txt:str      = "edge " + "mix"
  flag_hi:bool = v1 >= v2
  flag_lo:bool = v1 <= v2
  go:bool      = flag_hi & true
}
```

Compatibility input `name:type = { fn_alias = [x, y] }` / `name:type = { fn_alias = [a: x, b: y] }` may be accepted and normalized to call form before lowering.

**Emitted ContextSpec:**

```typescript
{
  v1:   5,
  v2:   3,
  sum:  combine('binaryFnNumber::add',      { a: 'v1', b: 'v2' }),
  txt:  combine('binaryFnString::concat',        { a: 'edge ', b: 'mix' }),
  flag_hi: combine('binaryFnNumber::greaterThanOrEqual', { a: 'v1', b: 'v2' }),
  flag_lo: combine('binaryFnNumber::lessThanOrEqual',    { a: 'v1', b: 'v2' }),
  go:   combine('binaryFnBoolean::and',          { a: 'flag_hi', b: true }),
}
```

#### Built-in function alias table

Functions marked **operator-only** must be written using their DSL operator. Their alias cannot be used in call form.

| HCL alias      | Runtime `BinaryFnNames`                  | arg1 type | arg2 type | return type | DSL form         |
|----------------|------------------------------------------|-----------|-----------|-------------|------------------|
| `add`          | `binaryFnNumber::add`                    | `int`     | `int`     | `int`       | call only        |
| `sub`          | `binaryFnNumber::minus`                  | `int`     | `int`     | `int`       | call only        |
| `mul`          | `binaryFnNumber::multiply`               | `int`     | `int`     | `int`       | call only        |
| `div`          | `binaryFnNumber::divide`                 | `int`     | `int`     | `int`       | call only        |
| `mod`          | `binaryFnNumber::mod`                    | `int`     | `int`     | `int`       | call only        |
| `max`          | `binaryFnNumber::max`                    | `int`     | `int`     | `int`       | call only        |
| `min`          | `binaryFnNumber::min`                    | `int`     | `int`     | `int`       | call only        |
| `gt`           | `binaryFnNumber::greaterThan`            | `int`     | `int`     | `bool`      | call only        |
| `gte`          | `binaryFnNumber::greaterThanOrEqual`     | `int`     | `int`     | `bool`      | **operator-only** `>=` |
| `lt`           | `binaryFnNumber::lessThan`               | `int`     | `int`     | `bool`      | call only        |
| `lte`          | `binaryFnNumber::lessThanOrEqual`        | `int`     | `int`     | `bool`      | **operator-only** `<=` |
| `str_concat`   | `binaryFnString::concat`                 | `str`     | `str`     | `str`       | **operator-only** `+`  |
| `str_includes` | `binaryFnString::includes`               | `str`     | `str`     | `bool`      | call only        |
| `str_starts`   | `binaryFnString::startsWith`             | `str`     | `str`     | `bool`      | call only        |
| `str_ends`     | `binaryFnString::endsWith`               | `str`     | `str`     | `bool`      | call only        |
| `bool_and`     | `binaryFnBoolean::and`                   | `bool`    | `bool`    | `bool`      | **operator-only** `&`  |
| `bool_or`      | `binaryFnBoolean::or`                    | `bool`    | `bool`    | `bool`      | call only        |
| `bool_xor`     | `binaryFnBoolean::xor`                   | `bool`    | `bool`    | `bool`      | call only        |
| `eq`           | `binaryFnGeneric::isEqual`               | any       | any (same)| `bool`      | call only        |
| `neq`          | `binaryFnGeneric::isNotEqual`            | any       | any (same)| `bool`      | call only        |
| `arr_includes` | `binaryFnArray::includes`                | `arr<T>`  | `T`       | `bool`      | call only        |
| `arr_get`      | `binaryFnArray::get`                     | `arr<T>`  | `int`     | `T`         | call only        |
| `arr_concat`   | `binaryFnArray::concat`                  | `arr<T>`  | `arr<T>`  | `arr<T>`    | call only        |

> **Parse-time checks**: the inferred return type of the function alias must match the binding's declared type. Argument value types must match the function's expected parameter types. Binary call args must be either `(x, y)` or `(a: x, b: y)` (`InvalidBinaryArgShape` otherwise). Infix form must be exactly `name:<type> = lhs OP rhs` with supported operators `&`, `>=`, `<=`, `+`; `+` is valid only for `name:str` (`InvalidInfixExpr` otherwise). Using a call-form alias for an operator-only function emits `OperatorOnlyFn`.

---

### 3.2 `#pipe` — sequential steps

```hcl
name:type = #pipe(param_name:value_binding_key, ...)[
  fn_alias(ref_1, ref_2),                      # positional call
  fn_alias(a: ref_1, b: ref_2),                # named call
  ...
]
```

Compatibility input `name:type = pipe(...)[...]` and `name:type = { pipe = { args = {...} steps = [...] } }` may be accepted and normalized to the `#pipe(...)[...]` form before lowering.

**Example:**

```hcl
prog "main" {
  v1:int = 5
  v2:int = 3

  result:int = #pipe(x:v1, y:v2)[
    add(x, y),
    mul(a: { step_ref = 0 }, b: x)
  ]
}
```

**Emitted ContextSpec:**

```typescript
{
  v1: 5,
  v2: 3,
  result: pipe(
    { x: 'v1', y: 'v2' },
    [
      combine('binaryFnNumber::add',      { a: 'x',                        b: 'y' }),
      combine('binaryFnNumber::multiply', { a: ref.step('result', 0),      b: 'x' }),
    ]
  ),
}
```

**Rules:**

- `#pipe(...)` header pairs define pipe parameter names and source value bindings; each `param:value` source must reference a **value** binding (not a function binding).
- Each entry in `steps` is a combine expression using the same alias table as §3.1.
- Each step accepts positional (`fn(x, y)`) or named (`fn(a: x, b: y)`) args; both lower identically.
- Inside `steps`, argument references may be:
  - A pipe parameter name (from the `#pipe(...)` header)
  - A context value binding name
  - `{ step_ref = N }` — reference to the output of step N (N must be < current step index) → `ref.step(name, N)`
  - `{ func_ref = "fn_name" }` — reference to a function's output → `ref.output('fn_name')`
  - `{ transform = { ref = "v", fn = "transformFnNumber::toStr" } }` → `ref.transform('v', 'transformFnNumber::toStr')`
- The binding's declared type must match the return type of the **last** step.

---

### 3.3 Cond — conditional dispatch

```hcl
name:type = {
  cond = {
    condition = binding_name
    then      = fn_binding_name
    else      = fn_binding_name
  }
}
```

**Example:**

```hcl
prog "main" {
  v1:int = 10
  v2:int = 3

  flag:bool = gt(v1, v2)
  addFn:int = add(v1, v2)
  subFn:int = sub(v1, v2)

  result:int = {
    cond = {
      condition = flag
      then      = addFn
      else      = subFn
    }
  }
}
```

**Emitted ContextSpec:**

```typescript
{
  v1:     10,
  v2:     3,
  flag:   combine('binaryFnNumber::greaterThan', { a: 'v1', b: 'v2' }),
  addFn:  combine('binaryFnNumber::add',         { a: 'v1', b: 'v2' }),
  subFn:  combine('binaryFnNumber::minus',       { a: 'v1', b: 'v2' }),
  result: cond('flag', { then: 'addFn', else: 'subFn' }),
}
```

**Rules:**

- `condition` must be a binding name whose resolved type is `bool` (value or function output).
- `then` and `else` must be **function** binding names (combine/#pipe/cond/#if).
- Both branches must have the same resolved return type, which must match the binding's declared type.

---

### 3.4 `#if` — syntactic sugar for `cond`

`#if` extends `cond` by allowing the condition to be an **inline combine call** instead of a bare binding name. Inline combine args can be positional or named, following §3.1. When inlined, the compiler auto-generates a hidden condition binding named `__if_<name>_cond`.

The inline condition must be a **call-only** function (e.g. `gt`, `lt`, `eq`). Operator-only functions (`gte`, `lte`, `bool_and`, `str_concat`) cannot be used as an inline `cond` expression because they require infix syntax, which is not supported inside `#if { cond = ... }`.

```hcl
name:type = #if {
  cond = fn_alias(ref_1, ref_2)   # must be a call-only function
  then = fn_binding_name
  else = fn_binding_name
}
```

Compatibility input `name:type = { if = { ... } }` may be accepted and normalized to the `#if { ... }` form before lowering.

`cond` may also be a bare binding name (identical to the `cond` form):

```hcl
name:type = #if {
  cond = existing_bool_binding
  then = fn_binding_name
  else = fn_binding_name
}
```

**Example — inline condition:**

```hcl
prog "main" {
  v1:int = 10
  v2:int = 3

  addFn:int = add(v1, v2)
  subFn:int = sub(v1, v2)

  result:int = #if {
    cond = gt(v1, v2)
    then = addFn
    else = subFn
  }
}
```

**Emitted ContextSpec (compiler-generated `__if_result_cond`):**

```typescript
{
  v1:                5,
  v2:                3,
  addFn:             combine('binaryFnNumber::add',         { a: 'v1', b: 'v2' }),
  subFn:             combine('binaryFnNumber::minus',       { a: 'v1', b: 'v2' }),
  __if_result_cond:  combine('binaryFnNumber::greaterThan', { a: 'v1', b: 'v2' }),
  result:            cond('__if_result_cond', { then: 'addFn', else: 'subFn' }),
}
```

**Rules:**

- Auto-generated names (`__if_<name>_cond`) must not clash with user bindings. The `__` prefix is reserved.
- `then`/`else` must still reference named function bindings — inline branch values are not supported (no identity function exists in the current runtime).
- All other rules from §3.3 apply.

---

## 4. Reference types inside argument values

| HCL form | Emits | Valid in |
|----------|-------|----------|
| Bare identifier `v_name` | `'v_name'` (`ValueRef` string) | combine args, pipe args |
| Bare identifier in `cond.then`/`cond.else` | `'fn_name'` (`FuncRef` string) | cond/#if |
| `{ func_ref = "fn_name" }` | `ref.output('fn_name')` (`FuncOutputRef`) | combine args, pipe step args |
| `{ step_ref = N }` | `ref.step(pipe_name, N)` (`StepOutputRef`) | pipe step args only |
| `{ transform = { ref = "v", fn = "transformFn..." } }` | `ref.transform('v', 'transformFn...')` (`TransformRef`) | combine args, pipe step args |

#### Available transform function names (fully-qualified)

| Namespace | Functions |
|-----------|-----------|
| `transformFnNumber` | `pass`, `toStr`, `abs`, `floor`, `ceil`, `round`, `negate` |
| `transformFnString` | `pass` |
| `transformFnBoolean` | `pass` |
| `transformFnArray` | `pass` |
| `transformFnNull` | `pass` |

---

## 5. Error catalogue

| Error code | Trigger condition |
|------------|------------------|
| `TypeMismatch` | Literal does not match declared `:type` |
| `NonIntegerValue` | Float literal assigned to `:int` binding |
| `HeterogeneousArray` | Mixed element types in `arr<T>` literal |
| `NestedArrayLiteral` | Array literal contains a sub-array in a value binding |
| `DuplicateBinding` | Same `name` declared twice in one `prog` |
| `ReservedName` | User binding name starts with `__` |
| `UnknownFnAlias` | Function alias not in the built-in table |
| `OperatorOnlyFn` | Call-form alias used for a function that requires operator syntax (`bool_and`, `gte`, `lte`, `str_concat`) |
| `UndefinedRef` | Bare identifier references an unknown binding |
| `UndefinedFuncRef` | `func_ref`/`then`/`else` references a non-function binding |
| `InvalidBinaryArgShape` | Binary call is not `(x, y)` and not `(a: ..., b: ...)` |
| `InvalidInfixExpr` | Infix expression is malformed, uses an unsupported operator, or violates operator/type pairing |
| `ArgTypeMismatch` | Argument value type does not match the function's expected parameter type |
| `ReturnTypeMismatch` | Function alias return type does not match binding's declared type |
| `CondNotBool` | `condition` binding does not resolve to `bool` |
| `BranchTypeMismatch` | `then` and `else` return types differ |
| `StepRefOutOfBounds` | `step_ref = N` where N ≥ current step index |
| `CrossPipeStepRef` | `step_ref` inside a pipe references a different pipe's step |
| `PipeArgNotValue` | pipe parameter mapping references a function binding (must be value) |
| `SingleRefTypeMismatch` | Single-reference form `name:type = identifier` where `identifier` resolves to a different type than `type` |

---

## 6. Phase 2 — Loop constructs (runtime extension required)

The following constructs are syntactically reserved. They cannot be compiled to the current ContextSpec without adding new builder types, because:

1. `range(n)` is a **unary** operation — the current binary function model requires two arguments.
2. `map`, `filter`, `fold` take a **function reference** as an argument — `AnyValue` cannot hold a `FuncRef` in the current value type system.

### Reserved syntax (Phase 2)

```hcl
# range — produces [0, 1, ..., n-1]
xs:arr<int> = { range = { n = count } }

# map — applies fn to each element
ys:arr<int> = {
  map = {
    xs = source_arr
    fn = step_fn_name
  }
}

# filter — keeps elements where predicate returns true
zs:arr<int> = {
  filter = {
    xs   = source_arr
    pred = predicate_fn_name
  }
}

# fold — reduces array to single value
total:int = {
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
| `RangeBuilder`  | `{ __type: 'range'; count: ValueRef }` | Produces `arr<int>` |
| `MapBuilder`    | `{ __type: 'map'; xs: ValueRef; fn: FuncRef }` | Applies function to each element |
| `FilterBuilder` | `{ __type: 'filter'; xs: ValueRef; pred: FuncRef }` | Filters by boolean predicate |
| `FoldBuilder`   | `{ __type: 'fold'; xs: ValueRef; init: ValueRef; fn: FuncRef }` | Left fold |

These would extend `FunctionBuilder` and require new execution paths in `executeGraph`.

---

## 7. Complete Phase 1 example

```hcl
prog "main" {
  # --- Values ---
  n:int   = 10
  msg:str = "score"

  # --- Arithmetic ---
  doubled:int = mul(n, n)

  # --- String ---
  label_hi:str = msg + " high"
  label_lo:str = msg + " low"

  # --- Condition via combine ---
  is_big:bool = doubled >= n

  # --- Pipe: (n * n) + n ---
  piped:int = #pipe(x:n)[
    mul(x, x),
    add({ step_ref = 0 }, x)
  ]

  # --- #if (inline condition) ---
  result_fn_hi:str = msg + " !"
  result_fn_lo:str = msg + " ."

  final:str = #if {
    cond = gt(piped, doubled)
    then = result_fn_hi
    else = result_fn_lo
  }
}
```

**Emitted ContextSpec:**

```typescript
ctx({
  n:                 10,
  msg:               'score',
  doubled:           combine('binaryFnNumber::multiply',    { a: 'n',      b: 'n' }),
  label_hi:          combine('binaryFnString::concat',      { a: 'msg',    b: ' high' }),
  label_lo:          combine('binaryFnString::concat',      { a: 'msg',    b: ' low'  }),
  is_big:            combine('binaryFnNumber::greaterThanOrEqual', { a: 'doubled', b: 'n' }),
  piped:             pipe({ x: 'n' }, [
                       combine('binaryFnNumber::multiply', { a: 'x', b: 'x' }),
                       combine('binaryFnNumber::add',      { a: ref.step('piped', 0), b: 'x' }),
                     ]),
  result_fn_hi:      combine('binaryFnString::concat', { a: 'msg', b: ' !' }),
  result_fn_lo:      combine('binaryFnString::concat', { a: 'msg', b: ' .' }),
  __if_final_cond:   combine('binaryFnNumber::greaterThan', { a: 'piped', b: 'doubled' }),
  final:             cond('__if_final_cond', { then: 'result_fn_hi', else: 'result_fn_lo' }),
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
| E. Pipe emitter | `step_ref`, `func_ref`, `transform` references inside steps |
| F. Cond emitter | condition/branch resolution |
| G. `#if` sugar emitter | Auto-name generation, collision avoidance |
| H. Error paths | All 18 error codes |

### Critical paths

| # | Path | Idempotency check |
|---|------|------------------|
| 1 | Parse `name:arr<int> = [1,2,3]` → emit `val.array('number', [...])` | Re-parse emitted TS, compare AST |
| 2 | `add(v1, v2)` and `add(a: v1, b: v2)` → same `combine('binaryFnNumber::add', { a: 'v1', b: 'v2' })` | Both call forms emit identical ContextSpec |
| 3 | Pipe with `step_ref = 0` → `ref.step(name, 0)` resolved to correct `StepOutputRef` | Round-trip: ContextSpec → `ctx()` → same `ExecutionContext` shape |
| 4 | Forward reference: `result` defined before `flag` (its condition) | Compiler produces identical output regardless of declaration order |
| 5 | `#if` with inline cond → auto-generated `__if_result_cond` in emitted spec | Name is deterministic; does not vary between compilations |
| 6 | `income_ok:bool = income >= min_income`, `debt_ok:bool = debt <= max_debt`, `approval_code:str = prefix + suffix` | Operator forms are the only valid DSL; each lowers to the correct runtime `BinaryFnNames` |

### Edge cases

| Case | Expected behaviour |
|------|--------------------|
| `n:int = 3.0` | `NonIntegerValue` error (fractional part = 0 but is float in HCL) |
| `xs:arr<int> = []` | Emit `val.array('number', [])` — empty array is valid |
| `then = fn` where `fn` is a value binding | `UndefinedFuncRef` error |
| `step_ref = 0` in step 0 (self-reference) | `StepRefOutOfBounds` error |
| Two `prog` blocks in one file | Either `DuplicateProg` error or emit two separate `ctx()` calls — specify behaviour |
| `add(a: v1)` | `InvalidBinaryArgShape` error (`b` missing) |
| `add(a: v1, b: v2, c: v3)` | `InvalidBinaryArgShape` error (extra key) |
| `go:bool = decision && income_ok` | `InvalidInfixExpr` error (unsupported operator token) |
| `go:bool = bool_and(flag_hi, flag_lo)` | `OperatorOnlyFn` error (`bool_and` requires `&` operator) |
| `ok:bool = gte(income, min)` | `OperatorOnlyFn` error (`gte` requires `>=` operator) |
| `label:str = str_concat(a, b)` | `OperatorOnlyFn` error (`str_concat` requires `+` operator) |
| `approval_code:str = prefix ++ suffix` | `InvalidInfixExpr` error (unsupported operator token) |
| `__reserved:int = 1` | `ReservedName` error |
| `eq` with mismatched arg types (`int` vs `str`) | `ArgTypeMismatch` error |
| `cond` condition references a function whose return type is `int` | `CondNotBool` error |

### Manual intervention points

- **Two-`prog` file behaviour**: not yet specified — choose: error or multi-ctx emission.
- **`div` integer safety**: `binaryFnNumber::divide` returns a float; the spec declares `div` as `int → int` but the runtime produces a float value. Consider adding a `div_floor` alias (`div` followed by `transformFnNumber::floor`) or documenting that `:int` on a `div` binding is advisory.
- **Phase 2 activation**: decide whether Phase 2 syntax in a Phase 1 file is a parse error or an `UnsupportedConstruct` warning.

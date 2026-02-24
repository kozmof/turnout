# HCL ContextSpec — Refined Specification

> **Status**: Phase 1 ready for implementation; Phase 2 (loops) requires runtime extension.
> **Target API**: `ctx(spec: ContextSpec): BuildResult<T>` in `src/compute-graph/builder/context.ts`

---

## Overview

A typed-key HCL2 DSL that declares a `ContextSpec` object and passes it to `ctx()`.
The compiler reads a `.hcl` file, validates it, and emits a TypeScript `ContextSpec`.

### Runtime value types

| HCL type     | Runtime symbol | JS primitive | `val.*` builder             |
|--------------|----------------|--------------|-----------------------------|
| `int`        | `'number'`     | `number` (integer) | `val.number(n)` / `n`  |
| `str`        | `'string'`     | `string`     | `val.string(s)` / `s`       |
| `bool`       | `'boolean'`    | `boolean`    | `val.boolean(b)` / `b`      |
| `arr(int)`   | `'array'`      | —            | `val.array('number', [...])`|
| `arr(str)`   | `'array'`      | —            | `val.array('string', [...])`|
| `arr(bool)`  | `'array'`      | —            | `val.array('boolean', [...])`|

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
- `type` is one of: `int | str | bool | arr(int) | arr(str) | arr(bool)`
- The HCL attribute key is literally `"name:type"`; the parser splits on the **first** `:`.

### Examples

```hcl
prog "main" {
  n:int        = 10
  msg:str      = "hello"
  flag:bool    = true
  xs:arr(int)  = [1, 2, 3]
  ys:arr(str)  = ["a", "b", "c"]
  bs:arr(bool) = [true, false, true]
}
```

### Strict parse-time type rules

| Rule | Error |
|------|-------|
| Literal must match declared type | `TypeMismatch` |
| `:int` value must have no fractional part (`42` OK, `3.14` error) | `NonIntegerValue` |
| All elements of `arr(T)` must be of type `T` | `HeterogeneousArray` |
| Nested arrays are not allowed as value literals | `NestedArrayNotAllowed` |
| Same `name` declared twice in the same `prog` | `DuplicateBinding` |

### ContextSpec emission

```typescript
// n:int = 10  →
{ n: 10 }

// xs:arr(int) = [1, 2, 3]  →
{ xs: val.array('number', [val.number(1), val.number(2), val.number(3)]) }
```

---

## 3. Function expressions

All function expressions are encoded as HCL objects (single-key objects at the top level).
There are four forms: **combine**, **pipe**, **cond**, and **if** (sugar for cond).

---

### 3.1 Combine — binary operation

```hcl
name:type = { fn_alias = { a = ref_a, b = ref_b } }
```

The object has exactly one key (the function alias). Its value is an object with exactly two keys: `a` and `b`.

**Example:**

```hcl
prog "main" {
  v1:int = 5
  v2:int = 3

  sum:int  = { add = { a = v1, b = v2 } }
  txt:str  = { str_concat = { a = "edge ", b = "mix" } }
  flag:bool = { gt = { a = v1, b = v2 } }
}
```

**Emitted ContextSpec:**

```typescript
{
  v1:   5,
  v2:   3,
  sum:  combine('binaryFnNumber::add',      { a: 'v1', b: 'v2' }),
  txt:  combine('binaryFnString::concat',   { a: 'edge ', b: 'mix' }),
  flag: combine('binaryFnNumber::greaterThan', { a: 'v1', b: 'v2' }),
}
```

#### Built-in function alias table

| HCL alias      | Runtime `BinaryFnNames`                  | a type    | b type    | return type |
|----------------|------------------------------------------|-----------|-----------|-------------|
| `add`          | `binaryFnNumber::add`                    | `int`     | `int`     | `int`       |
| `sub`          | `binaryFnNumber::minus`                  | `int`     | `int`     | `int`       |
| `mul`          | `binaryFnNumber::multiply`               | `int`     | `int`     | `int`       |
| `div`          | `binaryFnNumber::divide`                 | `int`     | `int`     | `int`       |
| `mod`          | `binaryFnNumber::mod`                    | `int`     | `int`     | `int`       |
| `max`          | `binaryFnNumber::max`                    | `int`     | `int`     | `int`       |
| `min`          | `binaryFnNumber::min`                    | `int`     | `int`     | `int`       |
| `gt`           | `binaryFnNumber::greaterThan`            | `int`     | `int`     | `bool`      |
| `gte`          | `binaryFnNumber::greaterThanOrEqual`     | `int`     | `int`     | `bool`      |
| `lt`           | `binaryFnNumber::lessThan`               | `int`     | `int`     | `bool`      |
| `lte`          | `binaryFnNumber::lessThanOrEqual`        | `int`     | `int`     | `bool`      |
| `str_concat`   | `binaryFnString::concat`                 | `str`     | `str`     | `str`       |
| `str_includes` | `binaryFnString::includes`               | `str`     | `str`     | `bool`      |
| `str_starts`   | `binaryFnString::startsWith`             | `str`     | `str`     | `bool`      |
| `str_ends`     | `binaryFnString::endsWith`               | `str`     | `str`     | `bool`      |
| `bool_and`     | `binaryFnBoolean::and`                   | `bool`    | `bool`    | `bool`      |
| `bool_or`      | `binaryFnBoolean::or`                    | `bool`    | `bool`    | `bool`      |
| `bool_xor`     | `binaryFnBoolean::xor`                   | `bool`    | `bool`    | `bool`      |
| `eq`           | `binaryFnGeneric::isEqual`               | any       | any (same)| `bool`      |
| `neq`          | `binaryFnGeneric::isNotEqual`            | any       | any (same)| `bool`      |
| `arr_includes` | `binaryFnArray::includes`                | `arr(T)`  | `T`       | `bool`      |
| `arr_get`      | `binaryFnArray::get`                     | `arr(T)`  | `int`     | `T`         |
| `arr_concat`   | `binaryFnArray::concat`                  | `arr(T)`  | `arr(T)`  | `arr(T)`    |

> **Parse-time checks**: the inferred return type of the function alias must match the binding's declared type. Argument value types must match the function's expected parameter types.

---

### 3.2 Pipe — sequential steps

```hcl
name:type = {
  pipe = {
    args  = { param_name = value_binding_key, ... }
    steps = [
      { fn_alias = { a = ref_a, b = ref_b } },
      ...
    ]
  }
}
```

**Example:**

```hcl
prog "main" {
  v1:int = 5
  v2:int = 3

  result:int = {
    pipe = {
      args  = { x = v1, y = v2 }
      steps = [
        { add = { a = x,              b = y } },
        { mul = { a = { step_ref = 0 }, b = x } }
      ]
    }
  }
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

- `args` keys become pipe parameter names; values must be **value** binding names (not function bindings).
- Each entry in `steps` is a combine expression using the same alias table as §3.1.
- Inside `steps`, argument references may be:
  - A pipe parameter name (from `args`)
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

  flag:bool  = { gt = { a = v1, b = v2 } }
  addFn:int  = { add = { a = v1, b = v2 } }
  subFn:int  = { sub = { a = v1, b = v2 } }

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
- `then` and `else` must be **function** binding names (combine/pipe/cond/if).
- Both branches must have the same resolved return type, which must match the binding's declared type.

---

### 3.4 `if` — syntactic sugar for `cond`

`if` extends `cond` by allowing the condition to be an **inline combine expression** instead of a bare binding name. When inlined, the compiler auto-generates a hidden condition binding named `__if_<name>_cond`.

```hcl
name:type = {
  if = {
    cond = { fn_alias = { a = ref_a, b = ref_b } }   # inline expression
    then = fn_binding_name
    else = fn_binding_name
  }
}
```

`cond` may also be a bare binding name (identical to the `cond` form):

```hcl
name:type = {
  if = {
    cond = existing_bool_binding
    then = fn_binding_name
    else = fn_binding_name
  }
}
```

**Example — inline condition:**

```hcl
prog "main" {
  v1:int = 10
  v2:int = 3

  addFn:int = { add = { a = v1, b = v2 } }
  subFn:int = { sub = { a = v1, b = v2 } }

  result:int = {
    if = {
      cond = { gt = { a = v1, b = v2 } }
      then = addFn
      else = subFn
    }
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
| Bare identifier in `cond.then`/`cond.else` | `'fn_name'` (`FuncRef` string) | cond/if |
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
| `HeterogeneousArray` | Mixed element types in `arr(T)` literal |
| `NestedArrayLiteral` | Array literal contains a sub-array in a value binding |
| `DuplicateBinding` | Same `name` declared twice in one `prog` |
| `ReservedName` | User binding name starts with `__` |
| `UnknownFnAlias` | Function alias not in the built-in table |
| `UndefinedRef` | Bare identifier references an unknown binding |
| `UndefinedFuncRef` | `func_ref`/`then`/`else` references a non-function binding |
| `ArgTypeMismatch` | Argument value type does not match the function's expected parameter type |
| `ReturnTypeMismatch` | Function alias return type does not match binding's declared type |
| `CondNotBool` | `condition` binding does not resolve to `bool` |
| `BranchTypeMismatch` | `then` and `else` return types differ |
| `StepRefOutOfBounds` | `step_ref = N` where N ≥ current step index |
| `CrossPipeStepRef` | `step_ref` inside a pipe references a different pipe's step |
| `PipeArgNotValue` | `args` entry references a function binding (must be value) |

---

## 6. Phase 2 — Loop constructs (runtime extension required)

The following constructs are syntactically reserved. They cannot be compiled to the current ContextSpec without adding new builder types, because:

1. `range(n)` is a **unary** operation — the current binary function model requires two arguments.
2. `map`, `filter`, `fold` take a **function reference** as an argument — `AnyValue` cannot hold a `FuncRef` in the current value type system.

### Reserved syntax (Phase 2)

```hcl
# range — produces [0, 1, ..., n-1]
xs:arr(int) = { range = { n = count } }

# map — applies fn to each element
ys:arr(int) = {
  map = {
    xs = source_arr
    fn = step_fn_name
  }
}

# filter — keeps elements where predicate returns true
zs:arr(int) = {
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
| `RangeBuilder`  | `{ __type: 'range'; count: ValueRef }` | Produces `arr(int)` |
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
  doubled:int = { mul = { a = n, b = n } }

  # --- String ---
  label_hi:str = { str_concat = { a = msg, b = " high" } }
  label_lo:str = { str_concat = { a = msg, b = " low"  } }

  # --- Condition via combine ---
  is_big:bool = { gt = { a = doubled, b = n } }

  # --- Pipe: (n * n) + n ---
  piped:int = {
    pipe = {
      args  = { x = n }
      steps = [
        { mul = { a = x, b = x } },
        { add = { a = { step_ref = 0 }, b = x } }
      ]
    }
  }

  # --- if (inline condition) ---
  result_fn_hi:str = { str_concat = { a = msg, b = " !" } }
  result_fn_lo:str = { str_concat = { a = msg, b = " ." } }

  final:str = {
    if = {
      cond = { gt = { a = piped, b = doubled } }
      then = result_fn_hi
      else = result_fn_lo
    }
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
  is_big:            combine('binaryFnNumber::greaterThan', { a: 'doubled', b: 'n' }),
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
| G. `if` sugar emitter | Auto-name generation, collision avoidance |
| H. Error paths | All 17 error codes |

### Critical paths

| # | Path | Idempotency check |
|---|------|------------------|
| 1 | Parse `name:arr(int) = [1,2,3]` → emit `val.array('number', [...])` | Re-parse emitted TS, compare AST |
| 2 | `{ add = { a = v1, b = v2 } }` → `combine('binaryFnNumber::add', { a: 'v1', b: 'v2' })` | Same ContextSpec for same HCL input |
| 3 | Pipe with `step_ref = 0` → `ref.step(name, 0)` resolved to correct `StepOutputRef` | Round-trip: ContextSpec → `ctx()` → same `ExecutionContext` shape |
| 4 | Forward reference: `result` defined before `flag` (its condition) | Compiler produces identical output regardless of declaration order |
| 5 | `if` with inline cond → auto-generated `__if_result_cond` in emitted spec | Name is deterministic; does not vary between compilations |

### Edge cases

| Case | Expected behaviour |
|------|--------------------|
| `n:int = 3.0` | `NonIntegerValue` error (fractional part = 0 but is float in HCL) |
| `xs:arr(int) = []` | Emit `val.array('number', [])` — empty array is valid |
| `then = fn` where `fn` is a value binding | `UndefinedFuncRef` error |
| `step_ref = 0` in step 0 (self-reference) | `StepRefOutOfBounds` error |
| Two `prog` blocks in one file | Either `DuplicateProg` error or emit two separate `ctx()` calls — specify behaviour |
| `__reserved:int = 1` | `ReservedName` error |
| `eq` with mismatched arg types (`int` vs `str`) | `ArgTypeMismatch` error |
| `cond` condition references a function whose return type is `int` | `CondNotBool` error |

### Manual intervention points

- **Two-`prog` file behaviour**: not yet specified — choose: error or multi-ctx emission.
- **`div` integer safety**: `binaryFnNumber::divide` returns a float; the spec declares `div` as `int → int` but the runtime produces a float value. Consider adding a `div_floor` alias (`div` followed by `transformFnNumber::floor`) or documenting that `:int` on a `div` binding is advisory.
- **Phase 2 activation**: decide whether Phase 2 syntax in a Phase 1 file is a parse error or a `UnsupportedConstruct` warning.

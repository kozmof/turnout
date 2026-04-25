# TransformFn DSL Method-Call Specification

> **Status**: Draft for implementation
> **Scope**: DSL surface syntax for invoking `transformFn` operations as method calls on typed values (e.g. `income.toStr()`)

---

## Overview

`transformFn` operations are unary functions that take a single typed value and return a (possibly different typed) value. In the DSL, they are expressed as method calls on the receiver value.

```
income.toStr()          // number → string
name.trim().toUpperCase()   // string → string → string
score.abs().toStr()     // number → number → string
```

`pass` is an internal identity function used by the runtime. It is not part of the DSL surface syntax.

For multi-step local expression chains, authors should use `#pipe(initial, step, ...)` from `pipe-if-case-it.md`. Inside a `#pipe` step, `#it` names the current pipeline value; `_` is not a transform placeholder.

---

## Available Methods per Type

| Receiver type | DSL methods |
|---|---|
| `number` | `.toStr()`, `.abs()`, `.floor()`, `.ceil()`, `.round()`, `.negate()` |
| `string` | `.toNumber()`, `.trim()`, `.toLowerCase()`, `.toUpperCase()`, `.length()` |
| `boolean` | `.not()`, `.toStr()` |
| `array` | `.length()`, `.isEmpty()` |
| `null` | *(none)* |

---

## CAN (OK)

- A DSL author can call any method listed in the table above on a receiver of the matching type.
- A method call can be applied to any expression that resolves to a typed value — a field name, a literal, or the result of a prior expression.
- Method calls can be chained: `income.toStr().toUpperCase()`. Each step is valid as long as the previous step's output type supports the next method.
- `.toStr()` can be called on both `number` and `boolean` receivers, converting them to their string representation.
- `.length()` can be called on both `string` (returns character count) and `array` (returns element count) receivers.
- Tags on the receiver value are preserved on the returned value.

---

## CAN'T (NG)

- `pass` cannot be used in DSL method-call syntax. It is an internal runtime function and must not be exposed to authors.
- A method defined for one type cannot be called on a receiver of a different type. Cross-type calls are forbidden:
  ```
  income.trim()         // NG: income is number; trim is string-only
  isActive.abs()        // NG: isActive is boolean; abs is number-only
  name.floor()          // NG: name is string; floor is number-only
  ```
  This is the direct counterpart of the CAN rule: each method is exclusively permitted on its declared type.
- `null` receivers cannot call any DSL method. There are no DSL-visible conversions for `null`.
- No arguments may be passed to these method calls. All `transformFn` operations are strictly unary:
  ```
  income.round(2)       // NG: round takes no arguments
  ```
- A chain step is invalid if its method is not defined for the output type of the preceding step:
  ```
  income.toStr().round()   // NG: round is number-only; toStr() produced a string
  ```
  This is the direct counterpart of the chaining CAN rule: chaining is only valid when the intermediate type supports the next method.
- `.toNumber()` on `string` does not guarantee a valid number. Non-numeric strings produce `NaN`. The DSL must not implicitly validate or coerce the parse result. Authors are responsible for ensuring the string is numeric before calling `.toNumber()`.
- `transformFn` methods cannot accept a second argument. Combining two values requires a `binaryFn` (`combineFunc`), not a `transformFn` method call:
  ```
  a.add(b)   // NG: binary operations are not expressed as transformFn method calls
  ```

---

## Correlation Between CAN and CAN'T

- Because each method is bound to a single receiver type (CAN), cross-type calls are statically forbidden (CAN'T). The type table is exhaustive; any method not listed for a type is invalid on that type.
- Because chaining is valid only when intermediate types match (CAN), a chain that crosses a type boundary where the next method is undefined is always invalid (CAN'T).
- Because `pass` is excluded from DSL (CAN'T), the set of DSL-visible methods for each type is strictly a subset of the runtime `transformFn` implementations. Authors cannot observe or rely on the identity no-op.

---

## Resolved Decisions

| # | Decision | Resolution |
|---|----------|------------|
| 1 | `pass` in DSL | **Excluded**: `pass` is an internal runtime function only; not surfaced in DSL method syntax. |
| 2 | `null` methods | **None**: no DSL-visible `transformFn` methods are defined for `null`. |
| 3 | Method arguments | **Forbidden**: all `transformFn` methods are unary; the DSL syntax accepts no argument list. |
| 4 | `string.toNumber()` on non-numeric input | **Caller responsibility**: produces `NaN`; the DSL does not validate or coerce. |

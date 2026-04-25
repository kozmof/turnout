# Turnout Draft Spec: `#if`, `#case`, `#pipe`, and `#it`

## Status

This document is a **draft proposal** for local expression forms inside Turnout compute graphs.

It defines four related forms:

* `#if` — binary conditional expression
* `#case` — ordered pattern-match expression
* `#pipe` — left-to-right transformation chain
* `#it` — current pipeline value within a `#pipe` step

This draft is intentionally small.
Its goal is to improve readability of local decision logic without expanding Turnout into a general-purpose programming language.

---

## 1. Design goals

These forms are intended to support the most common local logic patterns in Turnout actions:

* small binary choice,
* explicit multi-branch classification,
* linear transformation and normalization chains,
* readable policy-like expressions.

The design aims to preserve these properties:

* deterministic evaluation,
* explicit and authored logic,
* compact but readable syntax,
* minimal overload of symbols,
* clear distinction between matching and placeholder semantics.

---

## 2. Summary

## 2.1 `#if`

`#if` selects between two expressions.

```turn id="99065p"
#if(cond, then_expr, else_expr)
```

## 2.2 `#case`

`#case` matches a subject value against ordered arms.

```turn id="lp2x0v"
#case(
  subject,
  pattern1 => expr1,
  pattern2 => expr2,
  _ => default_expr
)
```

## 2.3 `#pipe`

`#pipe` applies a sequence of steps left to right.

```turn id="mhm7wz"
#pipe(
  initial_value,
  step1,
  step2,
  step3
)
```

## 2.4 `#it`

`#it` denotes the current pipeline value within a step of `#pipe`.

```turn id="yhvj2h"
#pipe(
  x,
  round(#it, 1),
  clamp(0, 100, #it)
)
```

---

## 3. Reserved meanings

Within these local expression forms, these tokens have distinct roles:

* `_` is reserved for **wildcard matching** in `#case` patterns.
* `#it` is reserved for **current pipeline value** inside `#pipe` steps.

This draft intentionally does **not** assign `_` any placeholder meaning in pipe expressions.

---

## 4. `#if`

## 4.1 Purpose

`#if` is the simplest conditional form.
It is intended for short binary decisions.

## 4.2 Syntax

```turn id="34qcgo"
#if(cond, then_expr, else_expr)
```

## 4.3 Semantics

1. Evaluate `cond`.
2. If `cond` evaluates to `true`, evaluate and return `then_expr`.
3. Otherwise, evaluate and return `else_expr`.

Only the selected branch is evaluated.

## 4.4 Examples

```turn id="bs4xj4"
status:str = #if(temp_c < 28, "warmup", "run")
```

```turn id="e9kfqk"
needs_hold:bool = #if(sample_passed, false, true)
```

## 4.5 Guidance

Use `#if` when:

* there are only two outcomes,
* the condition is short,
* nesting does not become the dominant visual structure.

When three or more outcomes are present, `#case` is usually preferred.

---

## 5. `#case`

## 5.1 Purpose

`#case` is an ordered classification form.
It is intended for:

* multi-branch routing,
* reason-code derivation,
* tuple-based policy rules,
* threshold banding with guards.

## 5.2 Syntax

```turn id="u39u5m"
#case(
  subject,
  pattern1 => expr1,
  pattern2 => expr2,
  _ => default_expr
)
```

Arms are evaluated from top to bottom.

## 5.3 Semantics

1. Evaluate `subject`.
2. Test each arm in declaration order.
3. The first arm whose pattern matches, and whose guard passes if present, is selected.
4. Evaluate and return that arm’s expression.
5. If no arm matches:

   * if a wildcard `_` arm exists, use it,
   * otherwise evaluation fails.

## 5.4 Pattern forms in v1

This draft supports the following patterns:

* literal patterns
* wildcard `_`
* variable binders
* tuple patterns
* guarded arms

### Literal pattern

Matches by value equality.

```turn id="xtbnjn"
"run"
42
true
```

### Wildcard pattern

`_` matches any value and does not bind.

```turn id="gyjocr"
_ => "default"
```

### Variable binder

A variable binder matches any value and binds it for use in the arm’s guard or expression.

```turn id="mu39bf"
x => x
```

### Tuple pattern

Tuple patterns match tuples structurally.

```turn id="n9mw4q"
(true, _)
(false, t)
```

### Guard

A guard further filters a structurally matched arm.

```turn id="gevv47"
x if x > 10 => "large"
```

The guard is evaluated only after the pattern has matched.

## 5.5 Examples

### Single subject

```turn id="8yprjc"
band:str = #case(
  vibration_mm_s,
  x if x >= 11 => "severe",
  x if x >= 7 => "elevated",
  _ => "normal"
)
```

### Tuple match

```turn id="6zibde"
route:str = #case(
  (unsafe, spindle_temp_c),
  (true, _) => "lockout",
  (false, t) if t < 28 => "warmup",
  _ => "run"
)
```

### Reason-code derivation

```turn id="3t4ghf"
reason:str = #case(
  (active_alarm, lube_pressure_ok, door_closed, spindle_temp_c),
  (true, _, _, _) => "active_alarm",
  (false, false, _, _) => "lube_pressure",
  (false, true, false, _) => "door_open",
  (false, true, true, t) if t < 28 => "spindle_cold",
  _ => "ready"
)
```

## 5.6 Scope

A variable bound in a pattern is visible only within:

* that arm’s guard,
* that arm’s expression.

It is not visible outside the arm.

## 5.7 Restrictions in v1

This draft does not include:

* object destructuring,
* OR-patterns,
* nested alternation patterns,
* exhaustiveness checking beyond runtime failure,
* side effects within arms.

---

## 6. `#pipe`

## 6.1 Purpose

`#pipe` expresses a linear transformation chain.

It is intended for:

* normalization,
* cleanup,
* banding,
* staged reduction,
* compact transform → classify flows.

## 6.2 Syntax

```turn id="ltqfx9"
#pipe(
  initial_value,
  step1,
  step2,
  step3
)
```

Each step is an expression template that may refer to `#it`.

## 6.3 Semantics

1. Evaluate `initial_value`.
2. Let the result be the current pipeline value.
3. For each step in order:

   * evaluate the step with `#it` bound to the current pipeline value,
   * the step result becomes the new current pipeline value.
4. Return the final current pipeline value.

## 6.4 `#it`

Within a `#pipe` step, `#it` denotes the current pipeline value.

Example:

```turn id="xn4d6f"
#pipe(
  raw_width_mm,
  round(#it, 1),
  clamp(0, 5000, #it),
  between(spec_width_min, spec_width_max, #it)
)
```

## 6.5 Validity of `#it`

`#it` is valid only inside a step of `#pipe`.

Using `#it` outside `#pipe` is an error.

## 6.6 Examples

### Numeric normalization

```turn id="as0m94"
width_mm:number = #pipe(
  raw_width_mm,
  round(#it, 1),
  clamp(0, 5000, #it)
)
```

### Classification pipeline

```turn id="ucxnd9"
band:str = #pipe(
  vibration_mm_s,
  round(#it, 1),
  #case(
    #it,
    x if x >= 11 => "severe",
    x if x >= 7 => "elevated",
    _ => "normal"
  )
)
```

### Full routing pipeline

```turn id="6h06j1"
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
```

## 6.7 Guidance

Use `#pipe` when:

* logic is naturally left-to-right,
* each step conceptually transforms one value into another,
* intermediate names are not needed for clarity.

Do not force `#pipe` into cases where named intermediate bindings are clearer.

For example, this may be clearer than a pipe:

```turn id="yb6zdb"
rounded_width:number = round(raw_width_mm, 1)
clamped_width:number = clamp(0, 5000, rounded_width)
width_ok:bool = between(spec_width_min, spec_width_max, clamped_width)
```

---

## 7. Composition

These forms are designed to compose.

## 7.1 `#pipe` with `#case`

```turn id="831g0m"
status:str = #pipe(
  raw_temp_c,
  round(#it, 1),
  #case(
    #it,
    t if t < 28 => "warmup",
    t if t > 90 => "hold",
    _ => "run"
  )
)
```

## 7.2 `#case` arm expressions using `#if`

```turn id="sbp4zm"
result:str = #case(
  severity,
  "high" => #if(manual_override, "review", "stop"),
  "medium" => "inspect",
  _ => "monitor"
)
```

## 7.3 `#if` inside `#pipe`

```turn id="vyfc46"
temp_state:str = #pipe(
  raw_temp_c,
  round(#it, 1),
  #if(#it < 28, "cold", "ok")
)
```

This is valid, but if the logic becomes multi-branch, `#case` is preferred.

---

## 8. Evaluation properties

These forms are intended to remain expression-pure.

### 8.1 Purity

This draft assumes:

* `#if`, `#case`, and `#pipe` do not introduce side effects by themselves,
* their role is expression evaluation only.

### 8.2 Determinism

All evaluation order is explicit:

* `#if` chooses exactly one branch,
* `#case` checks arms in declaration order,
* `#pipe` evaluates steps in declaration order.

This aligns with Turnout’s broader preference for deterministic authored execution.

---

## 9. Style guidance

## 9.1 Use `#if` for small binary choice

Good:

```turn id="ovzz2v"
status:str = #if(temp_c < 28, "warmup", "run")
```

## 9.2 Use `#case` for classification

Good:

```turn id="mwzxpp"
route:str = #case(
  (fault, quality_ok),
  (true, _) => "hold_engineering",
  (false, false) => "hold_quality",
  _ => "release"
)
```

## 9.3 Use `#pipe` for linear staged transforms

Good:

```turn id="ch20gt"
band:str = #pipe(
  vibration_mm_s,
  round(#it, 1),
  #case(
    #it,
    x if x >= 11 => "severe",
    x if x >= 7 => "elevated",
    _ => "normal"
  )
)
```

## 9.4 Avoid overusing `#pipe`

Prefer named intermediates when they improve readability.

---

## 10. Industrial example

This example shows all three forms together.

```hcl id="hsy06y"
scene "boiler_alarm_priority" {
  entry_actions = ["classify_alarm"]

  action "classify_alarm" {
    compute {
      root = classified

      prog "classify_alarm_graph" {
        ~>pressure_bar:number
        ~>water_level_low:bool
        ~>flame_failure:bool
        ~>repeat_trips:number

        pressure_band:str = #pipe(
          pressure_bar,
          round(#it, 1),
          #case(
            #it,
            p if p >= 18 => "high",
            _ => "normal"
          )
        )

        alarm_route:str = #case(
          (water_level_low, flame_failure, repeat_trips, pressure_band),
          (true, _, _, _) => "emergency_shutdown",
          (_, true, _, _) => "emergency_shutdown",
          (_, _, r, _) if r >= 2 => "maintenance_intervention",
          (_, _, _, "high") => "maintenance_intervention",
          _ => "watch"
        )

        <~alarm_route:str = alarm_route
        classified:bool = true
      }
    }

    prepare {
      pressure_bar    { from_state = boiler.telemetry.pressure_bar }
      water_level_low { from_state = boiler.safety.water_level_low }
      flame_failure   { from_state = boiler.safety.flame_failure }
      repeat_trips    { from_state = boiler.history.repeat_trips_24h }
    }

    merge {
      alarm_route { to_state = boiler.response.route }
    }
  }
}
```

---

## 11. Grammar sketch

This is a draft grammar sketch only.

```ebnf id="hsqadg"
IfExpr        = "#if" "(" Expr "," Expr "," Expr ")" ;

CaseExpr      = "#case" "(" Expr "," CaseArm { "," CaseArm } ")" ;
CaseArm       = Pattern [ Guard ] "=>" Expr ;
Guard         = "if" Expr ;

Pattern       = "_"
              | Literal
              | Identifier
              | TuplePattern ;

TuplePattern  = "(" Pattern { "," Pattern } ")" ;

PipeExpr      = "#pipe" "(" Expr "," PipeStep { "," PipeStep } ")" ;
PipeStep      = Expr ;

PipeItExpr    = "#it" ;
```

Notes:

* `#it` is semantically constrained even if the grammar permits it as an expression token.
* Whether identifiers in patterns are syntactically distinguished from value references is left to the final parser/type design.

---

## 12. Non-goals for this draft

This draft does not define:

* object or map destructuring,
* user-defined pattern constructors,
* partial application syntax beyond `#pipe`,
* anonymous functions,
* advanced exhaustiveness analysis,
* effectful semantics inside these expressions.

---

## 13. Recommended interpretation

A concise interpretation is:

* `#if` handles **small binary choice**
* `#case` handles **ordered classification**
* `#pipe` handles **linear transformation**
* `#it` names **the current pipeline value**
* `_` is reserved for **wildcard matching in local expressions**

This division keeps the local language compact, readable, and semantically clear.

---

## 14. Short example set

### `#if`

```turn id="8bmc2l"
status:str = #if(temp_c < 28, "warmup", "run")
```

### `#case`

```turn id="s6v7pw"
route:str = #case(
  (unsafe, spindle_temp_c),
  (true, _) => "lockout",
  (false, t) if t < 28 => "warmup",
  _ => "run"
)
```

### `#pipe`

```turn id="wvub3a"
width_ok:bool = #pipe(
  raw_width_mm,
  round(#it, 1),
  clamp(0, 5000, #it),
  between(spec_width_min, spec_width_max, #it)
)
```

### Combined

```turn id="6075jv"
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
```

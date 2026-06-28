# Turnout Draft Spec: `#if`, `#case`, `#pipe`, and `#it`

## Status

This document is a draft proposal for local expression forms inside Turnout compute graphs.

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
  #it + 1,
  #it * 2
)
```

---

## 3. Reserved meanings

Within these local expression forms, these tokens have distinct roles:

* `_` is reserved for wildcard matching in `#case` patterns.
* `#it` is reserved for current pipeline value inside `#pipe` steps.

This draft intentionally does not assign `_` any placeholder meaning in pipe expressions.

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

### Guard

A guard further filters a structurally matched arm.

```turn id="gevv47"
x if x > 10 => "large"
```

The guard is evaluated only after the pattern has matched.

## 5.5 Future draft: tuple patterns

Tuple patterns are a proposed extension for matching multiple subject values structurally. They are not part of the implemented v1 parser.

```turn id="future-tuple-case"
route:str = #case(
  (unsafe, spindle_temp_c),
  (true, _) => "lockout",
  (false, t) if t < 28 => "warmup",
  _ => "run"
)
```

Proposed semantics:

* The subject expression may evaluate to a tuple with fixed arity.
* A tuple pattern matches only when it has the same arity as the subject tuple and every element pattern matches.
* Literal patterns, wildcard `_`, and variable binders keep their scalar meanings inside tuple patterns.
* Guards run only after the tuple pattern has matched and may reference tuple binders.

## 5.6 Examples

### Single subject

```turn id="8yprjc"
band:str = #case(
  vibration_mm_s,
  x if x >= 11 => "severe",
  x if x >= 7 => "elevated",
  _ => "normal"
)
```

### Reason-code derivation

```turn id="3t4ghf"
reason:str = #if(
  active_alarm,
  "active_alarm",
  #case(
    lube_pressure_ok,
    false => "lube_pressure",
    _ => #case(
      door_closed,
      false => "door_open",
      _ => #case(
        spindle_temp_c,
        t if t < 28 => "spindle_cold",
        _ => "ready"
      )
    )
  )
)
```

## 5.7 Scope

A variable bound in a pattern is visible only within:

* that arm’s guard,
* that arm’s expression.

It is not visible outside the arm.

## 5.8 Restrictions in v1

This draft does not include:

* tuple patterns (future draft only),
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
  #it + 0,
  #it < spec_width_max
)
```

## 6.5 Validity of `#it`

`#it` is valid only inside a step of `#pipe`.

Using `#it` outside `#pipe` is an error.

## 6.6 Future Draft: Method-Call Steps

Method-call steps are a proposed extension for applying transform-style operations directly to any local expression, including `#it`. They are not part of the implemented v1 parser.

```turn id="future-pipe-method-chain"
width_mm:number = #pipe(
  raw_width_mm,
  #it.round().clamp(0, 5000)
)
```

Proposed syntax:

```turn id="future-method-call-syntax"
receiver.method()
receiver.method(arg1, arg2)
receiver.method1().method2(arg)
```

Proposed semantics:

* The receiver is any local expression, not only a binding identifier. Examples: `#it.round()`, `(width + margin).floor()`, and `name.trim().toUpperCase()`.
* Methods are evaluated left to right. The output of each method becomes the receiver for the next method in the chain.
* Zero-argument methods map to existing unary `transformFn` operations where possible, such as `.round()`, `.floor()`, `.trim()`, and `.not()`.
* Argument-taking methods such as `.clamp(min, max)` are future local-expression calls. They require either new transform functions with parameters or lowering to equivalent binary/local expression forms.
* `#it` keeps its existing meaning. Inside a `#pipe` step, it is the current pipeline value. Method calls do not introduce a second placeholder.
* Type checking is staged after each method call. A method can be called only when it is defined for the receiver type produced by the prior stage.
* Method calls are pure and deterministic. They do not read or write STATE, hooks, or action bindings other than their explicit receiver and arguments.

Proposed examples:

```turn id="future-pipe-method-examples"
normalized:str = #pipe(
  raw_label,
  #it.trim().toLowerCase()
)

safe_width:number = #pipe(
  raw_width_mm,
  #it.round().clamp(spec_width_min, spec_width_max)
)

route:str = #pipe(
  raw_temp_c,
  #it.round(),
  #case(
    #it,
    t if t < 28 => "warmup",
    t if t > 90 => "hold",
    _ => "run"
  )
)
```

Open design constraints for this future draft:

* Decide whether method names share the existing `transformFn` namespace, the binary/local function namespace, or a dedicated method namespace.
* Decide how argument-taking methods such as `.clamp(min, max)` are represented in canonical HCL and the runtime schema.
* Decide whether method calls are allowed on all parenthesized expressions or only on primary expressions.
* Preserve the current v1 rule that `_` is not a pipe placeholder.

## 6.7 Examples

### Numeric normalization

```turn id="as0m94"
width_mm:number = #pipe(
  raw_width_mm,
  #it + 0,
  #it * 1
)
```

### Classification pipeline

```turn id="ucxnd9"
band:str = #pipe(
  vibration_mm_s,
  #it + 0,
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
  #it + 0,
  #case(
    #it,
    t if t < 28 => "warmup",
    t if t > 90 => "hold",
    _ => "run"
  )
)
```

## 6.8 Guidance

Use `#pipe` when:

* logic is naturally left-to-right,
* each step conceptually transforms one value into another,
* intermediate names are not needed for clarity.

Do not force `#pipe` into cases where named intermediate bindings are clearer.

For example, this may be clearer than a pipe:

```turn id="yb6zdb"
normalized_width:number = raw_width_mm + 0
width_ok:bool = normalized_width < spec_width_max
```

---

## 7. Composition

These forms are designed to compose.

## 7.1 `#pipe` with `#case`

```turn id="831g0m"
status:str = #pipe(
  raw_temp_c,
  #it + 0,
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
  #it + 0,
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
route:str = #if(
  fault,
  "hold_engineering",
  #case(quality_ok, false => "hold_quality", _ => "release")
)
```

## 9.3 Use `#pipe` for linear staged transforms

Good:

```turn id="ch20gt"
band:str = #pipe(
  vibration_mm_s,
  #it + 0,
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

      prog "classify_alarm_graph" {
        ~>pressure_bar:number
        ~>water_level_low:bool
        ~>flame_failure:bool
        ~>repeat_trips:number

        pressure_band:str = #pipe(
          pressure_bar,
          #it + 0,
          #case(
            #it,
            p if p >= 18 => "high",
            _ => "normal"
          )
        )

        alarm_route:str = #if(
          water_level_low,
          "emergency_shutdown",
          #if(
            flame_failure,
            "emergency_shutdown",
            #case(
              repeat_trips,
              r if r >= 2 => "maintenance_intervention",
              _ => #case(pressure_band, "high" => "maintenance_intervention", _ => "watch")
            )
          )
        )

        <~alarm_route:str = alarm_route
        |^| classified:bool = true
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
              | Identifier ;

(* Future draft, not v1: *)
FuturePattern = Pattern
              | TuplePattern ;
TuplePattern  = "(" Pattern { "," Pattern } ")" ;

PipeExpr      = "#pipe" "(" Expr "," PipeStep { "," PipeStep } ")" ;
PipeStep      = Expr ;

PipeItExpr    = "#it" ;

(* Future draft, not v1: *)
MethodCallExpr = Expr "." Identifier "(" [ Expr { "," Expr } ] ")" ;
```

Notes:

* `#it` is semantically constrained even if the grammar permits it as an expression token.
* `MethodCallExpr` is future syntax only. The implemented v1 parser does not accept method calls on `#it` or arbitrary local expressions.
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

* `#if` handles small binary choice
* `#case` handles ordered classification
* `#pipe` handles linear transformation
* `#it` names the current pipeline value
* `_` is reserved for wildcard matching in local expressions

This division keeps the local language compact, readable, and semantically clear.

---

## 14. Short example set

### `#if`

```turn id="8bmc2l"
status:str = #if(temp_c < 28, "warmup", "run")
```

### `#case`

```turn id="s6v7pw"
route:str = #if(
  unsafe,
  "lockout",
  #case(spindle_temp_c, t if t < 28 => "warmup", _ => "run")
)
```

### `#pipe`

```turn id="wvub3a"
width_ok:bool = #pipe(
  raw_width_mm,
  #it + 0,
  #it < spec_width_max
)
```

### Combined

```turn id="6075jv"
route:str = #pipe(
  raw_temp_c,
  #it + 0,
  #case(
    #it,
    t if t < 28 => "warmup",
    t if t > 90 => "hold",
    _ => "run"
  )
)
```

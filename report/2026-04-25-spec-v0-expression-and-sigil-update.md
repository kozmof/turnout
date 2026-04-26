# Specification Update: v1 Local Expressions and Sigil Inputs

**Date:** 2026-04-25

---

## Summary

The specification set was updated to make the v1 Turnout DSL stricter and clearer around local expressions and STATE-connected bindings.

The main change is a clean separation of meanings:

- `_` is now reserved for wildcard matching in `#case` patterns.
- `#it` is the current-value placeholder inside `#pipe` steps.
- `~>` and `<~>` input declarations no longer use `= _` or any right-hand side.

This removes the previous ambiguity where `_` could look like both a wildcard and a placeholder/default marker.

---

## Expression Forms

The v1 local expression surface now centers on:

```turn
#if(cond, then_expr, else_expr)
```

```turn
#case(
  subject,
  pattern => expr,
  _ => default_expr
)
```

```turn
#pipe(
  initial_value,
  step_using_#it,
  next_step_using_#it
)
```

The specs treat non-v1 forms as unsupported.

---

## Sigil Input Syntax

Input and bidirectional sigils are declarations only:

```turn
~>income:number
<~>reviewer_decision:str
```

Output sigils still carry expressions:

```turn
<~decision:bool = income_ok & debt_ok
```

The old syntax:

```turn
~>income:number = _
```

was removed across specs and examples because the right-hand side was redundant and conflicted with `_` as a `#case` wildcard.

---

## Files Updated

- `spec/pipe-if-case-it.md`
- `spec/hcl-context-spec.md`
- `spec/effect-dsl-spec.md`
- `spec/convert-runtime-spec.md`
- `spec/scene-graph.md`
- `spec/state-shape-spec.md`
- `spec/hook-spec.md`
- `spec/transform-fn-dsl-spec.md`
- `spec/examples/*.turn`

The customer onboarding example now uses `#case` to derive `risk_tier` directly, then routes by comparing the derived tier in transition compute blocks.

---

## Implementation Implications

Parsers should treat `~>name:type` and `<~>name:type` as complete declarations with no expression RHS.

The tokenizer/parser should reject `_` outside `#case` patterns. In particular, `name:type = _` and `~>name:type = _` should be invalid.

`#it` should be valid only inside `#pipe` steps.

The converter should reject non-v1 expression shapes rather than normalize them.

---

## Verification

The spec directory was scanned for remaining old sigil assignment syntax and dummy placeholder usage.

No `~>` or `<~>` declarations with `=` remain. The only remaining `= _` occurrence is the intentional invalid example in the HCL context spec error table.

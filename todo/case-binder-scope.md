# Scalar `case` leaks its binders into the enclosing prog

> Status: fixed 2026-09-04
> Origin: hit three times while writing `spec/examples/` against current syntax

## As built

Fixed as sketched under "The fix" below: `lowerCasePatternCond` takes a per-arm
`rename map[string]string`, the `*ast.VarBinderPattern` arm records
`rename[p.Name] = subjectRef` instead of calling `emitIdentity`, and the caller
applies `substituteRefs` to the arm's guard and result expression. Four things
came out differently from the plan, or are worth recording.

- **Type inference needed no change.** The concern was that dropping
  `emitIdentity` also drops its `remember()` call. It does, but the subject temp
  the binder now renames to was itself registered by `lowerExprTemp`, so
  `inferLocalType` resolves the renamed reference exactly as it resolved the
  binder name before.

- **Shadowing was already decided, by the validator.** The plan left open whether
  a binder that shares a name with a real prog binding should shadow it or raise
  a diagnostic. `validate.protoPatternScopeBindings` already builds an arm scope
  as a `scopeChain` link over the enclosing scope, i.e. it already implements
  shadowing. The lowerer now matches the validator rather than the other way
  round, and no new diagnostic was added.

- **`substituteRefs` had a latent capture bug**, shared with the tuple and
  template paths that already used it. Recursing into a nested `case` rewrote
  references that the inner arm's own binder rebinds, so
  `case(v, x -> case(w, x -> x, _ -> 0), _ -> 0)` would have pointed the inner
  `x` at the outer subject. `shadowRename` now drops any name an inner pattern
  binds before descending into that arm. The subject is not shadowed — it is
  evaluated outside the arms.

- **The template path's catch-all arm had the same leak.** A trailing
  `VarBinderPattern` arm on a template `case` also called `emitIdentity(p.Name, …)`
  (`lower_template_case.go`). It is now an alpha-rename like the rest.

`spec/examples/04-sensor-calibration.tu` keeps its tuple spelling. It is the only
example of tuple destructuring in the tree, so removing it would cost a working
feature its only demonstration; the tuple form is now a choice there rather than
a workaround.

## The problem (as originally reported)

`pipe-if-case-it.md` §5.7 says a variable bound in a pattern is visible only within that arm's guard and that arm's expression. The scalar `case` lowering does not implement that. It emits a real prog binding named after the binder, so two arms that use the same binder name collide.

```hcl
band:str = case(
  v,
  x if x >= 10 -> "high",
  x if x >= 5  -> "mid",
  _ -> "low"
)
```

```text
error [DuplicateBinding]: duplicate binding name "x" in compute "c"
```

Nothing about that message points at the real constraint, which is "a binder name may not repeat across arms of one case". An author reading §5.7 has every reason to expect the above to work, because reusing `x` is the natural spelling when each arm is a threshold on the same subject.

The practical effect is that the idiomatic multi-threshold classification cannot be written, and every author who tries has to discover the workaround, which is to hoist each threshold into its own bool and match a tuple of them.

```hcl
# what you have to write instead
hi:bool  = v >= 10
mid:bool = v >= 5
band:str = case(
  (hi, mid),
  (true, _) -> "high",
  (_, true) -> "mid",
  _ -> "low"
)
```

`spec/examples/04-sensor-calibration.tu` carries that workaround with a comment explaining it, which is a fair signal that the constraint is surprising enough to need one.

## Root cause

Two lowering paths handle binders, and only one of them is right.

Scalar case, `internal/lower/lower_local.go:395`. `lowerCasePatternCond` resolves a binder by emitting a binding into the enclosing prog:

```go
case *ast.VarBinderPattern:
	condRef = c.temp("case_bind")
	c.emitValue(condRef, ast.FieldTypeBool, &ast.BoolLiteral{Value: true})
	// Inject the binder variable so arm expressions can reference p.Name.
	c.emitIdentity(p.Name, subjectType, subjectRef)
```

`emitIdentity(p.Name, ...)` uses the author's binder name as a prog-level binding name. Prog binding names are unique, so the second arm binding `x` is a duplicate. The binder is also visible to every later binding in the prog, not just its own arm, which is the opposite of the scoping the spec describes.

Tuple case, `internal/lower/lower_tuple_case.go:85`. The same construct resolves a binder without emitting anything:

```go
case *ast.VarBinderPattern:
	if value.ref == "" {
		return "", false
	}
	rename[p.Name] = value.ref
	return trueRef(), true
```

The binder becomes an entry in a rename map, and `substituteRefs` (`lower_template_case.go:303`) rewrites references inside that arm's guard and expression to point at the subject temp that already exists. No new prog binding, no collision, and the binder is genuinely confined to the arm.

Confirmed: a tuple case reusing one binder name across arms lowers cleanly. Only the scalar path fails.

## The fix

Port the scalar path onto the rename-substitution the tuple path already uses. This is not a new mechanism. `substituteRefs` and the `rename map[string]string` convention are in the tree and exercised by the tuple and template case paths.

Sketch:

- `lowerCasePatternCond` takes a `rename map[string]string`, and the `*ast.VarBinderPattern` arm records `rename[p.Name] = subjectRef` instead of calling `emitIdentity`
- the caller applies `substituteRefs(arm.Guard, rename)` and `substituteRefs(arm.Expr, rename)` before lowering them, with a fresh map per arm
- the `condRef` for a binder arm stays an unconditional `true`, as it is today

Points for whoever picks this up:

- Type inference. `emitIdentity` also calls `remember()`, which registers the binder's type for downstream inference. The rename path resolves to the subject temp, whose type is already known, so inference should follow. This is the one thing to check rather than assume.
- Shadowing. Once binders stop being prog bindings, a binder that shares a name with a real prog binding shadows it inside the arm. Decide whether that is allowed or a diagnostic. An error is easier to explain, and no checked-in file relies on either behaviour.
- `#it` interaction. `pipe` uses its own placeholder substitution. Check that a `case` inside a `pipe` step still resolves both.

## Verification

All of the following now hold.

- the failing example at the top of this file lowers cleanly and evaluates: subject 12 → "high", 7 → "mid", 1 → "low" — pinned end to end in `tests/e2e/local-expressions-matrix.test.ts` as `case-binder-threshold-{12,7,1}`
- a binder name reused across three or more arms lowers cleanly — `TestCaseBinderReusedAcrossFourArms`
- a binder is no longer visible to bindings declared after the `case` in the same prog — `TestCaseBinderNotVisibleAfterCase`, which lowers *and* validates, because the lower stage does not resolve plain references
- a nested binder shadows the outer one instead of being captured by it — `TestNestedCaseBinderShadowsOuter`
- the tuple and template case paths emit unchanged models; the existing `lower` and `emit` suites pass without edits

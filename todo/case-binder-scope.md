# Scalar `case` leaks its binders into the enclosing prog

> Status: bug, reproducible on `main`
> Origin: hit three times while writing `spec/examples/` against current syntax

## The problem

`pipe-if-case-it.md` §5.7 says a variable bound in a pattern is visible only within that arm's guard and that arm's expression. The scalar `case` lowering does not implement that: it emits a real prog binding named after the binder, so two arms that use the same binder name collide.

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

Nothing about that message points at the real constraint, which is "a binder name may not repeat across arms of one case". An author reading §5.7 has every reason to expect the above to work — reusing `x` is the natural spelling when each arm is a threshold on the same subject.

The practical effect is that the idiomatic multi-threshold classification cannot be written, and every author who tries has to discover the workaround: hoist each threshold into its own bool and match a tuple of them.

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

**Scalar case — `internal/lower/lower_local.go:395`.** `lowerCasePatternCond` resolves a binder by emitting a binding into the enclosing prog:

```go
case *ast.VarBinderPattern:
	condRef = c.temp("case_bind")
	c.emitValue(condRef, ast.FieldTypeBool, &ast.BoolLiteral{Value: true})
	// Inject the binder variable so arm expressions can reference p.Name.
	c.emitIdentity(p.Name, subjectType, subjectRef)
```

`emitIdentity(p.Name, ...)` uses the author's binder name as a prog-level binding name. Prog binding names are unique, so the second arm binding `x` is a duplicate. The binder is also visible to every later binding in the prog, not just its own arm — the opposite of the scoping the spec describes.

**Tuple case — `internal/lower/lower_tuple_case.go:85`.** The same construct resolves a binder without emitting anything:

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

Port the scalar path onto the rename-substitution the tuple path already uses. This is not a new mechanism — `substituteRefs` and the `rename map[string]string` convention are in the tree and exercised by the tuple and template case paths.

Sketch:

- `lowerCasePatternCond` takes a `rename map[string]string`, and the `*ast.VarBinderPattern` arm records `rename[p.Name] = subjectRef` instead of calling `emitIdentity`
- the caller applies `substituteRefs(arm.Guard, rename)` and `substituteRefs(arm.Expr, rename)` before lowering them, with a fresh map per arm
- the `condRef` for a binder arm stays an unconditional `true`, as it is today

Points for whoever picks this up:

- **Type inference.** `emitIdentity` also calls `remember()`, which registers the binder's type for downstream inference. The rename path resolves to the subject temp, whose type is already known, so inference should follow — but this is the one thing to check rather than assume.
- **Shadowing.** Once binders stop being prog bindings, a binder that shares a name with a real prog binding shadows it inside the arm. Decide whether that is allowed or a diagnostic; an error is easier to explain, and no checked-in file relies on either behaviour.
- **`#it` interaction.** `pipe` uses its own placeholder substitution. Check that a `case` inside a `pipe` step still resolves both.

## Verification

- the failing example at the top of this file lowers cleanly and evaluates: subject 12 → "high", 7 → "mid", 1 → "low"
- a binder name reused across three or more arms lowers cleanly
- the emitted model for a case with *distinct* binder names per arm is unchanged, which is what proves the fix is not a rewrite of working output
- a binder is no longer visible to bindings declared after the `case` in the same prog — today it is
- the tuple and template case paths emit byte-identical models before and after, since they already work this way
- `spec/examples/04-sensor-calibration.tu` can drop its workaround and its explanatory comment

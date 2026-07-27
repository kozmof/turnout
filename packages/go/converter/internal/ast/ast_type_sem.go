package ast

// ────────────────────────────────────────────────────────────
// Type semantics — value-set membership and subtyping
// ────────────────────────────────────────────────────────────
//
// These operations implement the value-set model of literal-template-types-spec.md §8-§10. Literal
// and template types are compared by the set of values they accept, not by name
// (§18). Callers must resolve named types first (Resolve); operations treat an
// unresolved NamedType conservatively (no known members).
//
// Template subtyping is intentionally not handled here yet; it is added with
// the Phase 2 template semantics. Subtype returns false for template operands
// until then.

// Resolve follows a NamedType's resolution chain to the underlying structural
// type. Returns the input unchanged for non-named or unresolved types.
func Resolve(t Type) Type {
	for {
		nt, ok := t.(*NamedType)
		if !ok || nt.Resolved == nil {
			return t
		}
		t = nt.Resolved
	}
}

// primKindSubtype reports whether a value of primitive kind a also belongs to
// primitive kind b (literal-template-types-spec.md §24.2: integer <: number).
func primKindSubtype(a, b PrimitiveKind) bool {
	if a == b {
		return true
	}
	return a == PrimInteger && b == PrimNumber
}

// LiteralValuesEqual reports whether two scalar literals denote the same value.
// Numeric equality is by float value; string and bool by content. Non-scalar or
// mismatched-kind literals compare unequal.
func LiteralValuesEqual(a, b Literal) bool {
	switch av := a.(type) {
	case *StringLiteral:
		bv, ok := b.(*StringLiteral)
		return ok && av.Value == bv.Value
	case *NumberLiteral:
		bv, ok := b.(*NumberLiteral)
		return ok && av.Value == bv.Value
	case *BoolLiteral:
		bv, ok := b.(*BoolLiteral)
		return ok && av.Value == bv.Value
	}
	return false
}

// Subtype reports whether every value of a also belongs to b (a <: b), using
// value-set inclusion (literal-template-types-spec.md §9). Both operands should be resolved.
func Subtype(a, b Type) bool {
	a, b = Resolve(a), Resolve(b)
	switch av := a.(type) {
	case *UnionType:
		// A union is a subtype of b when every member is.
		for _, m := range av.Members {
			if !Subtype(m, b) {
				return false
			}
		}
		return true
	case *LiteralType:
		return literalSubtype(av, b)
	case *PrimitiveType:
		return primitiveSubtype(av, b)
	case *TemplateType:
		// Template subtyping is added with Phase 2 semantics.
		return false
	}
	return false
}

// literalSubtype handles `literal <: b`.
func literalSubtype(a *LiteralType, b Type) bool {
	switch bt := b.(type) {
	case *LiteralType:
		return LiteralValuesEqual(a.Value, bt.Value)
	case *UnionType:
		for _, m := range bt.Members {
			if Subtype(a, m) {
				return true
			}
		}
		return false
	case *PrimitiveType:
		return primKindSubtype(a.BaseKind(), bt.Kind)
	}
	return false
}

// primitiveSubtype handles `primitive <: b`. A primitive is wider than any
// literal or union, so it is only a subtype of a compatible primitive.
func primitiveSubtype(a *PrimitiveType, b Type) bool {
	bt, ok := b.(*PrimitiveType)
	if !ok {
		return false
	}
	return primKindSubtype(a.Kind, bt.Kind)
}

// Assignable reports whether a value of type a may be assigned to type b
// (literal-template-types-spec.md §10): exactly when a <: b.
func Assignable(a, b Type) bool { return Subtype(a, b) }

// LiteralInType reports whether the scalar literal value belongs to type t
// (literal-template-types-spec.md §8, scalar forms). Template membership is handled by the Phase 2
// template matcher.
func LiteralInType(lit Literal, t Type) bool {
	return Subtype(NewLiteralType(lit.Pos(), lit), t)
}

// ────────────────────────────────────────────────────────────
// Union normalization
// ────────────────────────────────────────────────────────────

// UnionCheckResult reports the outcome of validating and normalizing a union's
// members (literal-template-types-spec.md §5.2-§5.3). Duplicates lists members that repeat an earlier
// value (by canonical string). MixedBase is set when members do not share a
// compatible base type; BaseA/BaseB name the first conflicting pair.
type UnionCheckResult struct {
	Duplicates []string
	MixedBase  bool
	BaseA      PrimitiveKind
	BaseB      PrimitiveKind
}

// CheckUnionMembers validates literal-union members for duplicates and mixed
// base types. It assumes every member is a *LiteralType (the initial-version
// restriction). The base type of the union is the widening of its members'
// bases (integer members widen to number if any non-integer numeric member is
// present).
func CheckUnionMembers(members []Type) UnionCheckResult {
	var res UnionCheckResult
	seen := make(map[string]struct{}, len(members))
	var base PrimitiveKind
	haveBase := false
	for _, m := range members {
		lit, ok := m.(*LiteralType)
		if !ok {
			continue
		}
		key := lit.String()
		if _, dup := seen[key]; dup {
			res.Duplicates = append(res.Duplicates, key)
		} else {
			seen[key] = struct{}{}
		}
		mb := lit.BaseKind()
		if !haveBase {
			base, haveBase = mb, true
			continue
		}
		if !basesCompatible(base, mb) {
			res.MixedBase = true
			res.BaseA = base
			res.BaseB = mb
			return res
		}
		base = widenBase(base, mb)
	}
	return res
}

// WalkNamed invokes fn for every NamedType node reachable within t (unions and
// template captures are traversed; resolution links are not followed).
func WalkNamed(t Type, fn func(*NamedType)) {
	switch v := t.(type) {
	case *NamedType:
		fn(v)
	case *UnionType:
		for _, m := range v.Members {
			WalkNamed(m, fn)
		}
	case *TemplateType:
		for _, seg := range v.Segments {
			if c, ok := seg.(*CaptureSegment); ok {
				WalkNamed(c.CaptureType, fn)
			}
		}
	}
}

// ResolveNamedRefs populates NamedType.Resolved for every reference reachable in
// t, using lookup to find a name's declared type. It is cycle-safe: a reference
// currently being resolved is left unresolved rather than recursing forever.
func ResolveNamedRefs(t Type, lookup func(string) (Type, bool)) {
	resolveNamedRefs(t, lookup, map[string]bool{})
}

func resolveNamedRefs(t Type, lookup func(string) (Type, bool), active map[string]bool) {
	switch v := t.(type) {
	case *NamedType:
		if v.Resolved != nil || active[v.Name] {
			return
		}
		target, ok := lookup(v.Name)
		if !ok {
			return
		}
		active[v.Name] = true
		resolveNamedRefs(target, lookup, active)
		delete(active, v.Name)
		v.Resolved = target
	case *UnionType:
		for _, m := range v.Members {
			resolveNamedRefs(m, lookup, active)
		}
	case *TemplateType:
		for _, seg := range v.Segments {
			if c, ok := seg.(*CaptureSegment); ok {
				resolveNamedRefs(c.CaptureType, lookup, active)
			}
		}
	}
}

// BaseFieldType returns the runtime FieldType that a resolved type serialises
// as: primitives and literals map by their base kind, unions map to the common
// base of their members, and templates are strings. ok is false when the type
// cannot be mapped (e.g. an unresolved named reference or an empty union).
func BaseFieldType(t Type) (FieldType, bool) {
	switch v := Resolve(t).(type) {
	case *PrimitiveType:
		return v.Kind.AsFieldType()
	case *LiteralType:
		return v.BaseKind().AsFieldType()
	case *TemplateType:
		return FieldTypeStr, true
	case *UnionType:
		lits, ok := FlattenUnionLiterals(v)
		if !ok || len(lits) == 0 {
			return FieldTypeInvalid, false
		}
		base := lits[0].BaseKind()
		for _, l := range lits[1:] {
			base = widenBase(base, l.BaseKind())
		}
		return base.AsFieldType()
	}
	return FieldTypeInvalid, false
}

// FlattenUnionLiterals resolves t and collects the literal members of a union
// (or the single literal of a literal type), following named references and
// nested unions. ok is false if any leaf is not a literal (e.g. a primitive or
// template), meaning t is not a finite literal set.
func FlattenUnionLiterals(t Type) ([]*LiteralType, bool) {
	var out []*LiteralType
	var walk func(Type) bool
	walk = func(t Type) bool {
		switch v := Resolve(t).(type) {
		case *LiteralType:
			out = append(out, v)
			return true
		case *UnionType:
			for _, m := range v.Members {
				if !walk(m) {
					return false
				}
			}
			return true
		default:
			return false
		}
	}
	if !walk(t) {
		return nil, false
	}
	return out, true
}

// basesCompatible reports whether two literal base kinds may coexist in one
// union. integer and number are compatible (both numeric); str, bool are only
// compatible with themselves.
func basesCompatible(a, b PrimitiveKind) bool {
	if a == b {
		return true
	}
	return isNumericKind(a) && isNumericKind(b)
}

func isNumericKind(k PrimitiveKind) bool { return k == PrimInteger || k == PrimNumber }

// widenBase returns the common base of two compatible kinds (integer widens to
// number when mixed with a non-integer numeric member).
func widenBase(a, b PrimitiveKind) PrimitiveKind {
	if a == b {
		return a
	}
	if isNumericKind(a) && isNumericKind(b) {
		if a == PrimNumber || b == PrimNumber {
			return PrimNumber
		}
		return PrimInteger
	}
	return a
}

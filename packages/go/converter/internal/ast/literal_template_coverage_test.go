package ast

import "testing"

func TestLiteralTemplateTypeSemanticMatrix(t *testing.T) {
	p := Pos{File: "x", Line: 1, Col: 2}
	str := NewPrimitiveType(p, PrimStr)
	integer := NewPrimitiveType(p, PrimInteger)
	number := NewPrimitiveType(p, PrimNumber)
	foo := NewLiteralType(p, NewStringLiteral(p, "foo"))
	one := NewLiteralType(p, NewNumberLiteral(p, 1))
	half := NewLiteralType(p, NewNumberLiteral(p, 1.5))
	yes := NewLiteralType(p, NewBoolLiteral(p, true))
	union := NewUnionType(p, []Type{one, half})

	if !Assignable(integer, number) || Assignable(number, integer) || !LiteralInType(NewNumberLiteral(p, 1), union) {
		t.Fatal("numeric subtype semantics")
	}
	if !Subtype(foo, str) || Subtype(str, foo) || !Subtype(one, union) || Subtype(yes, union) {
		t.Fatal("literal subtype semantics")
	}
	if !LiteralValuesEqual(NewStringLiteral(p, "foo"), NewStringLiteral(p, "foo")) || LiteralValuesEqual(NewStringLiteral(p, "foo"), NewNumberLiteral(p, 1)) {
		t.Fatal("string equality")
	}
	if !LiteralValuesEqual(NewNumberLiteral(p, 1), NewNumberLiteral(p, 1)) || !LiteralValuesEqual(NewBoolLiteral(p, true), NewBoolLiteral(p, true)) {
		t.Fatal("scalar equality")
	}
	if LiteralValuesEqual(&ArrayLiteral{}, &ArrayLiteral{}) {
		t.Fatal("arrays are not scalar")
	}

	for _, tc := range []struct {
		kind  PrimitiveKind
		valid bool
	}{
		{PrimStr, true}, {PrimInteger, true}, {PrimNumber, true}, {PrimBool, true}, {PrimitiveKind(99), false},
	} {
		if tc.kind.Valid() != tc.valid {
			t.Errorf("Valid(%v)", tc.kind)
		}
	}
	for _, name := range []string{"str", "integer", "number", "bool"} {
		if _, ok := PrimitiveKindFromString(name); !ok {
			t.Errorf("missing %s", name)
		}
	}
	if _, ok := PrimitiveKindFromString("bad"); ok {
		t.Fatal("accepted bad primitive")
	}

	for _, typ := range []Type{str, foo, union, NewTemplateType(p, []TemplateSegment{&TextSegment{Value: "x"}})} {
		if _, ok := BaseFieldType(typ); !ok {
			t.Errorf("no field type for %T", typ)
		}
	}
	if _, ok := BaseFieldType(NewUnionType(p, nil)); ok {
		t.Fatal("empty union mapped")
	}
	if _, ok := BaseFieldType(NewNamedType(p, "Missing")); ok {
		t.Fatal("unresolved name mapped")
	}
	if _, ok := FlattenUnionLiterals(str); ok {
		t.Fatal("primitive flattened")
	}
}

func TestResolveNamedRefsAndWalk(t *testing.T) {
	p := Pos{}
	leaf := NewUnionType(p, []Type{NewLiteralType(p, NewStringLiteral(p, "a")), NewLiteralType(p, NewStringLiteral(p, "b"))})
	ref := NewNamedType(p, "Leaf")
	tmpl := NewTemplateType(p, []TemplateSegment{&CaptureSegment{Name: "value", CaptureType: ref}})
	seen := 0
	WalkNamed(tmpl, func(n *NamedType) {
		seen++
		if n.Name != "Leaf" {
			t.Errorf("name=%s", n.Name)
		}
	})
	ResolveNamedRefs(tmpl, func(name string) (Type, bool) { return leaf, name == "Leaf" })
	if seen != 1 || Resolve(ref) != leaf {
		t.Fatalf("resolution failed")
	}
	lits, ok := FlattenUnionLiterals(ref)
	if !ok || len(lits) != 2 {
		t.Fatalf("flatten=%v,%v", len(lits), ok)
	}

	missing := NewNamedType(p, "Missing")
	ResolveNamedRefs(missing, func(string) (Type, bool) { return nil, false })
	if missing.Resolved != nil {
		t.Fatal("missing ref resolved")
	}
	cycleA := NewNamedType(p, "A")
	cycleB := NewNamedType(p, "B")
	lookup := func(name string) (Type, bool) {
		if name == "A" {
			return cycleB, true
		}
		if name == "B" {
			return cycleA, true
		}
		return nil, false
	}
	ResolveNamedRefs(cycleA, lookup)
}

func TestTemplateMatchScalarKindsAndFailures(t *testing.T) {
	p := Pos{}
	cases := []struct {
		typ       Type
		good, bad string
		want      any
	}{
		{NewPrimitiveType(p, PrimNumber), "-1.25", "01.2", -1.25},
		{NewLiteralType(p, NewNumberLiteral(p, 1.5)), "1.5", "1.6", 1.5},
		{NewLiteralType(p, NewBoolLiteral(p, false)), "false", "true", false},
		{NewLiteralType(p, NewStringLiteral(p, "ok")), "ok", "no", "ok"},
	}
	for _, tc := range cases {
		tmpl := NewTemplateType(p, []TemplateSegment{&CaptureSegment{Name: "v", CaptureType: tc.typ}})
		caps, ok := TemplateMatch(tmpl, tc.good)
		if !ok || caps["v"] != tc.want {
			t.Errorf("good %q -> %#v,%v", tc.good, caps, ok)
		}
		if TemplateContains(tmpl, tc.bad) {
			t.Errorf("accepted %q", tc.bad)
		}
	}
	if TemplateContains(NewTemplateType(p, []TemplateSegment{&TextSegment{Value: "x"}}), "y") {
		t.Fatal("bad static text")
	}
	if TemplateContains(NewTemplateType(p, nil), "x") {
		t.Fatal("nonempty matched empty template")
	}
}

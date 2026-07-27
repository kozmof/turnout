package ast

import "testing"

func str(v string) *StringLiteral  { return NewStringLiteral(Pos{}, v) }
func num(v float64) *NumberLiteral { return NewNumberLiteral(Pos{}, v) }
func boolean(v bool) *BoolLiteral  { return NewBoolLiteral(Pos{}, v) }

func litT(l Literal) *LiteralType         { return NewLiteralType(Pos{}, l) }
func prim(k PrimitiveKind) *PrimitiveType { return NewPrimitiveType(Pos{}, k) }
func union(ms ...Type) *UnionType         { return NewUnionType(Pos{}, ms) }

func TestTypeStringRendering(t *testing.T) {
	cases := []struct {
		typ  Type
		want string
	}{
		{prim(PrimStr), "str"},
		{prim(PrimInteger), "integer"},
		{litT(str("foo")), `"foo"`},
		{litT(num(42)), "42"},
		{litT(num(1.5)), "1.5"},
		{litT(boolean(true)), "true"},
		{union(litT(str("foo")), litT(str("bar"))), `"foo" | "bar"`},
		{NewTemplateType(Pos{}, []TemplateSegment{
			&CaptureSegment{Name: "kind", CaptureType: NewNamedType(Pos{}, "Kind")},
			&TextSegment{Value: "-"},
			&CaptureSegment{Name: "sequence", CaptureType: prim(PrimInteger)},
		}), `"{kind: Kind}-{sequence: integer}"`},
		{NewNamedType(Pos{}, "ResourceId"), "ResourceId"},
	}
	for _, c := range cases {
		if got := c.typ.String(); got != c.want {
			t.Errorf("String() = %q, want %q", got, c.want)
		}
	}
}

func TestLiteralBaseKind(t *testing.T) {
	if got := litT(num(42)).BaseKind(); got != PrimInteger {
		t.Errorf("42 base = %v, want integer", got)
	}
	if got := litT(num(1.5)).BaseKind(); got != PrimNumber {
		t.Errorf("1.5 base = %v, want number", got)
	}
	if got := litT(str("x")).BaseKind(); got != PrimStr {
		t.Errorf("string base = %v, want str", got)
	}
	if got := litT(boolean(false)).BaseKind(); got != PrimBool {
		t.Errorf("bool base = %v, want bool", got)
	}
}

func TestSubtype(t *testing.T) {
	foo := litT(str("foo"))
	kind := union(litT(str("foo")), litT(str("bar")))
	anyKind := union(litT(str("foo")), litT(str("bar")), litT(str("baz")))

	cases := []struct {
		name string
		a, b Type
		want bool
	}{
		{"literal <: same literal", foo, litT(str("foo")), true},
		{"literal <: different literal", foo, litT(str("bar")), false},
		{"literal <: union member", foo, kind, true},
		{"literal not in union", litT(str("baz")), kind, false},
		{"union <: wider union", kind, anyKind, true},
		{"wider union not <: narrower", anyKind, kind, false},
		{"literal <: str primitive", foo, prim(PrimStr), true},
		{"int literal <: integer", litT(num(42)), prim(PrimInteger), true},
		{"int literal <: number", litT(num(42)), prim(PrimNumber), true},
		{"decimal literal not <: integer", litT(num(1.5)), prim(PrimInteger), false},
		{"decimal literal <: number", litT(num(1.5)), prim(PrimNumber), true},
		{"integer <: number primitive", prim(PrimInteger), prim(PrimNumber), true},
		{"number not <: integer", prim(PrimNumber), prim(PrimInteger), false},
		{"str primitive not <: literal", prim(PrimStr), foo, false},
		{"str not <: union", prim(PrimStr), kind, false},
	}
	for _, c := range cases {
		if got := Subtype(c.a, c.b); got != c.want {
			t.Errorf("%s: Subtype(%s, %s) = %v, want %v", c.name, c.a, c.b, got, c.want)
		}
	}
}

func TestResolveNamed(t *testing.T) {
	inner := union(litT(str("foo")), litT(str("bar")))
	alias := NewNamedType(Pos{}, "Kind")
	alias.Resolved = inner
	outer := NewNamedType(Pos{}, "ResourceKind")
	outer.Resolved = alias
	if Resolve(outer) != inner {
		t.Errorf("Resolve did not follow alias chain to inner union")
	}
	// literal of alias member is a subtype of the alias.
	if !Subtype(litT(str("foo")), outer) {
		t.Errorf(`"foo" should be assignable through alias chain`)
	}
}

func TestCheckUnionMembers(t *testing.T) {
	// duplicate members
	res := CheckUnionMembers([]Type{litT(str("foo")), litT(str("bar")), litT(str("foo"))})
	if len(res.Duplicates) != 1 || res.Duplicates[0] != `"foo"` {
		t.Errorf("expected duplicate \"foo\", got %+v", res.Duplicates)
	}
	if res.MixedBase {
		t.Errorf("string-only union should not be mixed base")
	}

	// mixed base string + integer
	res = CheckUnionMembers([]Type{litT(str("foo")), litT(num(42))})
	if !res.MixedBase {
		t.Errorf("string + integer union should be mixed base")
	}

	// integer + number is compatible (numeric)
	res = CheckUnionMembers([]Type{litT(num(42)), litT(num(1.5))})
	if res.MixedBase {
		t.Errorf("integer + number union should be compatible")
	}
	if len(res.Duplicates) != 0 {
		t.Errorf("unexpected duplicates: %+v", res.Duplicates)
	}
}

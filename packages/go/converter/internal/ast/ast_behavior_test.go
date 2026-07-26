package ast

import (
	"testing"

	"google.golang.org/protobuf/types/known/structpb"
)

func TestLiteralConstructorsTypesAndProtoConversion(t *testing.T) {
	pos := Pos{File: "values.turn", Line: 3, Col: 7}
	number := NewNumberLiteral(pos, 42)
	str := NewStringLiteral(pos, "ok")
	boolean := NewBoolLiteral(pos, true)

	for _, tc := range []struct {
		lit  Literal
		want FieldType
	}{
		{number, FieldTypeNumber},
		{str, FieldTypeStr},
		{boolean, FieldTypeBool},
		{NewArrayLiteral(pos, []Literal{number}), FieldTypeArrNumber},
		{NewArrayLiteral(pos, []Literal{str}), FieldTypeArrStr},
		{NewArrayLiteral(pos, []Literal{boolean}), FieldTypeArrBool},
	} {
		if tc.lit.Pos() != pos {
			t.Errorf("%T position = %v, want %v", tc.lit, tc.lit.Pos(), pos)
		}
		if got, ok := LiteralFieldType(tc.lit); !ok || got != tc.want {
			t.Errorf("LiteralFieldType(%T) = (%v, %v), want (%v, true)", tc.lit, got, ok, tc.want)
		}
		if got := LiteralToStructpb(tc.lit); got == nil {
			t.Errorf("LiteralToStructpb(%T) returned nil", tc.lit)
		}
	}

	if got := LiteralToStructpb(nil); got.GetNullValue() != structpb.NullValue_NULL_VALUE {
		t.Errorf("nil literal converted to %v, want null", got)
	}
	for _, invalid := range []Literal{
		NewArrayLiteral(pos, nil),
		NewArrayLiteral(pos, []Literal{number, str}),
		NewArrayLiteral(pos, []Literal{NewArrayLiteral(pos, nil)}),
	} {
		if got, ok := LiteralFieldType(invalid); ok || got != FieldTypeInvalid {
			t.Errorf("LiteralFieldType(%T) = (%v, %v), want invalid", invalid, got, ok)
		}
	}
}

func TestBindingRHSKinds(t *testing.T) {
	cases := []struct {
		rhs  BindingRHS
		want BindingRHSKind
	}{
		{&LiteralRHS{}, RHSKindLiteral},
		{&SigilInputRHS{}, RHSKindSigilInput},
		{&SingleRefRHS{}, RHSKindSingleRef},
		{&FuncCallRHS{}, RHSKindFuncCall},
		{&InfixRHS{}, RHSKindInfix},
		{&IfCallRHS{}, RHSKindIfCall},
		{&CaseCallRHS{}, RHSKindCaseCall},
		{&PipeCallRHS{}, RHSKindPipeCall},
		{&ErrorRHS{}, RHSKindError},
	}
	for _, tc := range cases {
		if got := tc.rhs.Kind(); got != tc.want {
			t.Errorf("%T.Kind() = %v, want %v", tc.rhs, got, tc.want)
		}
	}
}

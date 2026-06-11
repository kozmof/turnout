package validate_test

// Tests that verify the invariant between lowerSingleRefRHS (lower package) and
// isIdentityCombine (validate package). If the lowerer changes how it encodes
// single-reference bindings, isIdentityCombine stops recognising them and array
// single-refs start failing with CodeEmptyArrayLitArg at conversion time.

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/validate"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestIsIdentityCombineRecognisesLowererOutput verifies that IsIdentityCombine
// accepts the exact CombineExpr shapes that lowerSingleRefRHS produces for
// every FieldType. The shapes are constructed here to match identityFnFor
// in lower/lower_rhs.go; any divergence between the two is a compile-time
// regression.
func TestIsIdentityCombineRecognisesLowererOutput(t *testing.T) {
	cases := []struct {
		name       string
		fn         string
		identityLit *structpb.Value
	}{
		{"bool", "bool_and", structpb.NewBoolValue(true)},
		{"number", "add", structpb.NewNumberValue(0)},
		{"str", "str_concat", structpb.NewStringValue("")},
		{"arr<number>", "arr_concat", structpb.NewListValue(&structpb.ListValue{})},
		{"arr<str>", "arr_concat", structpb.NewListValue(&structpb.ListValue{})},
		{"arr<bool>", "arr_concat", structpb.NewListValue(&structpb.ListValue{})},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Construct the exact CombineExpr that lowerSingleRefRHS builds:
			// fn(ref, identity_element)
			c := &turnoutpb.CombineExpr{
				Fn: tc.fn,
				Args: []*turnoutpb.ArgModel{
					{Ref: proto.String("source")},
					{Lit: tc.identityLit},
				},
			}
			if !validate.IsIdentityCombine(c) {
				t.Errorf("IsIdentityCombine returned false for %s identity-combine %s(source, %v)", tc.name, tc.fn, tc.identityLit)
			}
		})
	}
}

// TestSingleRefBindingsNoEmptyArrayLitArg is an integration test that verifies
// single-reference bindings for every FieldType compile without CodeEmptyArrayLitArg.
// This catches the regression where arr<T> single-refs (lowered to arr_concat(x, []))
// are incorrectly flagged as type-ambiguous empty-array literals.
func TestSingleRefBindingsNoEmptyArrayLitArg(t *testing.T) {
	cases := []struct {
		name    string
		binding string // binding declaration added before the root v:bool = true
	}{
		{"number", "        n:number = 1\n        alias:number = n\n"},
		{"str", "        s:str = \"x\"\n        alias:str = s\n"},
		{"bool", "        b:bool = false\n        alias:bool = b\n"},
		{"arr<number>", "        items:arr<number> = [1, 2]\n        alias:arr<number> = items\n"},
		{"arr<str>", "        words:arr<str> = [\"a\", \"b\"]\n        alias:arr<str> = words\n"},
		{"arr<bool>", "        flags:arr<bool> = [true, false]\n        alias:arr<bool> = flags\n"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ds := pipeline(min(tc.binding))
			if hasCode(ds, diag.CodeEmptyArrayLitArg) {
				t.Errorf("single-reference %s binding incorrectly rejected as CodeEmptyArrayLitArg", tc.name)
			}
			for _, d := range ds {
				if d.Severity == diag.SeverityError {
					t.Errorf("unexpected error for %s single-ref: %s", tc.name, d.Format())
				}
			}
		})
	}
}

// TestIsIdentityCombineRejectsUserAuthored verifies that user-authored function
// calls that happen to match the identity-combine shape are still recognised
// (this is acceptable — str_concat(x, "") is semantically a no-op).
func TestIsIdentityCombineRejectsNonIdentity(t *testing.T) {
	cases := []struct {
		name string
		c    *turnoutpb.CombineExpr
		want bool
	}{
		{
			name: "non-zero literal arg",
			c: &turnoutpb.CombineExpr{
				Fn:   "add",
				Args: []*turnoutpb.ArgModel{{Ref: proto.String("x")}, {Lit: structpb.NewNumberValue(1)}},
			},
			want: false,
		},
		{
			name: "three args",
			c: &turnoutpb.CombineExpr{
				Fn: "add",
				Args: []*turnoutpb.ArgModel{
					{Ref: proto.String("x")},
					{Lit: structpb.NewNumberValue(0)},
					{Lit: structpb.NewNumberValue(0)},
				},
			},
			want: false,
		},
		{
			name: "both refs (no literal)",
			c: &turnoutpb.CombineExpr{
				Fn:   "add",
				Args: []*turnoutpb.ArgModel{{Ref: proto.String("x")}, {Ref: proto.String("y")}},
			},
			want: false,
		},
		{
			name: "empty ref",
			c: &turnoutpb.CombineExpr{
				Fn:   "add",
				Args: []*turnoutpb.ArgModel{{Ref: proto.String("")}, {Lit: structpb.NewNumberValue(0)}},
			},
			want: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := validate.IsIdentityCombine(tc.c)
			if got != tc.want {
				t.Errorf("IsIdentityCombine = %v, want %v", got, tc.want)
			}
		})
	}
}

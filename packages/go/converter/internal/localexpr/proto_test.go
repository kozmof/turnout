package localexpr_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/localexpr"
)

func TestWalkProtoVisitsNestedRefs(t *testing.T) {
	expr := &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_Infix{Infix: &turnoutpb.LocalInfixExprModel{
		Lhs: &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_Ref{Ref: &turnoutpb.LocalRefExprModel{Name: "left"}}},
		Rhs: &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_Call{Call: &turnoutpb.LocalCallExprModel{
			Fn: "add",
			Args: []*turnoutpb.LocalExprModel{
				{Expr: &turnoutpb.LocalExprModel_Ref{Ref: &turnoutpb.LocalRefExprModel{Name: "right"}}},
			},
		}}},
	}}}

	var refs []string
	localexpr.WalkProto(expr, func(node *turnoutpb.LocalExprModel) {
		if ref, ok := node.Expr.(*turnoutpb.LocalExprModel_Ref); ok {
			refs = append(refs, ref.Ref.GetName())
		}
	})

	if got, want := refs, []string{"left", "right"}; len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("refs = %v, want %v", got, want)
	}
}

// Package localexpr contains shared helpers for working with proto local
// expression trees without changing their public schema shape.
package localexpr

import "github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"

// WalkProto visits e and all nested LocalExprModel children in depth-first order.
func WalkProto(e *turnoutpb.LocalExprModel, visit func(*turnoutpb.LocalExprModel)) {
	if e == nil {
		return
	}
	visit(e)
	for _, child := range ProtoChildren(e) {
		WalkProto(child, visit)
	}
}

// ProtoChildren returns the direct LocalExprModel children of e. It centralizes
// the common traversal shape shared by validation and emission helpers.
func ProtoChildren(e *turnoutpb.LocalExprModel) []*turnoutpb.LocalExprModel {
	if e == nil {
		return nil
	}
	switch x := e.Expr.(type) {
	case *turnoutpb.LocalExprModel_Call:
		return x.Call.GetArgs()
	case *turnoutpb.LocalExprModel_Infix:
		return compact(x.Infix.GetLhs(), x.Infix.GetRhs())
	case *turnoutpb.LocalExprModel_IfExpr:
		return compact(x.IfExpr.GetCond(), x.IfExpr.GetThen(), x.IfExpr.GetElseBranch())
	case *turnoutpb.LocalExprModel_CaseExpr:
		children := compact(x.CaseExpr.GetSubject())
		for _, arm := range x.CaseExpr.GetArms() {
			children = append(children, compact(arm.GetGuard(), arm.GetExpr())...)
		}
		return children
	case *turnoutpb.LocalExprModel_PipeExpr:
		children := compact(x.PipeExpr.GetInitial())
		children = append(children, x.PipeExpr.GetSteps()...)
		return children
	default:
		return nil
	}
}

func compact(values ...*turnoutpb.LocalExprModel) []*turnoutpb.LocalExprModel {
	out := make([]*turnoutpb.LocalExprModel, 0, len(values))
	for _, value := range values {
		if value != nil {
			out = append(out, value)
		}
	}
	return out
}

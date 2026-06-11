// lower_proto.go converts AST nodes to LocalExprModel proto messages for ext_expr round-trip.
package lower

import (
	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/fnmeta"
	"google.golang.org/protobuf/proto"
)

// ─────────────────────────────────────────────────────────────────────────────
// AST → proto LocalExprModel converters (for ext_expr population)
// ─────────────────────────────────────────────────────────────────────────────

func bindingRHSToProto(rhs ast.BindingRHS) *turnoutpb.LocalExprModel {
	switch r := rhs.(type) {
	case *ast.IfCallRHS:
		return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_IfExpr{IfExpr: &turnoutpb.LocalIfExprModel{
			Cond:       localExprToProto(r.Cond),
			Then:       localExprToProto(r.Then),
			ElseBranch: localExprToProto(r.Else),
		}}}
	case *ast.CaseCallRHS:
		arms := make([]*turnoutpb.LocalCaseArmModel, len(r.Arms))
		for i, arm := range r.Arms {
			a := &turnoutpb.LocalCaseArmModel{
				Pattern: localCasePatternToProto(arm.Pattern),
				Expr:    localExprToProto(arm.Expr),
			}
			if arm.Guard != nil {
				a.Guard = localExprToProto(arm.Guard)
			}
			arms[i] = a
		}
		return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_CaseExpr{CaseExpr: &turnoutpb.LocalCaseExprModel{
			Subject: localExprToProto(r.Subject),
			Arms:    arms,
		}}}
	case *ast.PipeCallRHS:
		steps := make([]*turnoutpb.LocalExprModel, len(r.Steps))
		for i, s := range r.Steps {
			steps[i] = localExprToProto(s)
		}
		return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_PipeExpr{PipeExpr: &turnoutpb.LocalPipeExprModel{
			Initial: localExprToProto(r.Initial),
			Steps:   steps,
		}}}
	default:
		return nil
	}
}

func localExprToProto(e ast.LocalExpr) *turnoutpb.LocalExprModel {
	if e == nil {
		return nil
	}
	switch x := e.(type) {
	case *ast.LocalRefExpr:
		return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_Ref{Ref: &turnoutpb.LocalRefExprModel{Name: x.Name}}}
	case *ast.LocalLitExpr:
		return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_Lit{Lit: &turnoutpb.LocalLitExprModel{Value: ast.LiteralToStructpb(x.Value)}}}
	case *ast.LocalItExpr:
		return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_It{It: &turnoutpb.LocalItExprModel{}}}
	case *ast.LocalCallExpr:
		args := make([]*turnoutpb.LocalExprModel, len(x.Args))
		for i, a := range x.Args {
			args[i] = localExprToProto(a)
		}
		return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_Call{Call: &turnoutpb.LocalCallExprModel{Fn: x.FnAlias, Args: args}}}
	case *ast.LocalInfixExpr:
		return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_Infix{Infix: &turnoutpb.LocalInfixExprModel{
			Op:  turnoutpb.InfixOp(x.Op),
			Lhs: localExprToProto(x.LHS),
			Rhs: localExprToProto(x.RHS),
		}}}
	case *ast.LocalIfExpr:
		return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_IfExpr{IfExpr: &turnoutpb.LocalIfExprModel{
			Cond:       localExprToProto(x.Cond),
			Then:       localExprToProto(x.Then),
			ElseBranch: localExprToProto(x.Else),
		}}}
	case *ast.LocalCaseExpr:
		arms := make([]*turnoutpb.LocalCaseArmModel, len(x.Arms))
		for i, arm := range x.Arms {
			a := &turnoutpb.LocalCaseArmModel{
				Pattern: localCasePatternToProto(arm.Pattern),
				Expr:    localExprToProto(arm.Expr),
			}
			if arm.Guard != nil {
				a.Guard = localExprToProto(arm.Guard)
			}
			arms[i] = a
		}
		return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_CaseExpr{CaseExpr: &turnoutpb.LocalCaseExprModel{
			Subject: localExprToProto(x.Subject),
			Arms:    arms,
		}}}
	case *ast.LocalPipeExpr:
		steps := make([]*turnoutpb.LocalExprModel, len(x.Steps))
		for i, s := range x.Steps {
			steps[i] = localExprToProto(s)
		}
		return &turnoutpb.LocalExprModel{Expr: &turnoutpb.LocalExprModel_PipeExpr{PipeExpr: &turnoutpb.LocalPipeExprModel{
			Initial: localExprToProto(x.Initial),
			Steps:   steps,
		}}}
	default:
		return nil
	}
}

func localCasePatternToProto(p ast.LocalCasePattern) *turnoutpb.LocalCasePatternModel {
	if p == nil {
		return &turnoutpb.LocalCasePatternModel{Pattern: &turnoutpb.LocalCasePatternModel_Wildcard{Wildcard: &turnoutpb.LocalWildcardPatternModel{}}}
	}
	switch x := p.(type) {
	case *ast.WildcardCasePattern:
		return &turnoutpb.LocalCasePatternModel{Pattern: &turnoutpb.LocalCasePatternModel_Wildcard{Wildcard: &turnoutpb.LocalWildcardPatternModel{}}}
	case *ast.LiteralCasePattern:
		return &turnoutpb.LocalCasePatternModel{Pattern: &turnoutpb.LocalCasePatternModel_Lit{Lit: &turnoutpb.LocalLitPatternModel{Value: ast.LiteralToStructpb(x.Value)}}}
	case *ast.VarBinderPattern:
		return &turnoutpb.LocalCasePatternModel{Pattern: &turnoutpb.LocalCasePatternModel_VarBinder{VarBinder: &turnoutpb.LocalVarBinderPatternModel{Name: x.Name}}}
	default:
		return &turnoutpb.LocalCasePatternModel{Pattern: &turnoutpb.LocalCasePatternModel_Wildcard{Wildcard: &turnoutpb.LocalWildcardPatternModel{}}}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Arg lowering
// ─────────────────────────────────────────────────────────────────────────────

func lowerMethodCallArg(a *ast.MethodCallArg, bindingTypes map[string]ast.FieldType, ds *diag.DiagSink) *turnoutpb.ArgModel {
	receiverType, ok := bindingTypes[a.Receiver]
	if !ok {
		ds.Append(diag.Errorf(diag.CodeUnknownMethod,
			"method call on %q: binding is not defined or its type is unknown", a.Receiver))
		return &turnoutpb.ArgModel{Ref: proto.String(a.Receiver)}
	}

	fns := make([]string, 0, len(a.Methods))
	currentType := receiverType
	for _, method := range a.Methods {
		qual, outType, found := fnmeta.LookupMethod(method, currentType)
		if !found {
			ds.Append(diag.Errorf(diag.CodeUnknownMethod,
				"method %q is not defined for type %q on receiver %q", method, currentType, a.Receiver))
			return &turnoutpb.ArgModel{Ref: proto.String(a.Receiver)}
		}
		fns = append(fns, qual)
		currentType = outType
	}
	return &turnoutpb.ArgModel{Transform: &turnoutpb.TransformArg{Ref: a.Receiver, Fn: fns}}
}

func lowerArgWithTypes(arg ast.PreLowerArg, bindingTypes map[string]ast.FieldType, ds *diag.DiagSink) *turnoutpb.ArgModel {
	switch a := arg.(type) {
	case *ast.RefArg:
		return &turnoutpb.ArgModel{Ref: proto.String(a.Name)}
	case *ast.LitArg:
		return &turnoutpb.ArgModel{Lit: ast.LiteralToStructpb(a.Value)}
	case *ast.FuncRefArg:
		return &turnoutpb.ArgModel{FuncRef: proto.String(a.FnName)}
	case *ast.StepRefArg:
		return &turnoutpb.ArgModel{StepRef: proto.Int32(int32(a.Index))}
	case *ast.TransformArg:
		return &turnoutpb.ArgModel{Transform: &turnoutpb.TransformArg{Ref: a.Ref, Fn: a.Fn}}
	case *ast.MethodCallArg:
		return lowerMethodCallArg(a, bindingTypes, ds)
	default:
		return &turnoutpb.ArgModel{}
	}
}

func lowerArgsWithTypes(args []ast.PreLowerArg, bindingTypes map[string]ast.FieldType, ds *diag.DiagSink) []*turnoutpb.ArgModel {
	result := make([]*turnoutpb.ArgModel, len(args))
	for i, a := range args {
		result[i] = lowerArgWithTypes(a, bindingTypes, ds)
	}
	return result
}

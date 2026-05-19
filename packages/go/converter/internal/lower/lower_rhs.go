package lower

import (
	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// ─────────────────────────────────────────────────────────────────────────────
// RHS-specific lowering functions
// ─────────────────────────────────────────────────────────────────────────────

func lowerLiteralRHS(name string, ft ast.FieldType, rhs *ast.LiteralRHS) *turnoutpb.BindingModel {
	return &turnoutpb.BindingModel{Name: name, Type: ft.String(), Value: literalToStructpb(rhs.Value)}
}

func lowerPlaceholderRHS(name string, ft ast.FieldType, pos ast.Pos, resolver prepareResolver, ds *diag.Diagnostics) *turnoutpb.BindingModel {
	val := resolver.resolveDefault(name, ft, pos, diag.CodeMissingPrepareEntry, ds)
	return &turnoutpb.BindingModel{Name: name, Type: ft.String(), Value: literalToStructpb(val)}
}

// lowerBiDirInputRHS resolves the default value for a <~> binding. Missing
// prepare entries use the bidirectional-specific diagnostic code, but other
// resolver failures such as unresolved state paths still surface normally.
func lowerBiDirInputRHS(name string, ft ast.FieldType, pos ast.Pos, resolver prepareResolver, ds *diag.Diagnostics) *turnoutpb.BindingModel {
	val := resolver.resolveDefault(name, ft, pos, diag.CodeBidirMissingPrepareEntry, ds)
	return &turnoutpb.BindingModel{Name: name, Type: ft.String(), Value: literalToStructpb(val)}
}

// identityFnFor returns the identity binary-function name and its neutral-element
// argument for the given field type. Used by lowerSingleRefRHS and emitIdentity
// to avoid duplicating the type-switch logic.
func identityFnFor(ft ast.FieldType) (fn string, identityArg *turnoutpb.ArgModel) {
	switch ft {
	case ast.FieldTypeBool:
		return "bool_and", &turnoutpb.ArgModel{Lit: structpb.NewBoolValue(true)}
	case ast.FieldTypeNumber:
		return "add", &turnoutpb.ArgModel{Lit: structpb.NewNumberValue(0)}
	case ast.FieldTypeStr:
		return "str_concat", &turnoutpb.ArgModel{Lit: structpb.NewStringValue("")}
	default: // arr<number>, arr<str>, arr<bool>
		return "arr_concat", &turnoutpb.ArgModel{Lit: structpb.NewListValue(&structpb.ListValue{})}
	}
}

// lowerSingleRefRHS lowers `name:type = identifier` to an identity combine.
func lowerSingleRefRHS(name string, ft ast.FieldType, rhs *ast.SingleRefRHS) *turnoutpb.BindingModel {
	fn, identityArg := identityFnFor(ft)
	return &turnoutpb.BindingModel{
		Name: name,
		Type: ft.String(),
		Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
			Fn:   fn,
			Args: []*turnoutpb.ArgModel{{Ref: proto.String(rhs.RefName)}, identityArg},
		}},
	}
}

func lowerFuncCallRHS(name string, ft ast.FieldType, rhs *ast.FuncCallRHS, bindingTypes map[string]ast.FieldType, ds *diag.Diagnostics) *turnoutpb.BindingModel {
	return &turnoutpb.BindingModel{
		Name: name,
		Type: ft.String(),
		Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
			Fn:   rhs.FnAlias,
			Args: lowerArgsWithTypes(rhs.Args, bindingTypes, ds),
		}},
	}
}

func lowerInfixRHS(name string, ft ast.FieldType, rhs *ast.InfixRHS, bindingTypes map[string]ast.FieldType, ds *diag.Diagnostics) *turnoutpb.BindingModel {
	fn := rhs.Op.FnAlias()
	if fn == "" {
		if ft == ast.FieldTypeStr {
			fn = "str_concat"
		} else {
			fn = "add"
		}
	}
	return &turnoutpb.BindingModel{
		Name: name,
		Type: ft.String(),
		Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
			Fn:   fn,
			Args: []*turnoutpb.ArgModel{lowerArgWithTypes(rhs.LHS, bindingTypes, ds), lowerArgWithTypes(rhs.RHS, bindingTypes, ds)},
		}},
	}
}

// legacy: emitted by the pre-v1 parser; kept until confirmed no input produces these forms.
func lowerPipeRHS(name string, ft ast.FieldType, rhs *ast.PipeRHS, bindingTypes map[string]ast.FieldType, ds *diag.Diagnostics) *turnoutpb.BindingModel {
	params := make([]*turnoutpb.PipeParam, 0, len(rhs.Params))
	for _, p := range rhs.Params {
		params = append(params, &turnoutpb.PipeParam{
			ParamName:   p.ParamName,
			SourceIdent: p.SourceIdent,
		})
	}
	steps := make([]*turnoutpb.PipeStep, 0, len(rhs.Steps))
	for _, s := range rhs.Steps {
		steps = append(steps, &turnoutpb.PipeStep{
			Fn:   s.FnAlias,
			Args: lowerArgsWithTypes(s.Args, bindingTypes, ds),
		})
	}
	return &turnoutpb.BindingModel{
		Name: name,
		Type: ft.String(),
		Expr: &turnoutpb.ExprModel{Pipe: &turnoutpb.PipeExpr{Params: params, Steps: steps}},
	}
}

// legacy: emitted by the pre-v1 parser; kept until confirmed no input produces these forms.
func lowerCondRHS(name string, ft ast.FieldType, rhs *ast.CondRHS) *turnoutpb.BindingModel {
	condRef := ""
	if ref, ok := rhs.Condition.(*ast.CondExprRef); ok {
		condRef = ref.BindingName
	}
	return &turnoutpb.BindingModel{
		Name: name,
		Type: ft.String(),
		Expr: &turnoutpb.ExprModel{Cond: &turnoutpb.CondExpr{
			Condition:  &turnoutpb.ArgModel{Ref: proto.String(condRef)},
			Then:       &turnoutpb.ArgModel{FuncRef: proto.String(rhs.Then)},
			ElseBranch: &turnoutpb.ArgModel{FuncRef: proto.String(rhs.Else)},
		}},
	}
}

// legacy: emitted by the pre-v1 parser; kept until confirmed no input produces these forms.
func lowerIfRHS(name string, ft ast.FieldType, rhs *ast.IfRHS, ds *diag.Diagnostics, bindingTypes map[string]ast.FieldType) []*turnoutpb.BindingModel {
	switch cond := rhs.Cond.(type) {
	case *ast.CondExprRef:
		return []*turnoutpb.BindingModel{{
			Name: name,
			Type: ft.String(),
			Expr: &turnoutpb.ExprModel{Cond: &turnoutpb.CondExpr{
				Condition:  &turnoutpb.ArgModel{Ref: proto.String(cond.BindingName)},
				Then:       &turnoutpb.ArgModel{FuncRef: proto.String(rhs.Then)},
				ElseBranch: &turnoutpb.ArgModel{FuncRef: proto.String(rhs.Else)},
			}},
		}}

	case *ast.CondExprCall:
		generatedName := GeneratedIfCondPrefix + name + GeneratedIfCondSuffix
		generatedBinding := &turnoutpb.BindingModel{
			Name: generatedName,
			Type: ast.FieldTypeBool.String(),
			Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
				Fn:   cond.FnAlias,
				Args: lowerArgsWithTypes(cond.Args, bindingTypes, ds),
			}},
		}
		mainBinding := &turnoutpb.BindingModel{
			Name: name,
			Type: ft.String(),
			Expr: &turnoutpb.ExprModel{Cond: &turnoutpb.CondExpr{
				Condition:  &turnoutpb.ArgModel{Ref: proto.String(generatedName)},
				Then:       &turnoutpb.ArgModel{FuncRef: proto.String(rhs.Then)},
				ElseBranch: &turnoutpb.ArgModel{FuncRef: proto.String(rhs.Else)},
			}},
		}
		return []*turnoutpb.BindingModel{generatedBinding, mainBinding}

	default:
		*ds = append(*ds, diag.ErrorAt(rhs.Pos.File, rhs.Pos.Line, rhs.Pos.Col,
			diag.CodeUnsupportedConstruct, "unsupported #if condition form for binding %q", name))
		return []*turnoutpb.BindingModel{{Name: name, Type: ft.String(), Value: literalToStructpb(zeroLiteralFor(ft))}}
	}
}

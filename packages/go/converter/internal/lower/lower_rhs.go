// lower_rhs.go lowers BindingRHS and Arg AST nodes to proto BindingModel expressions.
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
	return &turnoutpb.BindingModel{
		Name: name,
		Type: ft.String(),
		Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
			Fn:   rhs.Op.FnAliasForType(ft),
			Args: []*turnoutpb.ArgModel{lowerArgWithTypes(rhs.LHS, bindingTypes, ds), lowerArgWithTypes(rhs.RHS, bindingTypes, ds)},
		}},
	}
}


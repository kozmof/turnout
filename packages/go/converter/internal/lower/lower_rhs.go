// lower_rhs.go lowers BindingRHS and Arg AST nodes to proto BindingModel expressions.
package lower

import (
	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/fnmeta"
	"google.golang.org/protobuf/proto"
)

// ─────────────────────────────────────────────────────────────────────────────
// Shared operator-only guard
// ─────────────────────────────────────────────────────────────────────────────

// checkOperatorOnly appends a CodeOperatorOnlyFn diagnostic and returns true when
// fnAlias is restricted to infix syntax. Both lowerFuncCallRHS and
// localLowerer.lowerCallInto call this; neither encodes the message independently.
func checkOperatorOnly(bindingName, fnAlias string, pos ast.Pos, ds *diag.DiagSink) bool {
	if !fnmeta.IsOperatorOnly(fnAlias) {
		return false
	}
	ds.Append(diag.ErrorAt(pos.File, pos.Line, pos.Col,
		diag.CodeOperatorOnlyFn,
		"binding %q: %q is an operator-only function; use infix syntax instead (e.g. a %s b)",
		bindingName, fnAlias, fnmeta.OperatorSymbol(fnAlias)))
	return true
}

// ─────────────────────────────────────────────────────────────────────────────
// RHS-specific lowering functions
// ─────────────────────────────────────────────────────────────────────────────

func lowerLiteralRHS(name string, ft ast.FieldType, rhs *ast.LiteralRHS) *turnoutpb.BindingModel {
	return &turnoutpb.BindingModel{Name: name, Type: ft.String(), Value: ast.LiteralToStructpb(rhs.Value)}
}

func lowerPlaceholderRHS(name string, ft ast.FieldType, pos ast.Pos, resolver prepareResolver, ds *diag.DiagSink) *turnoutpb.BindingModel {
	val := resolver.resolveDefault(name, ft, pos, diag.CodeMissingPrepareEntry, ds)
	return &turnoutpb.BindingModel{Name: name, Type: ft.String(), Value: val}
}

// lowerBiDirInputRHS resolves the default value for a <~> binding. Missing
// prepare entries use the bidirectional-specific diagnostic code, but other
// resolver failures such as unresolved state paths still surface normally.
func lowerBiDirInputRHS(name string, ft ast.FieldType, pos ast.Pos, resolver prepareResolver, ds *diag.DiagSink) *turnoutpb.BindingModel {
	val := resolver.resolveDefault(name, ft, pos, diag.CodeBidirMissingPrepareEntry, ds)
	return &turnoutpb.BindingModel{Name: name, Type: ft.String(), Value: val}
}

// identityFnFor returns the identity binary-function name and its neutral-element
// argument for the given field type. Used by lowerSingleRefRHS and emitIdentity
// to avoid duplicating the type-switch logic.
func identityFnFor(ft ast.FieldType) (fn string, identityArg *turnoutpb.ArgModel) {
	switch ft {
	case ast.FieldTypeBool:
		fn = "bool_and"
	case ast.FieldTypeNumber:
		fn = "add"
	case ast.FieldTypeStr:
		fn = "str_concat"
	default: // arr<number>, arr<str>, arr<bool>
		fn = "arr_concat"
	}
	val, _ := fnmeta.IdentityValue(fn)
	return fn, &turnoutpb.ArgModel{Lit: val}
}

// lowerSingleRefRHS lowers `name:type = identifier` to an identity combine:
// fn(ref, identity_element). The validator's isIdentityCombine recognises this
// exact shape and exempts it from operatorOnly and empty-array-arg checks.
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

func lowerFuncCallRHS(name string, ft ast.FieldType, rhs *ast.FuncCallRHS, pos ast.Pos, bindingTypes map[string]ast.FieldType, ds *diag.DiagSink) *turnoutpb.BindingModel {
	if checkOperatorOnly(name, rhs.FnAlias, pos, ds) {
		return nil
	}
	return &turnoutpb.BindingModel{
		Name: name,
		Type: ft.String(),
		Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
			Fn:   rhs.FnAlias,
			Args: lowerArgsWithTypes(rhs.Args, bindingTypes, ds),
		}},
	}
}

func lowerInfixRHS(name string, ft ast.FieldType, rhs *ast.InfixRHS, bindingTypes map[string]ast.FieldType, ds *diag.DiagSink) *turnoutpb.BindingModel {
	return &turnoutpb.BindingModel{
		Name: name,
		Type: ft.String(),
		Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
			Fn:   rhs.Op.FnAliasForType(ft),
			Args: []*turnoutpb.ArgModel{lowerArgWithTypes(rhs.LHS, bindingTypes, ds), lowerArgWithTypes(rhs.RHS, bindingTypes, ds)},
		}},
	}
}

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
// argument for the given field type. Returns ok=false for FieldTypeInvalid or any
// unknown type so callers can emit a zero value instead of panicking.
func identityFnFor(ft ast.FieldType) (fn string, identityArg *turnoutpb.ArgModel, ok bool) {
	switch ft {
	case ast.FieldTypeBool:
		fn = "bool_and"
	case ast.FieldTypeNumber:
		fn = "add"
	case ast.FieldTypeStr:
		fn = "str_concat"
	case ast.FieldTypeArrNumber, ast.FieldTypeArrStr, ast.FieldTypeArrBool:
		fn = "arr_concat"
	default:
		return "", nil, false
	}
	val, _ := fnmeta.IdentityValue(fn)
	return fn, &turnoutpb.ArgModel{Lit: val}, true
}

// lowerSingleRefRHS lowers `name:type = identifier` to an identity combine:
// fn(ref, identity_element). The validator's isIdentityCombine recognises this
// exact shape and exempts it from operatorOnly and empty-array-arg checks.
// Returns nil when ft is FieldTypeInvalid (should have been caught upstream).
func lowerSingleRefRHS(name string, ft ast.FieldType, rhs *ast.SingleRefRHS) *turnoutpb.BindingModel {
	fn, identityArg, ok := identityFnFor(ft)
	if !ok {
		return nil
	}
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

// infixOpValidForType reports whether op is permitted for the given binding field type.
// ft is the binding's *declared result type*, not the operand type. Each operator has a
// fixed result type that must match the binding declaration:
//   - &, |, >=, <=, >, <, ==, != — result is bool; binding must declare bool
//   - -, *, /, % — result is number; binding must declare number
//   - + — type-dispatched: result is number or str; binding must match
func infixOpValidForType(op ast.InfixOp, ft ast.FieldType) bool {
	switch op {
	case ast.InfixAnd, ast.InfixBoolOr,
		ast.InfixGTE, ast.InfixLTE, ast.InfixGT, ast.InfixLT,
		ast.InfixEq, ast.InfixNeq:
		return ft == ast.FieldTypeBool
	case ast.InfixSub, ast.InfixMul, ast.InfixDiv, ast.InfixMod:
		return ft == ast.FieldTypeNumber
	case ast.InfixPlus:
		return ft == ast.FieldTypeNumber || ft == ast.FieldTypeStr
	default:
		return false
	}
}

func lowerInfixRHS(name string, ft ast.FieldType, rhs *ast.InfixRHS, bindingTypes map[string]ast.FieldType, ds *diag.DiagSink) *turnoutpb.BindingModel {
	if !infixOpValidForType(rhs.Op, ft) {
		ds.Append(diag.Errorf(diag.CodeInvalidInfixExpr,
			"binding %q: operator %s is not valid for type %s", name, rhs.Op, ft))
		return nil
	}
	return &turnoutpb.BindingModel{
		Name: name,
		Type: ft.String(),
		Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
			Fn:   rhs.Op.FnAliasForType(ft),
			Args: []*turnoutpb.ArgModel{lowerArgWithTypes(rhs.LHS, bindingTypes, ds), lowerArgWithTypes(rhs.RHS, bindingTypes, ds)},
		}},
	}
}

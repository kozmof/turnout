// lower_rhs.go lowers BindingRHS and Arg AST nodes to proto BindingModel expressions.
package lower

import (
	"fmt"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/fnmeta"
	"github.com/kozmof/turnout/packages/go/converter/internal/names"
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

// unsupportedFnAliases is the set of function aliases that are reserved for a
// future DSL version but not yet implemented. They produce CodeUnsupportedConstruct
// rather than CodeUnknownFnAlias so the error message is clearly actionable.
// Both lowerFuncCallRHS and localLowerer.lowerCallInto call checkUnsupportedFn.
var unsupportedFnAliases = map[string]bool{
	"range":  true,
	"map":    true,
	"filter": true,
	"fold":   true,
}

// checkUnsupportedFn appends a CodeUnsupportedConstruct diagnostic and returns
// true when fnAlias is a planned but not-yet-implemented function. Callers must
// return or emit a zero-value binding when this returns true.
func checkUnsupportedFn(bindingName, fnAlias string, pos ast.Pos, ds *diag.DiagSink) bool {
	if !unsupportedFnAliases[fnAlias] {
		return false
	}
	ds.Append(diag.ErrorAt(pos.File, pos.Line, pos.Col,
		diag.CodeUnsupportedConstruct,
		"binding %q: %q is not yet supported; array higher-order functions (range, map, filter, fold) are planned for a future DSL version",
		bindingName, fnAlias))
	return true
}

// ─────────────────────────────────────────────────────────────────────────────
// RHS-specific lowering functions
// ─────────────────────────────────────────────────────────────────────────────

func lowerLiteralRHS(name string, ft ast.FieldType, rhs *ast.LiteralRHS) *turnoutpb.BindingModel {
	return &turnoutpb.BindingModel{Name: name, Type: ft.ProtoString(), Value: ast.LiteralToStructpb(rhs.Value)}
}

func lowerPlaceholderRHS(name string, ft ast.FieldType, pos ast.Pos, resolver prepareResolver, ds *diag.DiagSink) *turnoutpb.BindingModel {
	val := resolver.resolveDefault(name, ft, pos, ds)
	return &turnoutpb.BindingModel{Name: name, Type: ft.ProtoString(), Value: val}
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
		Type: ft.ProtoString(),
		Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
			Fn:   fn,
			Args: []*turnoutpb.ArgModel{{Ref: proto.String(rhs.RefName)}, identityArg},
		}},
	}
}

func lowerFuncCallRHS(name string, ft ast.FieldType, rhs *ast.FuncCallRHS, pos ast.Pos, bindingTypes map[string]ast.FieldType, ds *diag.DiagSink) *turnoutpb.BindingModel {
	if checkUnsupportedFn(name, rhs.FnAlias, pos, ds) {
		return nil
	}
	if checkOperatorOnly(name, rhs.FnAlias, pos, ds) {
		return nil
	}
	return &turnoutpb.BindingModel{
		Name: name,
		Type: ft.ProtoString(),
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
		panic(fmt.Sprintf("infixOpValidForType: unhandled InfixOp %v — add a case when adding new InfixOp values", op))
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
		Type: ft.ProtoString(),
		Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
			Fn:   rhs.Op.FnAliasForType(ft),
			Args: []*turnoutpb.ArgModel{lowerArgWithTypes(rhs.LHS, bindingTypes, ds), lowerArgWithTypes(rhs.RHS, bindingTypes, ds)},
		}},
	}
}

// lowerTransformRHS lowers a standalone transform chain to the identity combine
// fn(transform, identity_element) — the same shape lowerSingleRefRHS produces for
// a bare reference, and the same shape the `rate.floor() + 0` idiom produced by
// hand. isIdentityCombine in the validator recognises it and exempts it from the
// operatorOnly and empty-array-arg checks.
func lowerTransformRHS(name string, ft ast.FieldType, rhs *ast.TransformRHS, bindingTypes map[string]ast.FieldType, ds *diag.DiagSink) *turnoutpb.BindingModel {
	fn, identityArg, ok := identityFnFor(ft)
	if !ok {
		ds.Append(diag.ErrorAt(rhs.Pos.File, rhs.Pos.Line, rhs.Pos.Col,
			diag.CodeTypeMismatch,
			"binding %q: type %s is not valid for a standalone transform binding", name, ft))
		return nil
	}
	return &turnoutpb.BindingModel{
		Name: name,
		Type: ft.ProtoString(),
		Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
			Fn:   fn,
			Args: []*turnoutpb.ArgModel{lowerArgWithTypes(rhs.Arg, bindingTypes, ds), identityArg},
		}},
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Nested infix
// ─────────────────────────────────────────────────────────────────────────────

// nestedInfixLowerer flattens a NestedInfixRHS tree into a binding sequence.
// Each operator becomes one binding; operands that are themselves operators are
// emitted first under a generated name and referenced by it.
//
// Synthetic names come from names.LocalName, the same generator the local-expr
// lowerer uses, so names.IsGeneratedLocalName continues to recognise every
// compiler-produced binding.
type nestedInfixLowerer struct {
	target       string
	bindingTypes map[string]ast.FieldType
	ds           *diag.DiagSink
	counter      *int
	bindings     []*turnoutpb.BindingModel
}

func lowerNestedInfixRHS(name string, ft ast.FieldType, rhs *ast.NestedInfixRHS, bindingTypes map[string]ast.FieldType, ds *diag.DiagSink, counter *int) []*turnoutpb.BindingModel {
	l := &nestedInfixLowerer{target: name, bindingTypes: bindingTypes, ds: ds, counter: counter}
	l.lowerBranchInto(name, ft, rhs.Root)
	return l.bindings
}

func (l *nestedInfixLowerer) temp(hint string) string {
	name := names.LocalName(l.target, hint, *l.counter)
	*l.counter++
	return name
}

// lowerNodeArg resolves one operand to an ArgModel. Terminal operands inline
// exactly as they do in lowerInfixRHS; operator operands are lowered into a temp
// binding first, so the temp is always emitted before the binding referencing it.
func (l *nestedInfixLowerer) lowerNodeArg(node ast.InfixNode, hint string, ft ast.FieldType) *turnoutpb.ArgModel {
	switch n := node.(type) {
	case *ast.InfixLeaf:
		return lowerArgWithTypes(n.Arg, l.bindingTypes, l.ds)
	case *ast.InfixBranch:
		tmp := l.temp(hint)
		l.lowerBranchInto(tmp, ft, n)
		return &turnoutpb.ArgModel{Ref: proto.String(tmp)}
	default:
		l.ds.Append(diag.Errorf(diag.CodeInternalError,
			"binding %q: unhandled infix node type %T — this is a compiler bug; please report the source file", l.target, node))
		return &turnoutpb.ArgModel{}
	}
}

func (l *nestedInfixLowerer) lowerBranchInto(name string, ft ast.FieldType, b *ast.InfixBranch) {
	if !infixOpValidForType(b.Op, ft) {
		l.ds.Append(diag.ErrorAt(b.Pos.File, b.Pos.Line, b.Pos.Col,
			diag.CodeInvalidInfixExpr,
			"binding %q: operator %s is not valid for type %s", l.target, b.Op, ft))
		return
	}
	fn := b.Op.FnAliasForType(ft)
	leftType, rightType, ok := fnmeta.OperandTypes(fn, ft)
	if !ok {
		l.ds.Append(diag.ErrorAt(b.Pos.File, b.Pos.Line, b.Pos.Col,
			diag.CodeInternalError,
			"binding %q: infix operator maps to unknown function %q — this is a compiler bug; please report the source file", l.target, fn))
		return
	}
	left := l.lowerNodeArg(b.LHS, "lhs", leftType)
	right := l.lowerNodeArg(b.RHS, "rhs", rightType)
	l.bindings = append(l.bindings, &turnoutpb.BindingModel{
		Name: name,
		Type: ft.ProtoString(),
		Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
			Fn:   fn,
			Args: []*turnoutpb.ArgModel{left, right},
		}},
	})
}

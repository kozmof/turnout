package validate

import (
	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/fnmeta"
)

// ─────────────────────────────────────────────────────────────────────────────
// Extended local expression validation (#if / #case / #pipe / #it)
//
// validateExtExprProto walks a proto LocalExprModel directly, avoiding any
// round-trip allocation through ast.LocalExpr nodes. The scalar type helpers
// (validateBinaryArgTypePair, resolveLocalCallReturn, etc.) are shared with
// the AST validators below.
// ─────────────────────────────────────────────────────────────────────────────

func validateExtExprProto(b *turnoutpb.BindingModel, e *turnoutpb.LocalExprModel, scope map[string]bindingInfo, ds *diag.DiagSink) {
	sl := mapScope(scope)
	var ret ast.FieldType = ast.FieldTypeInvalid
	var known bool
	switch x := e.Expr.(type) {
	case *turnoutpb.LocalExprModel_IfExpr:
		ret, known = validateProtoLocalIf(b.Name, x.IfExpr.GetCond(), x.IfExpr.GetThen(), x.IfExpr.GetElseBranch(), sl, 0, false, ds)
	case *turnoutpb.LocalExprModel_CaseExpr:
		ret, known = validateProtoLocalCase(b.Name, x.CaseExpr.GetSubject(), x.CaseExpr.GetArms(), sl, 0, false, ds)
	case *turnoutpb.LocalExprModel_PipeExpr:
		ret, known = validateProtoLocalPipe(b.Name, x.PipeExpr.GetInitial(), x.PipeExpr.GetSteps(), sl, 0, false, ds)
	case *turnoutpb.LocalExprModel_Infix:
		ret, known = validateProtoLocalInfix(b.Name, ast.InfixOp(x.Infix.GetOp()), x.Infix.GetLhs(), x.Infix.GetRhs(), sl, 0, false, ds)
	default:
		ds.Append(diag.Errorf(diag.CodeUnsupportedConstruct,
			"binding %q: unsupported extended expression type %T", b.Name, e.Expr))
		return
	}
	if known {
		bFt, ftOK := ast.FieldTypeFromString(b.Type)
		if !ftOK {
			ds.Append(diag.Errorf(diag.CodeTypeMismatch,
				"binding %q: unknown type string %q", b.Name, b.Type))
			return
		}
		if ret != bFt {
			ds.Append(diag.Errorf(diag.CodeReturnTypeMismatch,
				"binding %q: extended expression returns %s but binding declares type %s",
				b.Name, ret, b.Type))
		}
	}
}

func validateProtoLocalExpr(bindingName string, e *turnoutpb.LocalExprModel, scope scopeLookup, itType ast.FieldType, itAllowed bool, ds *diag.DiagSink) (ast.FieldType, bool) {
	if e == nil {
		return 0, false
	}
	switch x := e.Expr.(type) {
	case *turnoutpb.LocalExprModel_Ref:
		name := x.Ref.GetName()
		info, ok := scope.get(name)
		if !ok {
			ds.Append(diag.Errorf(diag.CodeUndefinedRef,
				"binding %q: reference %q is not defined", bindingName, name))
			return 0, false
		}
		return info.fieldType, true
	case *turnoutpb.LocalExprModel_Lit:
		ft, ok := structpbFieldType(x.Lit.GetValue())
		return ft, ok
	case *turnoutpb.LocalExprModel_It:
		if !itAllowed {
			ds.Append(diag.Errorf(diag.CodeUnsupportedConstruct,
				"binding %q: #it is only valid inside #pipe step expressions", bindingName))
			return 0, false
		}
		if itType == 0 {
			return 0, false
		}
		return itType, true
	case *turnoutpb.LocalExprModel_Call:
		return validateProtoLocalCallExpr(bindingName, x.Call.GetFn(), x.Call.GetArgs(), scope, itType, itAllowed, ds)
	case *turnoutpb.LocalExprModel_Infix:
		return validateProtoLocalInfix(bindingName, ast.InfixOp(x.Infix.GetOp()), x.Infix.GetLhs(), x.Infix.GetRhs(), scope, itType, itAllowed, ds)
	case *turnoutpb.LocalExprModel_IfExpr:
		return validateProtoLocalIf(bindingName, x.IfExpr.GetCond(), x.IfExpr.GetThen(), x.IfExpr.GetElseBranch(), scope, itType, itAllowed, ds)
	case *turnoutpb.LocalExprModel_CaseExpr:
		return validateProtoLocalCase(bindingName, x.CaseExpr.GetSubject(), x.CaseExpr.GetArms(), scope, itType, itAllowed, ds)
	case *turnoutpb.LocalExprModel_PipeExpr:
		return validateProtoLocalPipe(bindingName, x.PipeExpr.GetInitial(), x.PipeExpr.GetSteps(), scope, itType, itAllowed, ds)
	default:
		ds.Append(diag.Errorf(diag.CodeUnsupportedConstruct,
			"binding %q: unsupported local expression type %T", bindingName, e.Expr))
		return 0, false
	}
}

func validateProtoLocalCallExpr(bindingName, fn string, args []*turnoutpb.LocalExprModel, scope scopeLookup, itType ast.FieldType, itAllowed bool, ds *diag.DiagSink) (ast.FieldType, bool) {
	spec, ok := fnmeta.BuiltinFn(fn)
	if !ok {
		ds.Append(diag.Errorf(diag.CodeUnknownFnAlias,
			"binding %q: unknown function alias %q", bindingName, fn))
		return 0, false
	}
	types := make([]ast.FieldType, len(args))
	known := make([]bool, len(args))
	for i, arg := range args {
		types[i], known[i] = validateProtoLocalExpr(bindingName, arg, scope, itType, itAllowed, ds)
	}
	validateLocalCallArgTypes(bindingName, fn, spec, types, known, ds)
	return resolveLocalCallReturn(spec, types, known)
}

func validateProtoLocalInfix(bindingName string, op ast.InfixOp, lhs, rhs *turnoutpb.LocalExprModel, scope scopeLookup, itType ast.FieldType, itAllowed bool, ds *diag.DiagSink) (ast.FieldType, bool) {
	lhsType, lhsOK := validateProtoLocalExpr(bindingName, lhs, scope, itType, itAllowed, ds)
	rhsType, rhsOK := validateProtoLocalExpr(bindingName, rhs, scope, itType, itAllowed, ds)
	// InfixPlus dispatches to "str_concat" or "add" based on the LHS type.
	// When the LHS type is unknown (e.g. undefined ref) we cannot resolve the
	// dispatch and any arg-type check would use "add" as the default, producing
	// a spurious ArgTypeMismatch if the RHS happens to be str. Skip validation.
	if op == ast.InfixPlus && !lhsOK {
		return 0, false
	}
	// FnAliasForType resolves InfixPlus to "str_concat" or "add" based on the
	// inferred lhs type. For all other operators it returns their fixed alias.
	// Argument type errors (e.g. lhs str but rhs number for +) are caught below.
	fn := op.FnAliasForType(lhsType)
	spec, ok := fnmeta.BuiltinFn(fn)
	if !ok {
		return ast.FieldTypeInvalid, false
	}
	validateLocalCallArgTypes(bindingName, fn, spec, []ast.FieldType{lhsType, rhsType}, []bool{lhsOK, rhsOK}, ds)
	return resolveLocalCallReturn(spec, []ast.FieldType{lhsType, rhsType}, []bool{lhsOK, rhsOK})
}

func validateProtoLocalIf(bindingName string, cond, thenExpr, elseExpr *turnoutpb.LocalExprModel, scope scopeLookup, itType ast.FieldType, itAllowed bool, ds *diag.DiagSink) (ast.FieldType, bool) {
	condType, condOK := validateProtoLocalExpr(bindingName, cond, scope, itType, itAllowed, ds)
	if condOK && condType != ast.FieldTypeBool {
		ds.Append(diag.Errorf(diag.CodeCondNotBool,
			"binding %q: #if condition has type %s; bool required", bindingName, condType))
	}
	thenType, thenOK := validateProtoLocalExpr(bindingName, thenExpr, scope, itType, itAllowed, ds)
	elseType, elseOK := validateProtoLocalExpr(bindingName, elseExpr, scope, itType, itAllowed, ds)
	if thenOK && elseOK && thenType != elseType {
		ds.Append(diag.Errorf(diag.CodeBranchTypeMismatch,
			"binding %q: #if branches return %s and %s", bindingName, thenType, elseType))
		return 0, false
	}
	if thenOK {
		return thenType, true
	}
	if elseOK {
		return elseType, true
	}
	return 0, false
}

func validateProtoLocalCase(bindingName string, subject *turnoutpb.LocalExprModel, arms []*turnoutpb.LocalCaseArmModel, scope scopeLookup, itType ast.FieldType, itAllowed bool, ds *diag.DiagSink) (ast.FieldType, bool) {
	subjectType, subjectOK := validateProtoLocalExpr(bindingName, subject, scope, itType, itAllowed, ds)
	var ret ast.FieldType = ast.FieldTypeInvalid
	retOK := false
	for _, arm := range arms {
		armScope := protoPatternScopeBindings(scope, arm.GetPattern(), subjectType, subjectOK)
		validateProtoPattern(bindingName, arm.GetPattern(), subjectType, subjectOK, ds)
		if arm.GetGuard() != nil {
			guardType, guardOK := validateProtoLocalExpr(bindingName, arm.GetGuard(), armScope, itType, itAllowed, ds)
			if guardOK && guardType != ast.FieldTypeBool {
				ds.Append(diag.Errorf(diag.CodeCondNotBool,
					"binding %q: #case guard has type %s; bool required", bindingName, guardType))
			}
		}
		armType, armOK := validateProtoLocalExpr(bindingName, arm.GetExpr(), armScope, itType, itAllowed, ds)
		if !armOK {
			continue
		}
		if retOK && armType != ret {
			ds.Append(diag.Errorf(diag.CodeBranchTypeMismatch,
				"binding %q: #case arms return %s and %s", bindingName, ret, armType))
			continue
		}
		ret = armType
		retOK = true
	}
	return ret, retOK
}

func validateProtoLocalPipe(bindingName string, initial *turnoutpb.LocalExprModel, steps []*turnoutpb.LocalExprModel, scope scopeLookup, itType ast.FieldType, itAllowed bool, ds *diag.DiagSink) (ast.FieldType, bool) {
	current, known := validateProtoLocalExpr(bindingName, initial, scope, itType, itAllowed, ds)
	for _, step := range steps {
		stepType, stepOK := validateProtoLocalExpr(bindingName, step, scope, current, true, ds)
		current, known = stepType, stepOK
	}
	return current, known
}

func validateProtoPattern(bindingName string, p *turnoutpb.LocalCasePatternModel, subjectType ast.FieldType, subjectKnown bool, ds *diag.DiagSink) {
	if p == nil {
		return
	}
	switch x := p.Pattern.(type) {
	case *turnoutpb.LocalCasePatternModel_Lit:
		patternType, ok := structpbFieldType(x.Lit.GetValue())
		if ok && subjectKnown && patternType != subjectType {
			ds.Append(diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: #case literal pattern has type %s but subject has type %s",
				bindingName, patternType, subjectType))
		}
	}
}

func protoPatternScopeBindings(scope scopeLookup, p *turnoutpb.LocalCasePatternModel, subjectType ast.FieldType, subjectKnown bool) scopeLookup {
	if p == nil {
		return scope
	}
	switch x := p.Pattern.(type) {
	case *turnoutpb.LocalCasePatternModel_VarBinder:
		if subjectKnown {
			return &scopeChain{name: x.VarBinder.GetName(), info: bindingInfo{fieldType: subjectType}, parent: scope}
		}
	}
	return scope
}

// validateBinaryArgTypePair checks the two operand types of a binary function
// against the fn spec. Shared by validateLocalCallArgTypes and validateCombineArgTypes.
func validateBinaryArgTypePair(bindingName, fn string, spec fnmeta.FnSpec, t1 ast.FieldType, ok1 bool, t2 ast.FieldType, ok2 bool, ds *diag.DiagSink) {
	switch spec.Kind {
	case fnmeta.FnKindGeneric:
		if ok1 && ok2 && t1 != t2 {
			ds.Append(diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: %s requires homogeneous operand types, got %s and %s", bindingName, fn, t1, t2))
		}
	case fnmeta.FnKindArrGet:
		if ok1 && !t1.IsArray() {
			ds.Append(diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: arr_get arg1 must be an array type, got %s", bindingName, t1))
		}
		if ok2 && t2 != ast.FieldTypeNumber {
			ds.Append(diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: arr_get arg2 must be number, got %s", bindingName, t2))
		}
	case fnmeta.FnKindArrInc:
		if ok1 && !t1.IsArray() {
			ds.Append(diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: arr_includes arg1 must be an array type, got %s", bindingName, t1))
		}
		if ok1 && ok2 && t1.IsArray() && t2 != t1.ElemType() {
			ds.Append(diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: arr_includes arg2 type %s does not match array element type %s",
				bindingName, t2, t1.ElemType()))
		}
	case fnmeta.FnKindArrConcat:
		if ok1 && !t1.IsArray() {
			ds.Append(diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: arr_concat arg1 must be an array type, got %s", bindingName, t1))
		}
		if ok1 && ok2 && t1 != t2 {
			ds.Append(diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: arr_concat args must have same array type, got %s and %s", bindingName, t1, t2))
		}
	default:
		// Handles FnKindStandard (operand types statically declared in the spec)
		// and any unrecognised FnKind added in future. StaticArgTypes returns
		// (Invalid, Invalid, false) for all non-Standard kinds, so the checks
		// below are skipped for unknown kinds rather than silently comparing
		// against FieldTypeInvalid.
		a1, a2, staticOK := spec.StaticArgTypes()
		if staticOK {
			if ok1 && t1 != a1 {
				ds.Append(diag.Errorf(diag.CodeArgTypeMismatch,
					"binding %q: %s arg1 expects %s, got %s", bindingName, fn, a1, t1))
			}
			if ok2 && t2 != a2 {
				ds.Append(diag.Errorf(diag.CodeArgTypeMismatch,
					"binding %q: %s arg2 expects %s, got %s", bindingName, fn, a2, t2))
			}
		}
	}
}

func validateLocalCallArgTypes(bindingName, fn string, spec fnmeta.FnSpec, types []ast.FieldType, known []bool, ds *diag.DiagSink) {
	if len(types) != fnmeta.BinaryArity {
		ds.Append(diag.Errorf(diag.CodeInvalidBinaryArgShape,
			"binding %q: function %q requires exactly %d argument(s), got %d",
			bindingName, fn, fnmeta.BinaryArity, len(types)))
		return
	}
	validateBinaryArgTypePair(bindingName, fn, spec, types[0], known[0], types[1], known[1], ds)
}

func resolveLocalCallReturn(spec fnmeta.FnSpec, types []ast.FieldType, known []bool) (ast.FieldType, bool) {
	switch spec.Kind {
	case fnmeta.FnKindGeneric, fnmeta.FnKindArrInc:
		return ast.FieldTypeBool, true
	case fnmeta.FnKindArrGet:
		if len(types) >= 1 && known[0] && types[0].IsArray() {
			return types[0].ElemType(), true
		}
		return 0, false
	case fnmeta.FnKindArrConcat:
		if len(types) >= 1 && known[0] {
			return types[0], true
		}
		return 0, false
	default:
		return spec.ReturnType, true
	}
}

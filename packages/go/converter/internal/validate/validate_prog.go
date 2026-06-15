package validate

import (
	"strings"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/fnmeta"
	"github.com/kozmof/turnout/packages/go/converter/internal/localexpr"
	"github.com/kozmof/turnout/packages/go/converter/internal/names"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
)

// ─────────────────────────────────────────────────────────────────────────────
// Group B — Prog / binding validation
// ─────────────────────────────────────────────────────────────────────────────

// ── Scope lookup abstraction ─────────────────────────────────────────────────
//
// scopeLookup is a read-only view of a binding scope. It is implemented by
// mapScope (a plain map wrapper) and scopeChain (a linked-scope for #case
// var-binder arms). Using an interface avoids O(n) map copies per arm.

type scopeLookup interface {
	get(name string) (bindingInfo, bool)
}

// mapScope wraps a flat map[string]bindingInfo so it satisfies scopeLookup.
type mapScope map[string]bindingInfo

func (m mapScope) get(name string) (bindingInfo, bool) {
	v, ok := m[name]
	return v, ok
}

// scopeChain extends a parent scopeLookup with a single local binding.
// It is created by protoPatternScopeBindings for var-binder case arms.
type scopeChain struct {
	name   string
	info   bindingInfo
	parent scopeLookup
}

func (c *scopeChain) get(name string) (bindingInfo, bool) {
	if name == c.name {
		return c.info, true
	}
	return c.parent.get(name)
}

// progValidateCtx bundles the stable context fields threaded through prog
// validation: schema and scene/action identity.
type progValidateCtx struct {
	schema   state.Schema
	sceneID  string
	actionID string
}

func validateProg(prog *turnoutpb.ProgModel, ctx progValidateCtx, isTransition bool, root string, mergeNames []string, ds *diag.DiagSink) map[string]bindingInfo {
	if prog == nil {
		return map[string]bindingInfo{}
	}
	posMap := buildPosMap(prog.Bindings)
	scope, dependencies := buildBindingScope(prog, ds)
	acyclic := detectCycles(prog.Name, dependencies, prog.Bindings, posMap, ds)
	validateBindingTypes(prog, scope, isTransition, posMap, ds)
	if !isTransition && root != "" {
		detectUnusedBindings(prog.Name, root, mergeNames, prog.Bindings, dependencies, acyclic, posMap, ds)
	}
	return scope
}

// detectUnusedBindings warns about bindings that are not reachable from the
// compute root or any merge/condition exit node. It performs a DFS forward
// through the dependency graph (dependencies[b] = list of bindings that b depends on)
// starting from exit nodes, then flags any binding not reached.
// Generated internal names (prefixed with __if_ or __local_) are skipped.
// acyclic is the set of non-cyclic binding names returned by detectCycles;
// cyclic bindings are skipped here because they already carry a CodeCyclicBinding error.
func detectUnusedBindings(progName, root string, mergeNames []string, bindings []*turnoutpb.BindingModel, dependencies map[string][]string, acyclic map[string]bool, posMap map[string]ast.Pos, ds *diag.DiagSink) {
	reachable := make(map[string]bool, len(bindings))
	var mark func(string)
	mark = func(name string) {
		if reachable[name] {
			return
		}
		reachable[name] = true
		for _, dep := range dependencies[name] {
			mark(dep)
		}
	}
	mark(root)
	for _, n := range mergeNames {
		mark(n)
	}
	for _, b := range bindings {
		if reachable[b.Name] {
			continue
		}
		if !acyclic[b.Name] {
			// Already reported as a cycle error; suppress the redundant unused warning.
			continue
		}
		if names.IsGeneratedIfCondName(b.Name) || names.IsGeneratedLocalName(b.Name) {
			continue
		}
		pos := posMap[b.Name]
		ds.Append(diag.WarnAt(pos.File, pos.Line, pos.Col, diag.CodeUnusedBinding,
			"prog %q: binding %q is declared but never used", progName, b.Name))
	}
}

// buildBindingScope registers all bindings into the scope map, detects duplicate
// names, records sigils, and builds the dependency map used by detectCycles.
// dependencies[b] is the list of binding names that b directly depends on.
func buildBindingScope(prog *turnoutpb.ProgModel, ds *diag.DiagSink) (map[string]bindingInfo, map[string][]string) {
	scope := make(map[string]bindingInfo, len(prog.Bindings))
	dependencies := make(map[string][]string, len(prog.Bindings))
	seen := make(map[string]bool, len(prog.Bindings))
	for _, b := range prog.Bindings {
		if seen[b.Name] {
			ds.Append(diag.Errorf(diag.CodeDuplicateBinding,
				"duplicate binding name %q in prog %q", b.Name, prog.Name))
		} else {
			seen[b.Name] = true
		}
		ft, ftOK := ast.FieldTypeFromString(b.Type)
		if !ftOK {
			ds.Append(diag.Errorf(diag.CodeTypeMismatch,
				"binding %q: unknown type string %q", b.Name, b.Type))
			continue
		}
		sigil := ast.SigilFromInt32(prog.Sigils[b.Name])
		scope[b.Name] = bindingInfo{
			fieldType: ft,
			kind:      bindingKindFor(b),
			sigil:     sigil,
		}
		var refs []string
		if b.Expr != nil {
			collectExprBindingRefs(b.Expr, &refs)
		} else if b.ExtExpr != nil {
			collectLocalExprBindingRefs(b.ExtExpr, &refs)
		}
		// Deduplicate refs so that Kahn's dependentCount counts each dependency once,
		// regardless of how many times a binding name appears in function arguments.
		if len(refs) > 1 {
			refSeen := make(map[string]struct{}, len(refs))
			unique := make([]string, 0, len(refs))
			for _, r := range refs {
				if _, ok := refSeen[r]; !ok {
					refSeen[r] = struct{}{}
					unique = append(unique, r)
				}
			}
			refs = unique
		}
		dependencies[b.Name] = refs
	}
	return scope, dependencies
}

// validateBindingTypes runs per-binding structural and type checks against the
// already-built scope. Handles reserved names, transition sigil constraints,
// literal type conformance, and expr/ext_expr type checking.
func validateBindingTypes(prog *turnoutpb.ProgModel, scope map[string]bindingInfo, isTransition bool, posMap map[string]ast.Pos, ds *diag.DiagSink) {
	for _, b := range prog.Bindings {
		ft, ftOK := ast.FieldTypeFromString(b.Type)
		if !ftOK {
			ds.Append(diag.Errorf(diag.CodeTypeMismatch,
				"binding %q: unknown type string %q", b.Name, b.Type))
			continue
		}
		sigil := ast.SigilFromInt32(prog.Sigils[b.Name])
		pos := posMap[b.Name]

		if strings.HasPrefix(b.Name, "__") {
			if !names.IsGeneratedIfCondName(b.Name) && !names.IsGeneratedLocalName(b.Name) {
				ds.Append(diag.Errorf(diag.CodeReservedName,
					"binding %q: names starting with __ are reserved", b.Name))
			}
		}

		if isTransition && (sigil == ast.SigilEgress || sigil == ast.SigilBiDir) {
			if pos.File != "" {
				ds.Append(diag.ErrorAt(pos.File, pos.Line, pos.Col, diag.CodeTransitionOutputSigil,
					"binding %q: output sigil %s is not allowed in transition progs", b.Name, sigil))
			} else {
				ds.Append(diag.Errorf(diag.CodeTransitionOutputSigil,
					"binding %q: output sigil %s is not allowed in transition progs", b.Name, sigil))
			}
		}

		// For #if/#case/#pipe root bindings the lowerer sets both Expr (consumed
		// by the TS runtime executor) and ExtExpr (used only for HCL emission).
		// When ExtExpr is present, validate against the structured tree and skip
		// the flat-Expr path — the two encode the same semantics and would
		// produce duplicate diagnostics if both were checked.
		if b.ExtExpr != nil {
			validateNoEmptyArrayLitArgs(b, ds)
			validateExtExprProto(b, b.ExtExpr, scope, ds)
			continue
		}

		if b.Value != nil {
			if !structpbMatchesFieldType(b.Value, ft) {
				if pos.File != "" {
					ds.Append(diag.ErrorAt(pos.File, pos.Line, pos.Col, diag.CodeTypeMismatch,
						"binding %q: literal value does not match declared type %s", b.Name, b.Type))
				} else {
					ds.Append(diag.Errorf(diag.CodeTypeMismatch,
						"binding %q: literal value does not match declared type %s", b.Name, b.Type))
				}
			}
			if ft.IsArray() {
				validateArrayLiteral(b.Value, ft, b.Name, ds)
			}
		}

		if b.Expr != nil {
			validateNoEmptyArrayLitArgs(b, ds)
			switch {
			case b.Expr.Combine != nil:
				validateCombine(b, b.Expr.Combine, scope, ds)
			case b.Expr.Pipe != nil:
				validatePipe(b, b.Expr.Pipe, scope, ds)
			case b.Expr.Cond != nil:
				validateCond(b, b.Expr.Cond, scope, ds)
			}
		}
	}
}

func posFromProto(sp *turnoutpb.SourcePos) ast.Pos {
	if sp == nil {
		return ast.Pos{}
	}
	return ast.Pos{File: sp.File, Line: int(sp.Line), Col: int(sp.Col)}
}

func buildPosMap(bindings []*turnoutpb.BindingModel) map[string]ast.Pos {
	m := make(map[string]ast.Pos, len(bindings))
	for _, b := range bindings {
		if b.SourcePos != nil {
			m[b.Name] = posFromProto(b.SourcePos)
		}
	}
	return m
}

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
		// FnKindStandard: operand types are statically declared in the spec.
		// StaticArgTypes returns (Invalid, Invalid, false) for any unrecognised
		// future FnKind, causing the checks below to be skipped rather than
		// silently comparing against FieldTypeInvalid.
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

// ─────────────────────────────────────────────────────────────────────────────
// Binding cycle detection
// ─────────────────────────────────────────────────────────────────────────────

// detectCycles reports a CodeCyclicBinding diagnostic for each binding that
// participates in a reference cycle. Cycles cause infinite recursion in the
// TypeScript runtime's buildExecutionTree and must be caught at validation time.
//
// Returns the set of acyclic binding names (those successfully processed by
// Kahn's algorithm). Callers can use this set to skip cyclic bindings in
// subsequent passes (e.g. detectUnusedBindings) without repeating the topology work.
//
// Algorithm: Kahn's topological sort on the dependency graph.
// dependencies[b] = bindings that b depends on, so dependentCount tracks how
// many bindings depend on each node. Nodes with dependentCount 0 have no
// consumers and are dequeued first (consumer-first order — reverse of execution order).
// This direction is non-standard but cycle detection is direction-agnostic:
// a cycle in the dependency graph is the same cycle in its reverse.
// Nodes never dequeued are in cycles. A secondary targeted DFS over those
// nodes extracts one example cycle path for the error message.
func detectCycles(progName string, dependencies map[string][]string, bindings []*turnoutpb.BindingModel, posMap map[string]ast.Pos, ds *diag.DiagSink) map[string]bool {
	// --- Phase 1: Kahn's algorithm ---
	dependentCount := make(map[string]int, len(bindings))
	for _, b := range bindings {
		if _, ok := dependentCount[b.Name]; !ok {
			dependentCount[b.Name] = 0
		}
		for _, dep := range dependencies[b.Name] {
			dependentCount[dep]++
		}
	}

	queue := make([]string, 0, len(bindings))
	for _, b := range bindings {
		if dependentCount[b.Name] == 0 {
			queue = append(queue, b.Name)
		}
	}

	processed := make(map[string]bool, len(bindings))
	for head := 0; head < len(queue); head++ {
		n := queue[head]
		processed[n] = true
		for _, dep := range dependencies[n] {
			dependentCount[dep]--
			if dependentCount[dep] == 0 {
				queue = append(queue, dep)
			}
		}
	}

	// Nodes not processed are in cycles.
	cyclic := make(map[string]bool)
	for _, b := range bindings {
		if !processed[b.Name] {
			cyclic[b.Name] = true
		}
	}
	if len(cyclic) == 0 {
		return processed
	}

	// --- Phase 2: extract one example cycle path per cycle via iterative DFS ---
	//
	// Each frame tracks the node being visited and the index of the next dependency
	// to explore. On first visit (depIdx == 0) the node is pushed onto pathStack and
	// coloured inStack. When all deps are exhausted the node is coloured done and
	// popped from pathStack. A back-edge (dep already inStack) identifies the cycle
	// entry point; we extract the cycle segment from pathStack at that point.
	type dfsFrame struct {
		name   string
		depIdx int
	}

	reported := make(map[string]bool)
	color := make(map[string]int) // 0=unvisited 1=inStack 2=done
	pathStack := make([]string, 0, len(cyclic))
	frameStack := make([]dfsFrame, 0, len(cyclic))

	for _, b := range bindings {
		if !cyclic[b.Name] || color[b.Name] != 0 {
			continue
		}
		frameStack = append(frameStack, dfsFrame{name: b.Name, depIdx: 0})
		for len(frameStack) > 0 {
			top := &frameStack[len(frameStack)-1]
			name := top.name
			if top.depIdx == 0 {
				// First visit: mark inStack and push onto path.
				color[name] = 1
				pathStack = append(pathStack, name)
			}
			deps := dependencies[name]
			advanced := false
			for top.depIdx < len(deps) {
				dep := deps[top.depIdx]
				top.depIdx++
				if !cyclic[dep] {
					continue
				}
				if color[dep] == 0 {
					// Unvisited cyclic node — push and recurse.
					frameStack = append(frameStack, dfsFrame{name: dep, depIdx: 0})
					advanced = true
					break
				}
				if color[dep] == 1 && !reported[dep] {
					// Back edge: dep is already on the path — emit cycle.
					reported[dep] = true
					start := 0
					for i, n := range pathStack {
						if n == dep {
							start = i
							break
						}
					}
					cycleLen := len(pathStack) - start
					path := make([]string, cycleLen+1)
					copy(path, pathStack[start:])
					path[cycleLen] = dep
					msg := strings.Join(path, " → ")
					pos := posMap[dep]
					if pos.File != "" {
						ds.Append(diag.ErrorAt(pos.File, pos.Line, pos.Col, diag.CodeCyclicBinding,
							"prog %q: binding cycle: %s", progName, msg))
					} else {
						ds.Append(diag.Errorf(diag.CodeCyclicBinding,
							"prog %q: binding cycle: %s", progName, msg))
					}
				}
			}
			if !advanced {
				// All deps exhausted: mark done, pop from path and frame stack.
				color[name] = 2
				pathStack = pathStack[:len(pathStack)-1]
				frameStack = frameStack[:len(frameStack)-1]
			}
		}
	}
	return processed
}

func collectExprBindingRefs(expr *turnoutpb.ExprModel, refs *[]string) {
	if expr == nil {
		return
	}
	if expr.Combine != nil {
		for _, arg := range expr.Combine.Args {
			collectArgBindingRefs(arg, refs)
		}
	}
	if expr.Pipe != nil {
		for _, p := range expr.Pipe.Params {
			if p.SourceIdent != "" {
				*refs = append(*refs, p.SourceIdent)
			}
		}
		for _, step := range expr.Pipe.Steps {
			for _, arg := range step.Args {
				collectArgBindingRefs(arg, refs)
			}
		}
	}
	if expr.Cond != nil {
		collectArgBindingRefs(expr.Cond.Condition, refs)
		collectArgBindingRefs(expr.Cond.Then, refs)
		collectArgBindingRefs(expr.Cond.ElseBranch, refs)
	}
}

func collectArgBindingRefs(arg *turnoutpb.ArgModel, refs *[]string) {
	if arg == nil {
		return
	}
	if arg.Ref != nil && *arg.Ref != "" {
		*refs = append(*refs, *arg.Ref)
	}
	if arg.FuncRef != nil && *arg.FuncRef != "" {
		*refs = append(*refs, *arg.FuncRef)
	}
	if arg.Transform != nil && arg.Transform.Ref != "" {
		*refs = append(*refs, arg.Transform.Ref)
	}
	// step_ref is a numeric pipe-step index, not a binding name — skip.
}

// collectLocalExprBindingRefs extracts binding name references from a LocalExprModel
// for cycle detection. Used for ext_expr bindings that have no Expr counterpart.
func collectLocalExprBindingRefs(e *turnoutpb.LocalExprModel, refs *[]string) {
	localexpr.WalkProto(e, func(node *turnoutpb.LocalExprModel) {
		if ref, ok := node.Expr.(*turnoutpb.LocalExprModel_Ref); ok {
			*refs = append(*refs, ref.Ref.GetName())
		}
	})
}

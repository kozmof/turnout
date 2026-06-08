package validate

import (
	"strings"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/localexpr"
	"github.com/kozmof/turnout/packages/go/converter/internal/lower"
	"github.com/kozmof/turnout/packages/go/converter/internal/names"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
)

// ─────────────────────────────────────────────────────────────────────────────
// Group B — Prog / binding validation
// ─────────────────────────────────────────────────────────────────────────────

func validateProg(prog *turnoutpb.ProgModel, schema state.Schema, isTransition bool, root string, mergeNames []string, idx lower.PositionIndex, sceneID, actionID string, scopeName lower.ProgScope, ds *diag.Diagnostics) map[string]bindingInfo {
	if prog == nil {
		return map[string]bindingInfo{}
	}
	scope, adj := buildBindingScope(prog, idx, sceneID, actionID, scopeName, ds)
	detectCycles(prog.Name, adj, prog.Bindings, ds)
	validateBindingTypes(prog, scope, isTransition, idx, sceneID, actionID, scopeName, ds)
	if !isTransition && root != "" {
		detectUnusedBindings(prog.Name, root, mergeNames, prog.Bindings, adj, ds)
	}
	return scope
}

// detectUnusedBindings warns about bindings that are not reachable from the
// compute root or any merge/condition exit node. It performs a DFS forward
// through the dependency graph (adj[b] = list of bindings that b depends on)
// starting from exit nodes, then flags any binding not reached.
// Generated internal names (prefixed with __if_ or __local_) are skipped.
func detectUnusedBindings(progName, root string, mergeNames []string, bindings []*turnoutpb.BindingModel, adj map[string][]string, ds *diag.Diagnostics) {
	reachable := make(map[string]bool, len(bindings))
	var mark func(string)
	mark = func(name string) {
		if reachable[name] {
			return
		}
		reachable[name] = true
		for _, dep := range adj[name] {
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
		if strings.HasPrefix(b.Name, names.GeneratedIfCondPrefix) ||
			strings.HasPrefix(b.Name, names.GeneratedLocalPrefix) {
			continue
		}
		*ds = append(*ds, diag.WarnAt("", 0, 0, diag.CodeUnusedBinding,
			"prog %q: binding %q is declared but never used", progName, b.Name))
	}
}

// buildBindingScope registers all bindings into the scope map, detects duplicate
// names, records sigils, and builds the adjacency map used by detectCycles.
func buildBindingScope(prog *turnoutpb.ProgModel, idx lower.PositionIndex, sceneID, actionID string, scopeName lower.ProgScope, ds *diag.Diagnostics) (map[string]bindingInfo, map[string][]string) {
	scope := make(map[string]bindingInfo, len(prog.Bindings))
	adj := make(map[string][]string, len(prog.Bindings))
	seen := make(map[string]bool, len(prog.Bindings))
	for _, b := range prog.Bindings {
		if seen[b.Name] {
			*ds = append(*ds, diag.Errorf(diag.CodeDuplicateBinding,
				"duplicate binding name %q in prog %q", b.Name, prog.Name))
		} else {
			seen[b.Name] = true
		}
		ft := ast.MustFieldTypeFromString(b.Type)
		sigil := ast.SigilFromInt32(prog.Sigils[b.Name])
		scope[b.Name] = bindingInfo{
			fieldType: ft,
			isFunc:    b.Expr != nil || b.ExtExpr != nil,
			sigil:     sigil,
		}
		var refs []string
		if b.Expr != nil {
			collectExprBindingRefs(b.Expr, &refs)
		} else if b.ExtExpr != nil {
			collectLocalExprBindingRefs(b.ExtExpr, &refs)
		}
		// Deduplicate refs so that Kahn's in-degree counts each dependency once,
		// regardless of how many times a binding name appears in function arguments.
		if len(refs) > 1 {
			refSeen := make(map[string]struct{}, len(refs))
			unique := refs[:0]
			for _, r := range refs {
				if _, ok := refSeen[r]; !ok {
					refSeen[r] = struct{}{}
					unique = append(unique, r)
				}
			}
			refs = unique
		}
		adj[b.Name] = refs
	}
	return scope, adj
}

// validateBindingTypes runs per-binding structural and type checks against the
// already-built scope. Handles reserved names, transition sigil constraints,
// literal type conformance, and expr/ext_expr type checking.
func validateBindingTypes(prog *turnoutpb.ProgModel, scope map[string]bindingInfo, isTransition bool, idx lower.PositionIndex, sceneID, actionID string, scopeName lower.ProgScope, ds *diag.Diagnostics) {
	for _, b := range prog.Bindings {
		ft := ast.MustFieldTypeFromString(b.Type)
		sigil := ast.SigilFromInt32(prog.Sigils[b.Name])

		if strings.HasPrefix(b.Name, "__") {
			if !(strings.HasPrefix(b.Name, names.GeneratedIfCondPrefix) && strings.HasSuffix(b.Name, names.GeneratedIfCondSuffix)) &&
				!strings.HasPrefix(b.Name, names.GeneratedLocalPrefix) {
				*ds = append(*ds, diag.Errorf(diag.CodeReservedName,
					"binding %q: names starting with __ are reserved", b.Name))
			}
		}

		if isTransition && (sigil == ast.SigilEgress || sigil == ast.SigilBiDir) {
			pos := posFor(idx, sceneID, actionID, scopeName, prog.Name, b.Name)
			if pos.File != "" {
				*ds = append(*ds, diag.ErrorAt(pos.File, pos.Line, pos.Col, diag.CodeTransitionOutputSigil,
					"binding %q: output sigil %s is not allowed in transition progs", b.Name, sigil))
			} else {
				*ds = append(*ds, diag.Errorf(diag.CodeTransitionOutputSigil,
					"binding %q: output sigil %s is not allowed in transition progs", b.Name, sigil))
			}
		}

		if b.ExtExpr != nil {
			validateNoEmptyArrayLitArgs(b, ds)
			validateExtExprProto(b, b.ExtExpr, scope, ds)
			continue
		}

		if b.Value != nil {
			if !structpbMatchesFieldType(b.Value, ft) {
				*ds = append(*ds, diag.Errorf(diag.CodeTypeMismatch,
					"binding %q: literal value does not match declared type %s", b.Name, b.Type))
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

// posFor returns the source position for a binding from the position index.
// Returns the zero Pos if no position is recorded (e.g. for auto-generated bindings).
func posFor(idx lower.PositionIndex, sceneID, actionID string, scope lower.ProgScope, progName, bindingName string) ast.Pos {
	return idx.Get(sceneID, actionID, scope, progName, bindingName)
}

// ─────────────────────────────────────────────────────────────────────────────
// Extended local expression validation (#if / #case / #pipe / #it)
//
// validateExtExprProto walks a proto LocalExprModel directly, avoiding any
// round-trip allocation through ast.LocalExpr nodes. The scalar type helpers
// (validateBinaryArgTypePair, resolveLocalCallReturn, etc.) are shared with
// the AST validators below.
// ─────────────────────────────────────────────────────────────────────────────

func validateExtExprProto(b *turnoutpb.BindingModel, e *turnoutpb.LocalExprModel, scope map[string]bindingInfo, ds *diag.Diagnostics) {
	var ret ast.FieldType = ast.FieldTypeInvalid
	var known bool
	switch x := e.Expr.(type) {
	case *turnoutpb.LocalExprModel_IfExpr:
		ret, known = validateProtoLocalIf(b.Name, x.IfExpr.GetCond(), x.IfExpr.GetThen(), x.IfExpr.GetElseBranch(), scope, 0, false, ds)
	case *turnoutpb.LocalExprModel_CaseExpr:
		ret, known = validateProtoLocalCase(b.Name, x.CaseExpr.GetSubject(), x.CaseExpr.GetArms(), scope, 0, false, ds)
	case *turnoutpb.LocalExprModel_PipeExpr:
		ret, known = validateProtoLocalPipe(b.Name, x.PipeExpr.GetInitial(), x.PipeExpr.GetSteps(), scope, 0, false, ds)
	case *turnoutpb.LocalExprModel_Infix:
		ret, known = validateProtoLocalInfix(b.Name, ast.InfixOp(x.Infix.GetOp()), x.Infix.GetLhs(), x.Infix.GetRhs(), scope, 0, false, ds)
	default:
		*ds = append(*ds, diag.Errorf(diag.CodeUnsupportedConstruct,
			"binding %q: unsupported extended expression type %T", b.Name, e.Expr))
		return
	}
	if known {
		bFt := ast.MustFieldTypeFromString(b.Type)
		if ret != bFt {
			*ds = append(*ds, diag.Errorf(diag.CodeReturnTypeMismatch,
				"binding %q: extended expression returns %s but binding declares type %s",
				b.Name, ret, b.Type))
		}
	}
}

func validateProtoLocalExpr(bindingName string, e *turnoutpb.LocalExprModel, scope map[string]bindingInfo, itType ast.FieldType, itAllowed bool, ds *diag.Diagnostics) (ast.FieldType, bool) {
	if e == nil {
		return 0, false
	}
	switch x := e.Expr.(type) {
	case *turnoutpb.LocalExprModel_Ref:
		name := x.Ref.GetName()
		info, ok := scope[name]
		if !ok {
			*ds = append(*ds, diag.Errorf(diag.CodeUndefinedRef,
				"binding %q: reference %q is not defined", bindingName, name))
			return 0, false
		}
		return info.fieldType, true
	case *turnoutpb.LocalExprModel_Lit:
		ft, ok := structpbFieldType(x.Lit.GetValue())
		return ft, ok
	case *turnoutpb.LocalExprModel_It:
		if !itAllowed {
			*ds = append(*ds, diag.Errorf(diag.CodeUnsupportedConstruct,
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
		*ds = append(*ds, diag.Errorf(diag.CodeUnsupportedConstruct,
			"binding %q: unsupported local expression type %T", bindingName, e.Expr))
		return 0, false
	}
}

func validateProtoLocalCallExpr(bindingName, fn string, args []*turnoutpb.LocalExprModel, scope map[string]bindingInfo, itType ast.FieldType, itAllowed bool, ds *diag.Diagnostics) (ast.FieldType, bool) {
	spec, ok := builtinFns[fn]
	if !ok {
		*ds = append(*ds, diag.Errorf(diag.CodeUnknownFnAlias,
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

func validateProtoLocalInfix(bindingName string, op ast.InfixOp, lhs, rhs *turnoutpb.LocalExprModel, scope map[string]bindingInfo, itType ast.FieldType, itAllowed bool, ds *diag.Diagnostics) (ast.FieldType, bool) {
	lhsType, lhsOK := validateProtoLocalExpr(bindingName, lhs, scope, itType, itAllowed, ds)
	rhsType, rhsOK := validateProtoLocalExpr(bindingName, rhs, scope, itType, itAllowed, ds)
	// FnAliasForType resolves InfixPlus to "str_concat" or "add" based on the
	// inferred lhs type. For all other operators it returns their fixed alias.
	// Argument type errors (e.g. lhs str but rhs number for +) are caught below.
	fn := op.FnAliasForType(lhsType)
	spec, ok := builtinFns[fn]
	if !ok {
		return ast.FieldTypeInvalid, false
	}
	validateLocalCallArgTypes(bindingName, fn, spec, []ast.FieldType{lhsType, rhsType}, []bool{lhsOK, rhsOK}, ds)
	return resolveLocalCallReturn(spec, []ast.FieldType{lhsType, rhsType}, []bool{lhsOK, rhsOK})
}

func validateProtoLocalIf(bindingName string, cond, thenExpr, elseExpr *turnoutpb.LocalExprModel, scope map[string]bindingInfo, itType ast.FieldType, itAllowed bool, ds *diag.Diagnostics) (ast.FieldType, bool) {
	condType, condOK := validateProtoLocalExpr(bindingName, cond, scope, itType, itAllowed, ds)
	if condOK && condType != ast.FieldTypeBool {
		*ds = append(*ds, diag.Errorf(diag.CodeCondNotBool,
			"binding %q: #if condition has type %s; bool required", bindingName, condType))
	}
	thenType, thenOK := validateProtoLocalExpr(bindingName, thenExpr, scope, itType, itAllowed, ds)
	elseType, elseOK := validateProtoLocalExpr(bindingName, elseExpr, scope, itType, itAllowed, ds)
	if thenOK && elseOK && thenType != elseType {
		*ds = append(*ds, diag.Errorf(diag.CodeBranchTypeMismatch,
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

func validateProtoLocalCase(bindingName string, subject *turnoutpb.LocalExprModel, arms []*turnoutpb.LocalCaseArmModel, scope map[string]bindingInfo, itType ast.FieldType, itAllowed bool, ds *diag.Diagnostics) (ast.FieldType, bool) {
	subjectType, subjectOK := validateProtoLocalExpr(bindingName, subject, scope, itType, itAllowed, ds)
	var ret ast.FieldType = ast.FieldTypeInvalid
	retOK := false
	for _, arm := range arms {
		armScope := protoPatternScopeBindings(scope, arm.GetPattern(), subjectType, subjectOK)
		validateProtoPattern(bindingName, arm.GetPattern(), subjectType, subjectOK, ds)
		if arm.GetGuard() != nil {
			guardType, guardOK := validateProtoLocalExpr(bindingName, arm.GetGuard(), armScope, itType, itAllowed, ds)
			if guardOK && guardType != ast.FieldTypeBool {
				*ds = append(*ds, diag.Errorf(diag.CodeCondNotBool,
					"binding %q: #case guard has type %s; bool required", bindingName, guardType))
			}
		}
		armType, armOK := validateProtoLocalExpr(bindingName, arm.GetExpr(), armScope, itType, itAllowed, ds)
		if !armOK {
			continue
		}
		if retOK && armType != ret {
			*ds = append(*ds, diag.Errorf(diag.CodeBranchTypeMismatch,
				"binding %q: #case arms return %s and %s", bindingName, ret, armType))
			continue
		}
		ret = armType
		retOK = true
	}
	return ret, retOK
}

func validateProtoLocalPipe(bindingName string, initial *turnoutpb.LocalExprModel, steps []*turnoutpb.LocalExprModel, scope map[string]bindingInfo, itType ast.FieldType, itAllowed bool, ds *diag.Diagnostics) (ast.FieldType, bool) {
	current, known := validateProtoLocalExpr(bindingName, initial, scope, itType, itAllowed, ds)
	for _, step := range steps {
		stepType, stepOK := validateProtoLocalExpr(bindingName, step, scope, current, true, ds)
		current, known = stepType, stepOK
	}
	return current, known
}

func validateProtoPattern(bindingName string, p *turnoutpb.LocalCasePatternModel, subjectType ast.FieldType, subjectKnown bool, ds *diag.Diagnostics) {
	if p == nil {
		return
	}
	switch x := p.Pattern.(type) {
	case *turnoutpb.LocalCasePatternModel_Lit:
		patternType, ok := structpbFieldType(x.Lit.GetValue())
		if ok && subjectKnown && patternType != subjectType {
			*ds = append(*ds, diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: #case literal pattern has type %s but subject has type %s",
				bindingName, patternType, subjectType))
		}
	}
}

func protoPatternScopeBindings(scope map[string]bindingInfo, p *turnoutpb.LocalCasePatternModel, subjectType ast.FieldType, subjectKnown bool) map[string]bindingInfo {
	if p == nil {
		return scope
	}
	next := scope
	copied := false
	var add func(*turnoutpb.LocalCasePatternModel)
	add = func(pat *turnoutpb.LocalCasePatternModel) {
		if pat == nil {
			return
		}
		switch x := pat.Pattern.(type) {
		case *turnoutpb.LocalCasePatternModel_VarBinder:
			if !copied {
				next = make(map[string]bindingInfo, len(scope)+1)
				for k, v := range scope {
					next[k] = v
				}
				copied = true
			}
			if subjectKnown {
				next[x.VarBinder.GetName()] = bindingInfo{fieldType: subjectType}
			}
		}
	}
	add(p)
	return next
}

// validateBinaryArgTypePair checks the two operand types of a binary function
// against the fn spec. Shared by validateLocalCallArgTypes and validateCombineArgTypes.
func validateBinaryArgTypePair(bindingName, fn string, spec fnSpec, t1 ast.FieldType, ok1 bool, t2 ast.FieldType, ok2 bool, ds *diag.Diagnostics) {
	switch spec.kind {
	case fnKindGeneric:
		if ok1 && ok2 && t1 != t2 {
			*ds = append(*ds, diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: %s requires homogeneous operand types, got %s and %s", bindingName, fn, t1, t2))
		}
	case fnKindArrGet:
		if ok1 && !t1.IsArray() {
			*ds = append(*ds, diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: arr_get arg1 must be an array type, got %s", bindingName, t1))
		}
		if ok2 && t2 != ast.FieldTypeNumber {
			*ds = append(*ds, diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: arr_get arg2 must be number, got %s", bindingName, t2))
		}
	case fnKindArrInc:
		if ok1 && !t1.IsArray() {
			*ds = append(*ds, diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: arr_includes arg1 must be an array type, got %s", bindingName, t1))
		}
		if ok1 && ok2 && t1.IsArray() && t2 != t1.ElemType() {
			*ds = append(*ds, diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: arr_includes arg2 type %s does not match array element type %s",
				bindingName, t2, t1.ElemType()))
		}
	case fnKindArrConcat:
		if ok1 && !t1.IsArray() {
			*ds = append(*ds, diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: arr_concat arg1 must be an array type, got %s", bindingName, t1))
		}
		if ok1 && ok2 && t1 != t2 {
			*ds = append(*ds, diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: arr_concat args must have same array type, got %s and %s", bindingName, t1, t2))
		}
	default:
		if ok1 && t1 != spec.arg1Type {
			*ds = append(*ds, diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: %s arg1 expects %s, got %s", bindingName, fn, spec.arg1Type, t1))
		}
		if ok2 && t2 != spec.arg2Type {
			*ds = append(*ds, diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: %s arg2 expects %s, got %s", bindingName, fn, spec.arg2Type, t2))
		}
	}
}

func validateLocalCallArgTypes(bindingName, fn string, spec fnSpec, types []ast.FieldType, known []bool, ds *diag.Diagnostics) {
	if len(types) < 2 {
		return
	}
	validateBinaryArgTypePair(bindingName, fn, spec, types[0], known[0], types[1], known[1], ds)
}

func resolveLocalCallReturn(spec fnSpec, types []ast.FieldType, known []bool) (ast.FieldType, bool) {
	switch spec.kind {
	case fnKindGeneric, fnKindArrInc:
		return ast.FieldTypeBool, true
	case fnKindArrGet:
		if len(types) >= 1 && known[0] && types[0].IsArray() {
			return types[0].ElemType(), true
		}
		return 0, false
	case fnKindArrConcat:
		if len(types) >= 1 && known[0] {
			return types[0], true
		}
		return 0, false
	default:
		return spec.returnType, true
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Binding cycle detection
// ─────────────────────────────────────────────────────────────────────────────

// detectCycles reports a CodeCyclicBinding diagnostic for each binding that
// participates in a reference cycle. Cycles cause infinite recursion in the
// TypeScript runtime's buildExecutionTree and must be caught at validation time.
//
// Algorithm: Kahn's topological sort on the *dependency* graph.
// adj[b] = bindings that b depends on, so in-degree counts how many bindings
// each node is depended upon by. Nodes with in-degree 0 have no dependents
// and are dequeued first (consumer-first order — reverse of execution order).
// This direction is non-standard but cycle detection is direction-agnostic:
// a cycle in the dependency graph is the same cycle in its reverse.
// Nodes never dequeued are in cycles. A secondary targeted DFS over those
// nodes extracts one example cycle path for the error message.
func detectCycles(progName string, adj map[string][]string, bindings []*turnoutpb.BindingModel, ds *diag.Diagnostics) {
	// --- Phase 1: Kahn's algorithm ---
	inDegree := make(map[string]int, len(bindings))
	for _, b := range bindings {
		if _, ok := inDegree[b.Name]; !ok {
			inDegree[b.Name] = 0
		}
		for _, dep := range adj[b.Name] {
			inDegree[dep]++
		}
	}

	queue := make([]string, 0, len(bindings))
	for _, b := range bindings {
		if inDegree[b.Name] == 0 {
			queue = append(queue, b.Name)
		}
	}

	processed := make(map[string]bool, len(bindings))
	for len(queue) > 0 {
		n := queue[0]
		queue = queue[1:]
		processed[n] = true
		for _, dep := range adj[n] {
			inDegree[dep]--
			if inDegree[dep] == 0 {
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
		return
	}

	// --- Phase 2: extract one example cycle path per cycle via targeted DFS ---
	reported := make(map[string]bool)
	color := make(map[string]int) // 0=unvisited 1=inStack 2=done
	stack := make([]string, 0, len(cyclic))

	var visit func(name string)
	visit = func(name string) {
		if !cyclic[name] || color[name] == 2 {
			return
		}
		if color[name] == 1 {
			if !reported[name] {
				reported[name] = true
				start := 0
				for i, n := range stack {
					if n == name {
						start = i
						break
					}
				}
				cycleLen := len(stack) - start
				path := make([]string, cycleLen+1)
				copy(path, stack[start:])
				path[cycleLen] = name
				*ds = append(*ds, diag.Errorf(diag.CodeCyclicBinding,
					"prog %q: binding cycle: %s", progName, strings.Join(path, " → ")))
			}
			return
		}
		color[name] = 1
		stack = append(stack, name)
		for _, dep := range adj[name] {
			visit(dep)
		}
		stack = stack[:len(stack)-1]
		color[name] = 2
	}
	for _, b := range bindings {
		visit(b.Name)
	}
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

// Package validate runs all structural and type-checking rules against the
// lowered proto model. All diagnostics are collected before returning so
// callers see every error in one pass. Validation failures leave the model
// unmodified; no partial output is produced.
package validate

import (
	"strconv"
	"strings"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/lower"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
	"google.golang.org/protobuf/types/known/structpb"
)

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper types
// ─────────────────────────────────────────────────────────────────────────────

type bindingInfo struct {
	fieldType ast.FieldType
	isFunc    bool
	sigil     ast.Sigil
}

type fnSpec struct {
	arg1Type     ast.FieldType
	arg2Type     ast.FieldType
	returnType   ast.FieldType
	operatorOnly bool
	isGeneric    bool
	isArrGet     bool
	isArrInc     bool
	isArrConcat  bool
}

// ─────────────────────────────────────────────────────────────────────────────
// Built-in function alias table (hcl-context-spec.md §3.1)
// ─────────────────────────────────────────────────────────────────────────────

var builtinFns = map[string]fnSpec{
	"add":          {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeNumber, operatorOnly: true},
	"sub":          {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeNumber, operatorOnly: true},
	"mul":          {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeNumber, operatorOnly: true},
	"div":          {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeNumber, operatorOnly: true},
	"mod":          {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeNumber, operatorOnly: true},
	"max":          {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeNumber},
	"min":          {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeNumber},
	"gt":           {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeBool, operatorOnly: true},
	"gte":          {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeBool, operatorOnly: true},
	"lt":           {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeBool, operatorOnly: true},
	"lte":          {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeBool, operatorOnly: true},
	"str_concat":   {arg1Type: ast.FieldTypeStr, arg2Type: ast.FieldTypeStr, returnType: ast.FieldTypeStr, operatorOnly: true},
	"str_includes": {arg1Type: ast.FieldTypeStr, arg2Type: ast.FieldTypeStr, returnType: ast.FieldTypeBool},
	"str_starts":   {arg1Type: ast.FieldTypeStr, arg2Type: ast.FieldTypeStr, returnType: ast.FieldTypeBool},
	"str_ends":     {arg1Type: ast.FieldTypeStr, arg2Type: ast.FieldTypeStr, returnType: ast.FieldTypeBool},
	"bool_and":     {arg1Type: ast.FieldTypeBool, arg2Type: ast.FieldTypeBool, returnType: ast.FieldTypeBool, operatorOnly: true},
	"bool_or":      {arg1Type: ast.FieldTypeBool, arg2Type: ast.FieldTypeBool, returnType: ast.FieldTypeBool, operatorOnly: true},
	"bool_xor":     {arg1Type: ast.FieldTypeBool, arg2Type: ast.FieldTypeBool, returnType: ast.FieldTypeBool},
	"eq":           {returnType: ast.FieldTypeBool, operatorOnly: true, isGeneric: true},
	"neq":          {returnType: ast.FieldTypeBool, operatorOnly: true, isGeneric: true},
	"arr_includes": {isArrInc: true},
	"arr_get":      {isArrGet: true},
	"arr_concat":   {isArrConcat: true},
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

// Validate runs all structural and type validation rules against the proto model.
// sc may be nil (treated as no sidecar metadata). schema may be nil.
// Returns diagnostics; callers must check HasErrors() before proceeding to emission.
func Validate(tm *turnoutpb.TurnModel, sc *lower.Sidecar, schema state.Schema) diag.Diagnostics {
	var ds diag.Diagnostics
	if tm == nil {
		return ds
	}
	seenSceneIDs := make(map[string]bool)
	for _, s := range tm.Scenes {
		if seenSceneIDs[s.Id] {
			ds = append(ds, diag.Errorf("DuplicateSceneID",
				"duplicate scene ID %q", s.Id))
		}
		seenSceneIDs[s.Id] = true
		validateScene(s, schema, sc, &ds)
	}
	if len(tm.Routes) > 0 {
		knownScenes := buildKnownScenes(tm)
		validateRoutes(tm.Routes, knownScenes, &ds)
	}
	return ds
}

func buildKnownScenes(tm *turnoutpb.TurnModel) map[string]bool {
	known := make(map[string]bool)
	for _, s := range tm.Scenes {
		known[s.Id] = true
	}
	return known
}

// ─────────────────────────────────────────────────────────────────────────────
// Group E — Route validation
// ─────────────────────────────────────────────────────────────────────────────

func validateRoutes(routes []*turnoutpb.RouteModel, knownScenes map[string]bool, ds *diag.Diagnostics) {
	for _, r := range routes {
		validateRoute(r, knownScenes, ds)
	}
}

func validateRoute(r *turnoutpb.RouteModel, knownScenes map[string]bool, ds *diag.Diagnostics) {
	fallbackCount := 0
	for i, arm := range r.Match {
		if arm.Target != "" && !knownScenes[arm.Target] {
			*ds = append(*ds, diag.Errorf(diag.CodeUnresolvedScene,
				"route %q arm %d: target scene %q is not defined", r.Id, i, arm.Target))
		}
		for _, pat := range arm.Patterns {
			if pat == "_" {
				fallbackCount++
				if fallbackCount > 1 {
					*ds = append(*ds, diag.Errorf(diag.CodeDuplicateFallback,
						"route %q: match block has more than one _ fallback arm", r.Id))
				}
				continue
			}
			validateRoutePattern(r.Id, i, pat, ds)
		}
	}
}

func validateRoutePattern(routeID string, armIdx int, pat string, ds *diag.Diagnostics) {
	parts := strings.Split(pat, ".")

	if len(parts) < 1 || parts[0] == "" || parts[0] == "*" {
		*ds = append(*ds, diag.Errorf(diag.CodeInvalidPathItem,
			"route %q arm %d: pattern %q has no valid scene_id prefix", routeID, armIdx, pat))
		return
	}

	if len(parts) < 2 {
		*ds = append(*ds, diag.Errorf(diag.CodeBareWildcardPath,
			"route %q arm %d: pattern %q has no action segment after scene_id", routeID, armIdx, pat))
		return
	}

	wildcardCount := 0
	for _, seg := range parts[1:] {
		if seg == "*" {
			wildcardCount++
		}
	}
	if wildcardCount > 1 {
		*ds = append(*ds, diag.Errorf(diag.CodeMultipleWildcards,
			"route %q arm %d: pattern %q has more than one * wildcard", routeID, armIdx, pat))
		return
	}

	if parts[len(parts)-1] == "*" {
		*ds = append(*ds, diag.Errorf(diag.CodeBareWildcardPath,
			"route %q arm %d: pattern %q ends with * (terminal action required)", routeID, armIdx, pat))
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Group D — Scene structural validation
// ─────────────────────────────────────────────────────────────────────────────

func validateScene(scene *turnoutpb.SceneBlock, schema state.Schema, sc *lower.Sidecar, ds *diag.Diagnostics) {
	actionIndex := make(map[string]*turnoutpb.ActionModel, len(scene.Actions))
	for _, a := range scene.Actions {
		if _, exists := actionIndex[a.Id]; exists {
			*ds = append(*ds, diag.Errorf(diag.CodeDuplicateActionLabel,
				"duplicate action ID %q in scene %q", a.Id, scene.Id))
		} else {
			actionIndex[a.Id] = a
		}
	}

	validateOverview(scene, actionIndex, sc, ds)

	if len(scene.Actions) == 0 {
		*ds = append(*ds, diag.Errorf(diag.CodeSCNInvalidActionGraph,
			"scene %q has no actions", scene.Id))
	}

	if len(scene.EntryActions) == 0 {
		*ds = append(*ds, diag.Errorf(diag.CodeSCNInvalidActionGraph,
			"scene %q has no entry actions", scene.Id))
	}
	for _, ea := range scene.EntryActions {
		if _, ok := actionIndex[ea]; !ok {
			*ds = append(*ds, diag.Errorf(diag.CodeSCNInvalidActionGraph,
				"entry action %q not found in scene %q", ea, scene.Id))
		}
	}

	for _, a := range scene.Actions {
		var scope map[string]bindingInfo

		if a.Compute != nil {
			scope = validateProg(a.Compute.Prog, schema, false, sc, scene.Id, a.Id, "compute", ds)

			if a.Compute.Root != "" {
				if _, ok := scope[a.Compute.Root]; !ok {
					*ds = append(*ds, diag.Errorf(diag.CodeSCNActionRootNotFound,
						"action %q: compute.root %q not found in prog", a.Id, a.Compute.Root))
				}
			}

			validateActionEffects(a, scope, schema, ds)
		} else {
			scope = map[string]bindingInfo{}
		}
		_ = scope

		for i, nr := range a.Next {
			if nr.Action != "" {
				if _, ok := actionIndex[nr.Action]; !ok {
					*ds = append(*ds, diag.Errorf(diag.CodeSCNInvalidActionGraph,
						"action %q: next rule references unknown action %q", a.Id, nr.Action))
				}
			}
			validateNextRule(nr, schema, sc, scene.Id, a.Id, "next:"+strconv.Itoa(i), ds)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Group B — Prog / binding validation
// ─────────────────────────────────────────────────────────────────────────────

func validateProg(prog *turnoutpb.ProgModel, schema state.Schema, isTransition bool, sc *lower.Sidecar, sceneID, actionID, scopeName string, ds *diag.Diagnostics) map[string]bindingInfo {
	if prog == nil {
		return map[string]bindingInfo{}
	}

	// Pass 1: register all bindings; detect duplicates.
	scope := make(map[string]bindingInfo, len(prog.Bindings))
	seen := make(map[string]bool, len(prog.Bindings))
	for _, b := range prog.Bindings {
		if seen[b.Name] {
			*ds = append(*ds, diag.Errorf(diag.CodeDuplicateBinding,
				"duplicate binding name %q in prog %q", b.Name, prog.Name))
		} else {
			seen[b.Name] = true
		}
		ft, _ := ast.FieldTypeFromString(b.Type)
		sigil := sigilFor(sc, sceneID, actionID, scopeName, prog.Name, b.Name)
		scope[b.Name] = bindingInfo{
			fieldType: ft,
			isFunc:    b.Expr != nil || b.ExtExpr != nil,
			sigil:     sigil,
		}
	}

	// Pass 2: structural + type checks.
	for _, b := range prog.Bindings {
		ft, _ := ast.FieldTypeFromString(b.Type)
		sigil := sigilFor(sc, sceneID, actionID, scopeName, prog.Name, b.Name)

		if strings.HasPrefix(b.Name, "__") {
			if !(strings.HasPrefix(b.Name, "__if_") && strings.HasSuffix(b.Name, "_cond")) &&
				!strings.HasPrefix(b.Name, "__local_") {
				*ds = append(*ds, diag.Errorf(diag.CodeReservedName,
					"binding %q: names starting with __ are reserved", b.Name))
			}
		}

		if isTransition && (sigil == ast.SigilEgress || sigil == ast.SigilBiDir) {
			*ds = append(*ds, diag.Errorf(diag.CodeTransitionOutputSigil,
				"binding %q: output sigil %s is not allowed in transition progs", b.Name, sigil))
		}

		if b.ExtExpr != nil {
			validateExtExpr(b, protoLocalExprToAST(b.ExtExpr), scope, ds)
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

	return scope
}

// sigilFor looks up the sigil for a binding in the sidecar. Returns SigilNone
// when the sidecar is nil or no entry exists.
func sigilFor(sc *lower.Sidecar, sceneID, actionID, scope, progName, bindingName string) ast.Sigil {
	if sc == nil {
		return ast.SigilNone
	}
	if sigil, ok := sc.Sigils[lower.BindingKey{
		SceneID:     sceneID,
		ActionID:    actionID,
		Scope:       scope,
		ProgName:    progName,
		BindingName: bindingName,
	}]; ok {
		return sigil
	}
	return sc.Sigils[lower.BindingKey{
		SceneID:     sceneID,
		ActionID:    actionID,
		ProgName:    progName,
		BindingName: bindingName,
	}]
}

// protoLocalExprToAST converts a proto LocalExprModel back to an ast.LocalExpr
// so the existing AST-based validation functions can be reused unchanged.
func protoLocalExprToAST(e *turnoutpb.LocalExprModel) ast.LocalExpr {
	if e == nil {
		return nil
	}
	switch x := e.Expr.(type) {
	case *turnoutpb.LocalExprModel_Ref:
		return &ast.LocalRefExpr{Name: x.Ref.GetName()}
	case *turnoutpb.LocalExprModel_Lit:
		return &ast.LocalLitExpr{Value: structpbToLiteral(x.Lit.GetValue())}
	case *turnoutpb.LocalExprModel_It:
		return &ast.LocalItExpr{}
	case *turnoutpb.LocalExprModel_Call:
		args := make([]ast.LocalExpr, len(x.Call.GetArgs()))
		for i, a := range x.Call.GetArgs() {
			args[i] = protoLocalExprToAST(a)
		}
		return &ast.LocalCallExpr{FnAlias: x.Call.GetFn(), Args: args}
	case *turnoutpb.LocalExprModel_Infix:
		return &ast.LocalInfixExpr{
			Op:  ast.InfixOp(x.Infix.GetOp()),
			LHS: protoLocalExprToAST(x.Infix.GetLhs()),
			RHS: protoLocalExprToAST(x.Infix.GetRhs()),
		}
	case *turnoutpb.LocalExprModel_IfExpr:
		return &ast.LocalIfExpr{
			Cond: protoLocalExprToAST(x.IfExpr.GetCond()),
			Then: protoLocalExprToAST(x.IfExpr.GetThen()),
			Else: protoLocalExprToAST(x.IfExpr.GetElseBranch()),
		}
	case *turnoutpb.LocalExprModel_CaseExpr:
		arms := make([]ast.LocalCaseArm, len(x.CaseExpr.GetArms()))
		for i, arm := range x.CaseExpr.GetArms() {
			a := ast.LocalCaseArm{
				Pattern: protoCasePatternToAST(arm.GetPattern()),
				Expr:    protoLocalExprToAST(arm.GetExpr()),
			}
			if arm.GetGuard() != nil {
				a.Guard = protoLocalExprToAST(arm.GetGuard())
			}
			arms[i] = a
		}
		return &ast.LocalCaseExpr{Subject: protoLocalExprToAST(x.CaseExpr.GetSubject()), Arms: arms}
	case *turnoutpb.LocalExprModel_PipeExpr:
		steps := make([]ast.LocalExpr, len(x.PipeExpr.GetSteps()))
		for i, s := range x.PipeExpr.GetSteps() {
			steps[i] = protoLocalExprToAST(s)
		}
		return &ast.LocalPipeExpr{Initial: protoLocalExprToAST(x.PipeExpr.GetInitial()), Steps: steps}
	default:
		return nil
	}
}

func protoCasePatternToAST(p *turnoutpb.LocalCasePatternModel) ast.LocalCasePattern {
	if p == nil {
		return &ast.WildcardCasePattern{}
	}
	switch x := p.Pattern.(type) {
	case *turnoutpb.LocalCasePatternModel_Wildcard:
		return &ast.WildcardCasePattern{}
	case *turnoutpb.LocalCasePatternModel_Lit:
		return &ast.LiteralCasePattern{Value: structpbToLiteral(x.Lit.GetValue())}
	case *turnoutpb.LocalCasePatternModel_VarBinder:
		return &ast.VarBinderPattern{Name: x.VarBinder.GetName()}
	case *turnoutpb.LocalCasePatternModel_Tuple:
		elems := make([]ast.LocalCasePattern, len(x.Tuple.GetElems()))
		for i, elem := range x.Tuple.GetElems() {
			elems[i] = protoCasePatternToAST(elem)
		}
		return &ast.TupleCasePattern{Elems: elems}
	default:
		return &ast.WildcardCasePattern{}
	}
}

func structpbToLiteral(v *structpb.Value) ast.Literal {
	if v == nil {
		return &ast.NumberLiteral{}
	}
	switch x := v.Kind.(type) {
	case *structpb.Value_NumberValue:
		return &ast.NumberLiteral{Value: x.NumberValue}
	case *structpb.Value_StringValue:
		return &ast.StringLiteral{Value: x.StringValue}
	case *structpb.Value_BoolValue:
		return &ast.BoolLiteral{Value: x.BoolValue}
	case *structpb.Value_ListValue:
		if x.ListValue == nil {
			return &ast.ArrayLiteral{}
		}
		elems := make([]ast.Literal, len(x.ListValue.Values))
		for i, elem := range x.ListValue.Values {
			elems[i] = structpbToLiteral(elem)
		}
		return &ast.ArrayLiteral{Elements: elems}
	default:
		return &ast.NumberLiteral{}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Literal / structpb helpers
// ─────────────────────────────────────────────────────────────────────────────

func validateArrayLiteral(v *structpb.Value, ft ast.FieldType, bindingName string, ds *diag.Diagnostics) {
	lv, ok := v.Kind.(*structpb.Value_ListValue)
	if !ok {
		return
	}
	elemFT := ft.ElemType()
	for _, elem := range lv.ListValue.GetValues() {
		if _, isArr := elem.Kind.(*structpb.Value_ListValue); isArr {
			*ds = append(*ds, diag.Errorf(diag.CodeNestedArrayNotAllowed,
				"binding %q: nested arrays are not allowed in value bindings", bindingName))
			continue
		}
		if !structpbMatchesFieldType(elem, elemFT) {
			*ds = append(*ds, diag.Errorf(diag.CodeHeterogeneousArray,
				"binding %q: array element does not match declared element type %s", bindingName, elemFT))
		}
	}
}

func structpbMatchesFieldType(v *structpb.Value, ft ast.FieldType) bool {
	if v == nil {
		return false
	}
	switch ft {
	case ast.FieldTypeNumber:
		_, ok := v.Kind.(*structpb.Value_NumberValue)
		return ok
	case ast.FieldTypeStr:
		_, ok := v.Kind.(*structpb.Value_StringValue)
		return ok
	case ast.FieldTypeBool:
		_, ok := v.Kind.(*structpb.Value_BoolValue)
		return ok
	case ast.FieldTypeArrNumber, ast.FieldTypeArrStr, ast.FieldTypeArrBool:
		lv, ok := v.Kind.(*structpb.Value_ListValue)
		if !ok {
			return false
		}
		elemFT := ft.ElemType()
		for _, elem := range lv.ListValue.GetValues() {
			if !structpbMatchesFieldType(elem, elemFT) {
				return false
			}
		}
		return true
	}
	return false
}

func structpbFieldType(v *structpb.Value) (ast.FieldType, bool) {
	if v == nil {
		return 0, false
	}
	switch k := v.Kind.(type) {
	case *structpb.Value_NumberValue:
		_ = k
		return ast.FieldTypeNumber, true
	case *structpb.Value_StringValue:
		_ = k
		return ast.FieldTypeStr, true
	case *structpb.Value_BoolValue:
		_ = k
		return ast.FieldTypeBool, true
	case *structpb.Value_ListValue:
		if k.ListValue == nil || len(k.ListValue.Values) == 0 {
			return 0, false
		}
		elemFT, ok := structpbFieldType(k.ListValue.Values[0])
		if !ok {
			return 0, false
		}
		switch elemFT {
		case ast.FieldTypeNumber:
			return ast.FieldTypeArrNumber, true
		case ast.FieldTypeStr:
			return ast.FieldTypeArrStr, true
		case ast.FieldTypeBool:
			return ast.FieldTypeArrBool, true
		}
	}
	return 0, false
}

// ─────────────────────────────────────────────────────────────────────────────
// Combine / Pipe / Cond validation
// ─────────────────────────────────────────────────────────────────────────────

func validateCombine(b *turnoutpb.BindingModel, c *turnoutpb.CombineExpr, scope map[string]bindingInfo, ds *diag.Diagnostics) {
	spec, ok := builtinFns[c.Fn]
	if !ok {
		*ds = append(*ds, diag.Errorf(diag.CodeUnknownFnAlias,
			"binding %q: unknown function alias %q", b.Name, c.Fn))
		return
	}

	if isIdentityCombine(c) {
		refName := *c.Args[0].Ref
		refInfo, exists := scope[refName]
		if !exists {
			*ds = append(*ds, diag.Errorf(diag.CodeUndefinedRef,
				"binding %q: reference %q is not defined", b.Name, refName))
			return
		}
		bFt, _ := ast.FieldTypeFromString(b.Type)
		if refInfo.fieldType != bFt {
			*ds = append(*ds, diag.Errorf(diag.CodeSingleRefTypeMismatch,
				"binding %q: single-reference %q has type %s but binding declares type %s",
				b.Name, refName, refInfo.fieldType, b.Type))
		}
		return
	}

	for _, arg := range c.Args {
		validateArgRefs(b.Name, arg, scope, ds)
	}

	if retType, known := resolveExpectedReturn(spec, c.Args, scope, nil); known {
		bFt, _ := ast.FieldTypeFromString(b.Type)
		if retType != bFt {
			*ds = append(*ds, diag.Errorf(diag.CodeReturnTypeMismatch,
				"binding %q: function %q returns %s but binding declares type %s",
				b.Name, c.Fn, retType, b.Type))
		}
	}

	validateCombineArgTypes(b.Name, c, spec, scope, ds)
}

func validatePipe(b *turnoutpb.BindingModel, p *turnoutpb.PipeExpr, scope map[string]bindingInfo, ds *diag.Diagnostics) {
	pipeScope := make(map[string]bindingInfo, len(scope)+len(p.Params))
	for k, v := range scope {
		pipeScope[k] = v
	}
	for _, param := range p.Params {
		srcInfo, ok := scope[param.SourceIdent]
		if !ok {
			*ds = append(*ds, diag.Errorf(diag.CodeUndefinedRef,
				"binding %q pipe param %q: source %q is not defined", b.Name, param.ParamName, param.SourceIdent))
			continue
		}
		if srcInfo.isFunc {
			*ds = append(*ds, diag.Errorf(diag.CodePipeArgNotValue,
				"binding %q pipe param %q: source %q is a function binding; pipe params must reference value bindings",
				b.Name, param.ParamName, param.SourceIdent))
			continue
		}
		pipeScope[param.ParamName] = bindingInfo{fieldType: srcInfo.fieldType, isFunc: false}
	}

	stepTypes := make([]ast.FieldType, 0, len(p.Steps))
	stepKnown := make([]bool, 0, len(p.Steps))

	for i, step := range p.Steps {
		spec, ok := builtinFns[step.Fn]
		if !ok {
			*ds = append(*ds, diag.Errorf(diag.CodeUnknownFnAlias,
				"binding %q pipe step %d: unknown function alias %q", b.Name, i, step.Fn))
			stepTypes = append(stepTypes, 0)
			stepKnown = append(stepKnown, false)
			continue
		}

		for _, arg := range step.Args {
			if arg.StepRef != nil {
				if int(*arg.StepRef) >= i {
					*ds = append(*ds, diag.Errorf(diag.CodeStepRefOutOfBounds,
						"binding %q pipe step %d: step_ref = %d is out of bounds (must be < %d)",
						b.Name, i, *arg.StepRef, i))
				}
			} else {
				validateArgRefs(b.Name, arg, pipeScope, ds)
			}
		}

		retType, known := resolveExpectedReturn(spec, step.Args, pipeScope, stepTypes)
		stepTypes = append(stepTypes, retType)
		stepKnown = append(stepKnown, known)
	}

	if n := len(p.Steps); n > 0 {
		if stepKnown[n-1] {
			bFt, _ := ast.FieldTypeFromString(b.Type)
			if stepTypes[n-1] != bFt {
				*ds = append(*ds, diag.Errorf(diag.CodeReturnTypeMismatch,
					"binding %q: pipe last step returns %s but binding declares type %s",
					b.Name, stepTypes[n-1], b.Type))
			}
		}
	}
}

func validateCond(b *turnoutpb.BindingModel, cond *turnoutpb.CondExpr, scope map[string]bindingInfo, ds *diag.Diagnostics) {
	if cond.Condition != nil && cond.Condition.Ref != nil && *cond.Condition.Ref != "" {
		condRef := *cond.Condition.Ref
		info, ok := scope[condRef]
		if !ok {
			*ds = append(*ds, diag.Errorf(diag.CodeUndefinedRef,
				"binding %q cond condition: %q is not defined", b.Name, condRef))
		} else if info.fieldType != ast.FieldTypeBool {
			*ds = append(*ds, diag.Errorf(diag.CodeCondNotBool,
				"binding %q cond condition %q has type %s; bool required",
				b.Name, condRef, info.fieldType))
		}
	}

	var thenType, elseType ast.FieldType
	var hasThen, hasElse bool

	if cond.Then != nil && cond.Then.FuncRef != nil && *cond.Then.FuncRef != "" {
		ref := *cond.Then.FuncRef
		info, ok := scope[ref]
		if !ok {
			*ds = append(*ds, diag.Errorf(diag.CodeUndefinedFuncRef,
				"binding %q cond then: %q is not defined", b.Name, ref))
		} else if !info.isFunc {
			*ds = append(*ds, diag.Errorf(diag.CodeUndefinedFuncRef,
				"binding %q cond then: %q is a value binding; a function binding is required", b.Name, ref))
		} else {
			thenType = info.fieldType
			hasThen = true
		}
	}

	if cond.ElseBranch != nil && cond.ElseBranch.FuncRef != nil && *cond.ElseBranch.FuncRef != "" {
		ref := *cond.ElseBranch.FuncRef
		info, ok := scope[ref]
		if !ok {
			*ds = append(*ds, diag.Errorf(diag.CodeUndefinedFuncRef,
				"binding %q cond else: %q is not defined", b.Name, ref))
		} else if !info.isFunc {
			*ds = append(*ds, diag.Errorf(diag.CodeUndefinedFuncRef,
				"binding %q cond else: %q is a value binding; a function binding is required", b.Name, ref))
		} else {
			elseType = info.fieldType
			hasElse = true
		}
	}

	if hasThen && hasElse && thenType != elseType {
		*ds = append(*ds, diag.Errorf(diag.CodeBranchTypeMismatch,
			"binding %q cond: then branch type %s and else branch type %s do not match",
			b.Name, thenType, elseType))
	}

	if hasThen {
		bFt, _ := ast.FieldTypeFromString(b.Type)
		if thenType != bFt {
			*ds = append(*ds, diag.Errorf(diag.CodeReturnTypeMismatch,
				"binding %q cond: branch return type %s does not match declared type %s",
				b.Name, thenType, b.Type))
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Extended local expression validation (#if / #case / #pipe / #it sidecar)
// ─────────────────────────────────────────────────────────────────────────────

func validateExtExpr(b *turnoutpb.BindingModel, e ast.LocalExpr, scope map[string]bindingInfo, ds *diag.Diagnostics) {
	var ret ast.FieldType
	var known bool
	switch r := e.(type) {
	case *ast.LocalIfExpr:
		ret, known = validateLocalIf(b.Name, r.Cond, r.Then, r.Else, scope, 0, false, ds)
	case *ast.LocalCaseExpr:
		ret, known = validateLocalCase(b.Name, r.Subject, r.Arms, scope, 0, false, ds)
	case *ast.LocalPipeExpr:
		ret, known = validateLocalPipe(b.Name, r.Initial, r.Steps, scope, 0, false, ds)
	default:
		*ds = append(*ds, diag.Errorf(diag.CodeUnsupportedConstruct,
			"binding %q: unsupported extended expression %T", b.Name, e))
		return
	}
	if known {
		bFt, _ := ast.FieldTypeFromString(b.Type)
		if ret != bFt {
			*ds = append(*ds, diag.Errorf(diag.CodeReturnTypeMismatch,
				"binding %q: extended expression returns %s but binding declares type %s",
				b.Name, ret, b.Type))
		}
	}
}

func validateLocalExpr(bindingName string, e ast.LocalExpr, scope map[string]bindingInfo, itType ast.FieldType, itAllowed bool, ds *diag.Diagnostics) (ast.FieldType, bool) {
	switch x := e.(type) {
	case *ast.LocalRefExpr:
		info, ok := scope[x.Name]
		if !ok {
			*ds = append(*ds, diag.Errorf(diag.CodeUndefinedRef,
				"binding %q: reference %q is not defined", bindingName, x.Name))
			return 0, false
		}
		return info.fieldType, true
	case *ast.LocalLitExpr:
		return ast.LiteralFieldType(x.Value)
	case *ast.LocalItExpr:
		if !itAllowed {
			*ds = append(*ds, diag.Errorf(diag.CodeUnsupportedConstruct,
				"binding %q: #it is only valid inside #pipe step expressions", bindingName))
			return 0, false
		}
		if itType == 0 {
			return 0, false
		}
		return itType, true
	case *ast.LocalCallExpr:
		return validateLocalCall(bindingName, x, scope, itType, itAllowed, ds)
	case *ast.LocalInfixExpr:
		return validateLocalInfix(bindingName, x, scope, itType, itAllowed, ds)
	case *ast.LocalIfExpr:
		return validateLocalIf(bindingName, x.Cond, x.Then, x.Else, scope, itType, itAllowed, ds)
	case *ast.LocalCaseExpr:
		return validateLocalCase(bindingName, x.Subject, x.Arms, scope, itType, itAllowed, ds)
	case *ast.LocalPipeExpr:
		return validateLocalPipe(bindingName, x.Initial, x.Steps, scope, itType, itAllowed, ds)
	default:
		*ds = append(*ds, diag.Errorf(diag.CodeUnsupportedConstruct,
			"binding %q: unsupported local expression %T", bindingName, e))
		return 0, false
	}
}

func validateLocalCall(bindingName string, call *ast.LocalCallExpr, scope map[string]bindingInfo, itType ast.FieldType, itAllowed bool, ds *diag.Diagnostics) (ast.FieldType, bool) {
	spec, ok := builtinFns[call.FnAlias]
	if !ok {
		*ds = append(*ds, diag.Errorf(diag.CodeUnknownFnAlias,
			"binding %q: unknown function alias %q", bindingName, call.FnAlias))
		return 0, false
	}
	argTypes := make([]ast.FieldType, len(call.Args))
	argKnown := make([]bool, len(call.Args))
	for i, arg := range call.Args {
		argTypes[i], argKnown[i] = validateLocalExpr(bindingName, arg, scope, itType, itAllowed, ds)
	}
	validateLocalCallArgTypes(bindingName, call.FnAlias, spec, argTypes, argKnown, ds)
	return resolveLocalCallReturn(spec, argTypes, argKnown)
}

func validateLocalInfix(bindingName string, infix *ast.LocalInfixExpr, scope map[string]bindingInfo, itType ast.FieldType, itAllowed bool, ds *diag.Diagnostics) (ast.FieldType, bool) {
	lhsType, lhsOK := validateLocalExpr(bindingName, infix.LHS, scope, itType, itAllowed, ds)
	rhsType, rhsOK := validateLocalExpr(bindingName, infix.RHS, scope, itType, itAllowed, ds)
	fn := infix.Op.FnAlias()
	if fn == "" {
		if lhsOK && rhsOK && lhsType == ast.FieldTypeStr && rhsType == ast.FieldTypeStr {
			return ast.FieldTypeStr, true
		}
		fn = "add"
	}
	spec, ok := builtinFns[fn]
	if !ok {
		return 0, false
	}
	validateLocalCallArgTypes(bindingName, fn, spec, []ast.FieldType{lhsType, rhsType}, []bool{lhsOK, rhsOK}, ds)
	return resolveLocalCallReturn(spec, []ast.FieldType{lhsType, rhsType}, []bool{lhsOK, rhsOK})
}

func validateLocalIf(bindingName string, cond, thenExpr, elseExpr ast.LocalExpr, scope map[string]bindingInfo, itType ast.FieldType, itAllowed bool, ds *diag.Diagnostics) (ast.FieldType, bool) {
	condType, condOK := validateLocalExpr(bindingName, cond, scope, itType, itAllowed, ds)
	if condOK && condType != ast.FieldTypeBool {
		*ds = append(*ds, diag.Errorf(diag.CodeCondNotBool,
			"binding %q: #if condition has type %s; bool required", bindingName, condType))
	}
	thenType, thenOK := validateLocalExpr(bindingName, thenExpr, scope, itType, itAllowed, ds)
	elseType, elseOK := validateLocalExpr(bindingName, elseExpr, scope, itType, itAllowed, ds)
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

func validateLocalCase(bindingName string, subject ast.LocalExpr, arms []ast.LocalCaseArm, scope map[string]bindingInfo, itType ast.FieldType, itAllowed bool, ds *diag.Diagnostics) (ast.FieldType, bool) {
	subjectType, subjectOK := validateLocalExpr(bindingName, subject, scope, itType, itAllowed, ds)
	var ret ast.FieldType
	retOK := false
	for _, arm := range arms {
		armScope := scopeWithPatternBindings(scope, arm.Pattern, subjectType, subjectOK)
		validatePattern(bindingName, arm.Pattern, subjectType, subjectOK, ds)
		if arm.Guard != nil {
			guardType, guardOK := validateLocalExpr(bindingName, arm.Guard, armScope, itType, itAllowed, ds)
			if guardOK && guardType != ast.FieldTypeBool {
				*ds = append(*ds, diag.Errorf(diag.CodeCondNotBool,
					"binding %q: #case guard has type %s; bool required", bindingName, guardType))
			}
		}
		armType, armOK := validateLocalExpr(bindingName, arm.Expr, armScope, itType, itAllowed, ds)
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

func validateLocalPipe(bindingName string, initial ast.LocalExpr, steps []ast.LocalExpr, scope map[string]bindingInfo, itType ast.FieldType, itAllowed bool, ds *diag.Diagnostics) (ast.FieldType, bool) {
	current, known := validateLocalExpr(bindingName, initial, scope, itType, itAllowed, ds)
	for _, step := range steps {
		stepType, stepOK := validateLocalExpr(bindingName, step, scope, current, true, ds)
		current, known = stepType, stepOK
	}
	return current, known
}

func validateLocalCallArgTypes(bindingName, fn string, spec fnSpec, types []ast.FieldType, known []bool, ds *diag.Diagnostics) {
	if len(types) < 2 {
		return
	}
	t1, ok1 := types[0], known[0]
	t2, ok2 := types[1], known[1]
	switch {
	case spec.isGeneric:
		if ok1 && ok2 && t1 != t2 {
			*ds = append(*ds, diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: %s requires homogeneous operand types, got %s and %s", bindingName, fn, t1, t2))
		}
	case spec.isArrGet:
		if ok1 && !t1.IsArray() {
			*ds = append(*ds, diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: arr_get arg1 must be an array type, got %s", bindingName, t1))
		}
		if ok2 && t2 != ast.FieldTypeNumber {
			*ds = append(*ds, diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: arr_get arg2 must be number, got %s", bindingName, t2))
		}
	case spec.isArrInc:
		if ok1 && !t1.IsArray() {
			*ds = append(*ds, diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: arr_includes arg1 must be an array type, got %s", bindingName, t1))
		}
		if ok1 && ok2 && t1.IsArray() && t2 != t1.ElemType() {
			*ds = append(*ds, diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: arr_includes arg2 type %s does not match array element type %s",
				bindingName, t2, t1.ElemType()))
		}
	case spec.isArrConcat:
		if ok1 && !t1.IsArray() {
			*ds = append(*ds, diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: arr_concat arg1 must be array, got %s", bindingName, t1))
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

func resolveLocalCallReturn(spec fnSpec, types []ast.FieldType, known []bool) (ast.FieldType, bool) {
	switch {
	case spec.isGeneric, spec.isArrInc:
		return ast.FieldTypeBool, true
	case spec.isArrGet:
		if len(types) >= 1 && known[0] && types[0].IsArray() {
			return types[0].ElemType(), true
		}
		return 0, false
	case spec.isArrConcat:
		if len(types) >= 1 && known[0] {
			return types[0], true
		}
		return 0, false
	default:
		return spec.returnType, true
	}
}

func validatePattern(bindingName string, pattern ast.LocalCasePattern, subjectType ast.FieldType, subjectKnown bool, ds *diag.Diagnostics) {
	switch p := pattern.(type) {
	case *ast.LiteralCasePattern:
		patternType, ok := ast.LiteralFieldType(p.Value)
		if ok && subjectKnown && patternType != subjectType {
			*ds = append(*ds, diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: #case literal pattern has type %s but subject has type %s",
				bindingName, patternType, subjectType))
		}
	case *ast.TupleCasePattern:
		for _, elem := range p.Elems {
			validatePattern(bindingName, elem, subjectType, false, ds)
		}
	}
}

func scopeWithPatternBindings(scope map[string]bindingInfo, pattern ast.LocalCasePattern, subjectType ast.FieldType, subjectKnown bool) map[string]bindingInfo {
	next := scope
	copied := false
	var add func(ast.LocalCasePattern)
	add = func(p ast.LocalCasePattern) {
		switch x := p.(type) {
		case *ast.VarBinderPattern:
			if !copied {
				next = make(map[string]bindingInfo, len(scope)+1)
				for k, v := range scope {
					next[k] = v
				}
				copied = true
			}
			if subjectKnown {
				next[x.Name] = bindingInfo{fieldType: subjectType}
			}
		case *ast.TupleCasePattern:
			for _, elem := range x.Elems {
				add(elem)
			}
		}
	}
	add(pattern)
	return next
}

// ─────────────────────────────────────────────────────────────────────────────
// Group C — Effect DSL / sigil validation
// ─────────────────────────────────────────────────────────────────────────────

func validateActionEffects(a *turnoutpb.ActionModel, scope map[string]bindingInfo, schema state.Schema, ds *diag.Diagnostics) {
	preparedNames := map[string]bool{}
	mergedNames := map[string]bool{}

	seen := map[string]bool{}
	for _, e := range a.Prepare {
		if seen[e.Binding] {
			*ds = append(*ds, diag.Errorf(diag.CodeDuplicatePrepareEntry,
				"action %q: duplicate prepare entry for binding %q", a.Id, e.Binding))
			continue
		}
		seen[e.Binding] = true
		preparedNames[e.Binding] = true

		if _, ok := scope[e.Binding]; !ok {
			*ds = append(*ds, diag.Errorf(diag.CodeUnresolvedPrepareBinding,
				"action %q: prepare binding %q not found in prog", a.Id, e.Binding))
		}

		if e.FromState != nil {
			validateStatePath(*e.FromState, schema, ds)
		}
	}

	seen = map[string]bool{}
	for _, e := range a.Merge {
		if seen[e.Binding] {
			*ds = append(*ds, diag.Errorf(diag.CodeDuplicateMergeEntry,
				"action %q: duplicate merge entry for binding %q", a.Id, e.Binding))
			continue
		}
		seen[e.Binding] = true
		mergedNames[e.Binding] = true

		srcInfo, inScope := scope[e.Binding]
		if !inScope {
			*ds = append(*ds, diag.Errorf(diag.CodeUnresolvedMergeBinding,
				"action %q: merge binding %q not found in prog", a.Id, e.Binding))
		}

		if e.ToState != "" {
			if !isValidStatePath(e.ToState) {
				*ds = append(*ds, diag.Errorf(diag.CodeInvalidStatePath,
					"action %q: to_state %q is not a valid dotted path", a.Id, e.ToState))
			} else if meta, ok := schema[e.ToState]; !ok {
				*ds = append(*ds, diag.Errorf(diag.CodeUnresolvedStatePath,
					"action %q: to_state %q is not declared in the state schema", a.Id, e.ToState))
			} else if inScope && srcInfo.fieldType != meta.Type {
				*ds = append(*ds, diag.Errorf(diag.CodeStateTypeMismatch,
					"action %q: merge binding %q has type %s but STATE field %q has type %s",
					a.Id, e.Binding, srcInfo.fieldType, e.ToState, meta.Type))
			}
		}
	}

	for name, info := range scope {
		switch info.sigil {
		case ast.SigilIngress:
			if !preparedNames[name] {
				*ds = append(*ds, diag.Errorf(diag.CodeMissingPrepareEntry,
					"action %q: binding %q has ~> sigil but no prepare entry", a.Id, name))
			}
		case ast.SigilEgress:
			if !mergedNames[name] {
				*ds = append(*ds, diag.Errorf(diag.CodeMissingMergeEntry,
					"action %q: binding %q has <~ sigil but no merge entry", a.Id, name))
			}
		case ast.SigilBiDir:
			inPrepare := preparedNames[name]
			inMerge := mergedNames[name]
			if !inPrepare && !inMerge {
				*ds = append(*ds, diag.Errorf(diag.CodeMissingPrepareEntry,
					"action %q: binding %q has <~> sigil but no prepare entry", a.Id, name))
				*ds = append(*ds, diag.Errorf(diag.CodeMissingMergeEntry,
					"action %q: binding %q has <~> sigil but no merge entry", a.Id, name))
			} else if inPrepare && !inMerge {
				*ds = append(*ds, diag.Errorf(diag.CodeBidirMissingMergeEntry,
					"action %q: binding %q has <~> sigil: appears in prepare but not in merge", a.Id, name))
			} else if !inPrepare && inMerge {
				*ds = append(*ds, diag.Errorf(diag.CodeBidirMissingPrepareEntry,
					"action %q: binding %q has <~> sigil: appears in merge but not in prepare", a.Id, name))
			}
		}
	}

	for name := range preparedNames {
		info, ok := scope[name]
		if !ok {
			continue
		}
		if info.sigil != ast.SigilIngress && info.sigil != ast.SigilBiDir {
			*ds = append(*ds, diag.Errorf(diag.CodeSpuriousPrepareEntry,
				"action %q: prepare entry for %q has no corresponding ~> or <~> sigil in prog", a.Id, name))
		}
	}
	for name := range mergedNames {
		info, ok := scope[name]
		if !ok {
			continue
		}
		if info.sigil != ast.SigilEgress && info.sigil != ast.SigilBiDir {
			*ds = append(*ds, diag.Errorf(diag.CodeSpuriousMergeEntry,
				"action %q: merge entry for %q has no corresponding <~ or <~> sigil in prog", a.Id, name))
		}
	}
}

func validateNextRule(nr *turnoutpb.NextRuleModel, schema state.Schema, sc *lower.Sidecar, sceneID, actionID, scopeName string, ds *diag.Diagnostics) {
	for _, e := range nr.Prepare {
		count := 0
		if e.FromAction != nil {
			count++
		}
		if e.FromState != nil {
			count++
		}
		if e.FromLiteral != nil {
			count++
		}
		if count != 1 {
			*ds = append(*ds, diag.Errorf(diag.CodeInvalidTransitionIngress,
				"transition prepare entry for %q must have exactly one of from_action, from_state, from_literal; got %d",
				e.Binding, count))
		}
		if e.FromState != nil {
			validateStatePath(*e.FromState, schema, ds)
		}
	}

	if nr.Compute == nil {
		return
	}

	nextScope := validateProg(nr.Compute.Prog, schema, true, sc, sceneID, actionID, scopeName, ds)

	if cond := nr.Compute.Condition; cond != "" {
		info, ok := nextScope[cond]
		if !ok {
			*ds = append(*ds, diag.Errorf(diag.CodeSCNNextComputeNotBool,
				"next rule condition %q is not defined in prog", cond))
		} else if info.fieldType != ast.FieldTypeBool {
			*ds = append(*ds, diag.Errorf(diag.CodeSCNNextComputeNotBool,
				"next rule condition %q has type %s; bool required", cond, info.fieldType))
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Group A — State path validation
// ─────────────────────────────────────────────────────────────────────────────

func validateStatePath(path string, schema state.Schema, ds *diag.Diagnostics) {
	if !isValidStatePath(path) {
		*ds = append(*ds, diag.Errorf(diag.CodeInvalidStatePath,
			"state path %q is not a valid dotted path (must be IDENT.IDENT+)", path))
		return
	}
	if _, ok := schema[path]; !ok {
		*ds = append(*ds, diag.Errorf(diag.CodeUnresolvedStatePath,
			"state path %q is not declared in the state schema", path))
	}
}

func isValidStatePath(path string) bool {
	parts := strings.Split(path, ".")
	if len(parts) < 2 {
		return false
	}
	for _, p := range parts {
		if !isIdent(p) {
			return false
		}
	}
	return true
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

func validateArgRefs(bindingName string, arg *turnoutpb.ArgModel, scope map[string]bindingInfo, ds *diag.Diagnostics) {
	if arg.Ref != nil && *arg.Ref != "" {
		if _, ok := scope[*arg.Ref]; !ok {
			*ds = append(*ds, diag.Errorf(diag.CodeUndefinedRef,
				"binding %q: reference %q is not defined", bindingName, *arg.Ref))
		}
	}
	if arg.FuncRef != nil && *arg.FuncRef != "" {
		info, ok := scope[*arg.FuncRef]
		if !ok {
			*ds = append(*ds, diag.Errorf(diag.CodeUndefinedFuncRef,
				"binding %q: func_ref %q is not defined", bindingName, *arg.FuncRef))
		} else if !info.isFunc {
			*ds = append(*ds, diag.Errorf(diag.CodeUndefinedFuncRef,
				"binding %q: func_ref %q references a value binding; a function binding is required",
				bindingName, *arg.FuncRef))
		}
	}
}

func resolveExpectedReturn(spec fnSpec, args []*turnoutpb.ArgModel, scope map[string]bindingInfo, stepTypes []ast.FieldType) (ast.FieldType, bool) {
	switch {
	case spec.isGeneric, spec.isArrInc:
		return ast.FieldTypeBool, true
	case spec.isArrGet:
		if len(args) >= 1 {
			t, ok := resolveArgType(args[0], scope, stepTypes)
			if ok && t.IsArray() {
				return t.ElemType(), true
			}
		}
		return 0, false
	case spec.isArrConcat:
		if len(args) >= 1 {
			t, ok := resolveArgType(args[0], scope, stepTypes)
			if ok {
				return t, true
			}
		}
		return 0, false
	default:
		return spec.returnType, true
	}
}

func resolveArgType(arg *turnoutpb.ArgModel, scope map[string]bindingInfo, stepTypes []ast.FieldType) (ast.FieldType, bool) {
	if arg.Ref != nil {
		if info, ok := scope[*arg.Ref]; ok {
			return info.fieldType, true
		}
		return 0, false
	}
	if arg.Lit != nil {
		return structpbFieldType(arg.Lit)
	}
	if arg.FuncRef != nil {
		if info, ok := scope[*arg.FuncRef]; ok {
			return info.fieldType, true
		}
		return 0, false
	}
	if arg.StepRef != nil && stepTypes != nil {
		idx := int(*arg.StepRef)
		if idx >= 0 && idx < len(stepTypes) && stepTypes[idx] != 0 {
			return stepTypes[idx], true
		}
	}
	return 0, false
}

func validateCombineArgTypes(bindingName string, c *turnoutpb.CombineExpr, spec fnSpec, scope map[string]bindingInfo, ds *diag.Diagnostics) {
	if len(c.Args) < 2 {
		return
	}
	arg1Type, ok1 := resolveArgType(c.Args[0], scope, nil)
	arg2Type, ok2 := resolveArgType(c.Args[1], scope, nil)

	switch {
	case spec.isGeneric:
		if ok1 && ok2 && arg1Type != arg2Type {
			*ds = append(*ds, diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: %s requires homogeneous operand types, got %s and %s",
				bindingName, c.Fn, arg1Type, arg2Type))
		}
	case spec.isArrGet:
		if ok1 && !arg1Type.IsArray() {
			*ds = append(*ds, diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: arr_get arg1 must be an array type, got %s", bindingName, arg1Type))
		}
		if ok2 && arg2Type != ast.FieldTypeNumber {
			*ds = append(*ds, diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: arr_get arg2 must be number, got %s", bindingName, arg2Type))
		}
	case spec.isArrInc:
		if ok1 && !arg1Type.IsArray() {
			*ds = append(*ds, diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: arr_includes arg1 must be an array type, got %s", bindingName, arg1Type))
		}
		if ok1 && ok2 && arg1Type.IsArray() && arg2Type != arg1Type.ElemType() {
			*ds = append(*ds, diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: arr_includes arg2 type %s does not match array element type %s",
				bindingName, arg2Type, arg1Type.ElemType()))
		}
	case spec.isArrConcat:
		if ok1 && !arg1Type.IsArray() {
			*ds = append(*ds, diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: arr_concat arg1 must be an array type, got %s", bindingName, arg1Type))
		}
		if ok1 && ok2 && arg1Type != arg2Type {
			*ds = append(*ds, diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: arr_concat arg types must match, got %s and %s",
				bindingName, arg1Type, arg2Type))
		}
	default:
		if ok1 && arg1Type != spec.arg1Type {
			*ds = append(*ds, diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: %s arg1 expects %s, got %s", bindingName, c.Fn, spec.arg1Type, arg1Type))
		}
		if ok2 && arg2Type != spec.arg2Type {
			*ds = append(*ds, diag.Errorf(diag.CodeArgTypeMismatch,
				"binding %q: %s arg2 expects %s, got %s", bindingName, c.Fn, spec.arg2Type, arg2Type))
		}
	}
}

// isIdentityCombine reports whether c is a canonical identity combine emitted
// by the lowerer for the single-reference form.
func isIdentityCombine(c *turnoutpb.CombineExpr) bool {
	identityFns := map[string]bool{"bool_and": true, "add": true, "str_concat": true, "arr_concat": true}
	if !identityFns[c.Fn] || len(c.Args) != 2 || c.Args[0].Ref == nil || c.Args[1].Lit == nil {
		return false
	}
	switch c.Fn {
	case "bool_and":
		bv, ok := c.Args[1].Lit.Kind.(*structpb.Value_BoolValue)
		return ok && bv.BoolValue
	case "add":
		nv, ok := c.Args[1].Lit.Kind.(*structpb.Value_NumberValue)
		return ok && nv.NumberValue == 0
	case "str_concat":
		sv, ok := c.Args[1].Lit.Kind.(*structpb.Value_StringValue)
		return ok && sv.StringValue == ""
	case "arr_concat":
		lv, ok := c.Args[1].Lit.Kind.(*structpb.Value_ListValue)
		return ok && (lv.ListValue == nil || len(lv.ListValue.Values) == 0)
	}
	return false
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview DSL enforcement (scene-graph.md §9)
// ─────────────────────────────────────────────────────────────────────────────

type flowEdge struct{ from, to string }

func parseFlow(flowText, sceneID string, ds *diag.Diagnostics) (nodes []string, edges []flowEdge, ok bool) {
	var current string
	seen := make(map[string]bool)
	for _, raw := range strings.Split(flowText, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "|=>") {
			target := strings.TrimSpace(line[3:])
			if !isIdent(target) {
				*ds = append(*ds, diag.Errorf(diag.CodeOverviewParseError,
					"scene %q: flow has malformed edge target %q", sceneID, target))
				return nil, nil, false
			}
			if current == "" {
				*ds = append(*ds, diag.Errorf(diag.CodeOverviewParseError,
					"scene %q: flow has edge %q before any source node", sceneID, target))
				return nil, nil, false
			}
			edges = append(edges, flowEdge{from: current, to: target})
			if !seen[target] {
				seen[target] = true
				nodes = append(nodes, target)
			}
		} else {
			if !isIdent(line) {
				*ds = append(*ds, diag.Errorf(diag.CodeOverviewParseError,
					"scene %q: flow has invalid node identifier %q", sceneID, line))
				return nil, nil, false
			}
			current = line
			if !seen[line] {
				seen[line] = true
				nodes = append(nodes, line)
			}
		}
	}
	return nodes, edges, true
}

func validateOverview(scene *turnoutpb.SceneBlock, actionIndex map[string]*turnoutpb.ActionModel, sc *lower.Sidecar, ds *diag.Diagnostics) {
	if sc == nil {
		return
	}
	sceneMeta, ok := sc.Scenes[scene.Id]
	if !ok || sceneMeta.View == nil {
		return
	}
	v := sceneMeta.View

	switch v.Enforce {
	case "nodes_only", "at_least", "strict":
	default:
		*ds = append(*ds, diag.Errorf(diag.CodeOverviewInvalidMode,
			"scene %q: view %q has unknown enforce mode %q", scene.Id, v.Name, v.Enforce))
		return
	}

	flowNodes, flowEdges, ok := parseFlow(v.Flow, scene.Id, ds)
	if !ok {
		return
	}

	implEdges := make(map[flowEdge]bool)
	for _, a := range scene.Actions {
		for _, nr := range a.Next {
			if nr.Action != "" {
				implEdges[flowEdge{from: a.Id, to: nr.Action}] = true
			}
		}
	}

	for _, node := range flowNodes {
		if _, exists := actionIndex[node]; !exists {
			*ds = append(*ds, diag.Errorf(diag.CodeOverviewUnknownNode,
				"scene %q: flow references unknown action %q", scene.Id, node))
		}
	}

	if v.Enforce == "nodes_only" {
		return
	}

	for _, e := range flowEdges {
		if !implEdges[e] {
			*ds = append(*ds, diag.Errorf(diag.CodeOverviewMissingEdge,
				"scene %q: flow declares edge %s |=> %s but no such next rule exists", scene.Id, e.from, e.to))
		}
	}

	if v.Enforce == "strict" {
		flowNodeSet := make(map[string]bool, len(flowNodes))
		for _, n := range flowNodes {
			flowNodeSet[n] = true
		}
		flowEdgeSet := make(map[flowEdge]bool, len(flowEdges))
		for _, e := range flowEdges {
			flowEdgeSet[e] = true
		}

		for _, a := range scene.Actions {
			if !flowNodeSet[a.Id] {
				*ds = append(*ds, diag.Errorf(diag.CodeOverviewExtraNode,
					"scene %q: action %q exists but is not listed in flow", scene.Id, a.Id))
			}
		}

		for e := range implEdges {
			if !flowEdgeSet[e] {
				*ds = append(*ds, diag.Errorf(diag.CodeOverviewExtraEdge,
					"scene %q: next rule %s |=> %s exists but is not declared in flow", scene.Id, e.from, e.to))
			}
		}
	}
}

func isIdent(s string) bool {
	if len(s) == 0 {
		return false
	}
	c := s[0]
	if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_') {
		return false
	}
	for i := 1; i < len(s); i++ {
		c = s[i]
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_' || (c >= '0' && c <= '9')) {
			return false
		}
	}
	return true
}

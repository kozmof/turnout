// Package validate runs all structural and type-checking rules against the
// lowered proto model. All diagnostics are collected before returning so
// callers see every error in one pass. Validation failures leave the model
// unmodified; no partial output is produced.
package validate

import (
	"fmt"
	"strings"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/localexpr"
	"github.com/kozmof/turnout/packages/go/converter/internal/lower"
	"github.com/kozmof/turnout/packages/go/converter/internal/names"
	"github.com/kozmof/turnout/packages/go/converter/internal/overview"
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

// fnKind classifies the special dispatch behaviour of a built-in function.
// The four array/generic variants are mutually exclusive; operatorOnly is orthogonal.
type fnKind int

const (
	fnKindStandard  fnKind = iota // regular typed binary function
	fnKindGeneric                 // eq/neq: both operands must share the same type
	fnKindArrGet                  // arr_get: returns element type of arg1
	fnKindArrInc                  // arr_includes: returns bool
	fnKindArrConcat               // arr_concat: returns same array type as arg1
)

type fnSpec struct {
	arg1Type     ast.FieldType
	arg2Type     ast.FieldType
	returnType   ast.FieldType
	operatorOnly bool
	kind         fnKind
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
	"eq":           {returnType: ast.FieldTypeBool, operatorOnly: true, kind: fnKindGeneric},
	"neq":          {returnType: ast.FieldTypeBool, operatorOnly: true, kind: fnKindGeneric},
	"arr_includes": {kind: fnKindArrInc},
	"arr_get":      {kind: fnKindArrGet},
	"arr_concat":   {kind: fnKindArrConcat},
}

// ─────────────────────────────────────────────────────────────────────────────
// Sigil index — O(1) lookup replacing the prior O(N) linear scan
// ─────────────────────────────────────────────────────────────────────────────

// sigilIndex maps "sceneID:actionID:scope:progName:bindingName" → Sigil.
type sigilIndex map[string]ast.Sigil

func buildSigilIndex(annotations *turnoutpb.SigilAnnotations) sigilIndex {
	idx := make(sigilIndex, len(annotations.GetEntries()))
	for _, e := range annotations.GetEntries() {
		key := fmt.Sprintf("%s:%s:%s:%s:%s",
			e.GetSceneId(), e.GetActionId(), e.GetScope(), e.GetProgName(), e.GetBindingName())
		idx[key] = ast.Sigil(e.GetSigil())
	}
	return idx
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

// Validate runs all structural and type validation rules against the proto model.
// Sigil metadata is read from tm.Annotations (populated by the lowerer).
// schema may be nil. Returns diagnostics; callers must check HasErrors() before
// proceeding to emission.
func Validate(tm *turnoutpb.TurnModel, schema state.Schema) diag.Diagnostics {
	var ds diag.Diagnostics
	if tm == nil {
		return ds
	}
	idx := buildSigilIndex(tm.Annotations)
	seenSceneIDs := make(map[string]bool)
	for _, s := range tm.Scenes {
		if seenSceneIDs[s.Id] {
			ds = append(ds, diag.Errorf("DuplicateSceneID",
				"duplicate scene ID %q", s.Id))
		}
		seenSceneIDs[s.Id] = true
		validateScene(s, schema, idx, &ds)
	}
	if len(tm.Routes) > 0 {
		knownScenes, knownActions := buildKnownScenesAndActions(tm)
		validateRoutes(tm.Routes, knownScenes, knownActions, &ds)
	}
	return ds
}

func buildKnownScenesAndActions(tm *turnoutpb.TurnModel) (map[string]bool, map[string]map[string]bool) {
	scenes := make(map[string]bool, len(tm.Scenes))
	actions := make(map[string]map[string]bool, len(tm.Scenes))
	for _, s := range tm.Scenes {
		scenes[s.Id] = true
		actionSet := make(map[string]bool, len(s.Actions))
		for _, a := range s.Actions {
			actionSet[a.Id] = true
		}
		actions[s.Id] = actionSet
	}
	return scenes, actions
}

// ─────────────────────────────────────────────────────────────────────────────
// Group E — Route validation
// ─────────────────────────────────────────────────────────────────────────────

func validateRoutes(routes []*turnoutpb.RouteModel, knownScenes map[string]bool, knownActions map[string]map[string]bool, ds *diag.Diagnostics) {
	for _, r := range routes {
		validateRoute(r, knownScenes, knownActions, ds)
	}
}

func validateRoute(r *turnoutpb.RouteModel, knownScenes map[string]bool, knownActions map[string]map[string]bool, ds *diag.Diagnostics) {
	if r.EntrySceneId == nil || *r.EntrySceneId == "" {
		*ds = append(*ds, diag.Errorf(diag.CodeMissingEntryScene,
			"route %q: missing entry declaration", r.Id))
	} else if !knownScenes[*r.EntrySceneId] {
		*ds = append(*ds, diag.Errorf(diag.CodeUnresolvedEntryScene,
			"route %q: entry scene %q is not defined", r.Id, *r.EntrySceneId))
	}
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
			validateRoutePattern(r.Id, i, pat, knownActions, ds)
		}
	}
}

func validateRoutePattern(routeID string, armIdx int, pat string, knownActions map[string]map[string]bool, ds *diag.Diagnostics) {
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
		return
	}

	// Cross-check: for direct scene_id.action_id patterns (exactly 2 segments,
	// no wildcards), verify the action ID exists in the named scene.
	// Wildcard patterns (scene_id.*.terminal) are skipped because the terminal
	// action may live in a downstream scene reached via routing.
	// Skip if the scene is unknown (already reported as UnresolvedScene).
	if len(parts) == 2 {
		sceneID := parts[0]
		actionID := parts[1]
		if actionSet, sceneKnown := knownActions[sceneID]; sceneKnown {
			if !actionSet[actionID] {
				*ds = append(*ds, diag.Errorf(diag.CodeUnresolvedAction,
					"route %q arm %d: pattern %q references action %q which does not exist in scene %q",
					routeID, armIdx, pat, actionID, sceneID))
			}
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Group D — Scene structural validation
// ─────────────────────────────────────────────────────────────────────────────

func validateScene(scene *turnoutpb.SceneBlock, schema state.Schema, idx sigilIndex, ds *diag.Diagnostics) {
	actionIndex := make(map[string]*turnoutpb.ActionModel, len(scene.Actions))
	for _, a := range scene.Actions {
		if _, exists := actionIndex[a.Id]; exists {
			*ds = append(*ds, diag.Errorf(diag.CodeDuplicateActionLabel,
				"duplicate action ID %q in scene %q", a.Id, scene.Id))
		} else {
			actionIndex[a.Id] = a
		}
	}

	validateOverview(scene, actionIndex, ds)

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

	// Build a map of action ID → compute scope for from_action cross-checks (3-A, 3-B).
	actionScopes := make(map[string]map[string]bindingInfo, len(scene.Actions))

	for _, a := range scene.Actions {
		var scope map[string]bindingInfo

		if a.Compute != nil {
			scope = validateProg(a.Compute.Prog, schema, false, idx, scene.Id, a.Id, lower.ComputeScope(), ds)

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
		actionScopes[a.Id] = scope

		for i, nr := range a.Next {
			if nr.Action != "" {
				if _, ok := actionIndex[nr.Action]; !ok {
					*ds = append(*ds, diag.Errorf(diag.CodeSCNInvalidActionGraph,
						"action %q: next rule references unknown action %q", a.Id, nr.Action))
				}
			}
			validateNextRule(nr, schema, idx, scene.Id, a.Id, lower.NextScope(i), scope, ds)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Group B — Prog / binding validation
// ─────────────────────────────────────────────────────────────────────────────

func validateProg(prog *turnoutpb.ProgModel, schema state.Schema, isTransition bool, idx sigilIndex, sceneID, actionID string, scopeName lower.ProgScope, ds *diag.Diagnostics) map[string]bindingInfo {
	if prog == nil {
		return map[string]bindingInfo{}
	}
	scope, adj := buildBindingScope(prog, idx, sceneID, actionID, scopeName, ds)
	detectCycles(prog.Name, adj, prog.Bindings, ds)
	validateBindingTypes(prog, scope, isTransition, idx, sceneID, actionID, scopeName, ds)
	return scope
}

// buildBindingScope registers all bindings into the scope map, detects duplicate
// names, records sigils, and builds the adjacency map used by detectCycles.
func buildBindingScope(prog *turnoutpb.ProgModel, idx sigilIndex, sceneID, actionID string, scopeName lower.ProgScope, ds *diag.Diagnostics) (map[string]bindingInfo, map[string][]string) {
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
		ft, _ := ast.FieldTypeFromString(b.Type)
		sigil := sigilFor(idx, sceneID, actionID, scopeName, prog.Name, b.Name)
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
		adj[b.Name] = refs
	}
	return scope, adj
}

// validateBindingTypes runs per-binding structural and type checks against the
// already-built scope. Handles reserved names, transition sigil constraints,
// literal type conformance, and expr/ext_expr type checking.
func validateBindingTypes(prog *turnoutpb.ProgModel, scope map[string]bindingInfo, isTransition bool, idx sigilIndex, sceneID, actionID string, scopeName lower.ProgScope, ds *diag.Diagnostics) {
	for _, b := range prog.Bindings {
		ft, _ := ast.FieldTypeFromString(b.Type)
		sigil := sigilFor(idx, sceneID, actionID, scopeName, prog.Name, b.Name)

		if strings.HasPrefix(b.Name, "__") {
			if !(strings.HasPrefix(b.Name, names.GeneratedIfCondPrefix) && strings.HasSuffix(b.Name, names.GeneratedIfCondSuffix)) &&
				!strings.HasPrefix(b.Name, names.GeneratedLocalPrefix) {
				*ds = append(*ds, diag.Errorf(diag.CodeReservedName,
					"binding %q: names starting with __ are reserved", b.Name))
			}
		}

		if isTransition && (sigil == ast.SigilEgress || sigil == ast.SigilBiDir) {
			*ds = append(*ds, diag.Errorf(diag.CodeTransitionOutputSigil,
				"binding %q: output sigil %s is not allowed in transition progs", b.Name, sigil))
		}

		if b.ExtExpr != nil {
			validateNoEmptyArrayLitArgs(b, ds)
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

// sigilFor looks up the sigil for a binding from the pre-built index.
func sigilFor(idx sigilIndex, sceneID, actionID string, scope lower.ProgScope, progName, bindingName string) ast.Sigil {
	key := fmt.Sprintf("%s:%s:%s:%s:%s", sceneID, actionID, scope, progName, bindingName)
	return idx[key]
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
		return nil
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
		// Null or unrecognised structpb variant; return nil so callers treat it
		// as "type unknown" rather than silently coercing to numeric zero.
		return nil
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
		*ds = append(*ds, diag.Errorf(diag.CodeUnsupportedConstruct,
			"binding %q: #case tuple patterns are not supported; use _ to ignore the subject, or a variable binder (e.g. x) to capture it", bindingName))
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
			} else if meta, ok := schema.Get(e.ToState); !ok {
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

func validateNextRule(nr *turnoutpb.NextRuleModel, schema state.Schema, idx sigilIndex, sceneID, actionID string, scopeName lower.ProgScope, actionScope map[string]bindingInfo, ds *diag.Diagnostics) {
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
		// 3-A: verify the from_action binding exists in the source action's compute prog.
		if e.FromAction != nil {
			srcName := *e.FromAction
			if _, ok := actionScope[srcName]; !ok {
				*ds = append(*ds, diag.Errorf(diag.CodeNextPrepareFromActionUnknown,
					"action %q: next prepare binding %q references from_action %q which does not exist in this action's compute prog",
					actionID, e.Binding, srcName))
			}
		}
	}

	if nr.Compute == nil {
		return
	}

	nextScope := validateProg(nr.Compute.Prog, schema, true, idx, sceneID, actionID, scopeName, ds)

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

	// 3-B: verify type consistency between from_action source and target binding.
	for _, e := range nr.Prepare {
		if e.FromAction == nil {
			continue
		}
		srcName := *e.FromAction
		srcInfo, srcOK := actionScope[srcName]
		dstInfo, dstOK := nextScope[e.Binding]
		if srcOK && dstOK && srcInfo.fieldType != dstInfo.fieldType {
			*ds = append(*ds, diag.Errorf(diag.CodeNextPrepareFromActionTypeMismatch,
				"action %q: next prepare binding %q (type %s) does not match from_action %q (type %s)",
				actionID, e.Binding, dstInfo.fieldType, srcName, srcInfo.fieldType))
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
	if _, ok := schema.Get(path); !ok {
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
	switch spec.kind {
	case fnKindGeneric, fnKindArrInc:
		return ast.FieldTypeBool, true
	case fnKindArrGet:
		if len(args) >= 1 {
			t, ok := resolveArgType(args[0], scope, stepTypes)
			if ok && t.IsArray() {
				return t.ElemType(), true
			}
		}
		return 0, false
	case fnKindArrConcat:
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
	validateBinaryArgTypePair(bindingName, c.Fn, spec, arg1Type, ok1, arg2Type, ok2, ds)
	for i := range c.Args[2:] {
		*ds = append(*ds, diag.Errorf(diag.CodeArgTypeMismatch,
			"binding %q: function %q does not accept more than 2 arguments (extra arg at index %d)", bindingName, c.Fn, i+2))
	}
}

// argHasEmptyArrayLit reports whether arg carries an empty array literal.
func argHasEmptyArrayLit(arg *turnoutpb.ArgModel) bool {
	if arg == nil || arg.Lit == nil {
		return false
	}
	lv, ok := arg.Lit.Kind.(*structpb.Value_ListValue)
	return ok && (lv.ListValue == nil || len(lv.ListValue.Values) == 0)
}

// validateNoEmptyArrayLitArgs emits CodeEmptyArrayLitArg for any empty array
// literal used as an inline function argument. Empty arrays are type-ambiguous
// at runtime (hcl-context-builder.ts cannot infer the element type), so they
// must be caught here so authors get a clear diagnostic at conversion time.
//
// Identity combines (e.g. arr_concat(x, [])) are exempt: the lowerer generates
// them for single-reference array bindings and the [] carries an implicit type
// from the other operand.
//
// For #if/#case/#pipe bindings (b.ExtExpr != nil), the structured local
// expression tree is walked to catch empty array call-args that are not visible
// in the flat Expr form (which the caller skips via continue).
func validateNoEmptyArrayLitArgs(b *turnoutpb.BindingModel, ds *diag.Diagnostics) {
	if b.ExtExpr != nil {
		localexpr.WalkProto(b.ExtExpr, func(node *turnoutpb.LocalExprModel) {
			call, ok := node.Expr.(*turnoutpb.LocalExprModel_Call)
			if !ok {
				return
			}
			for _, arg := range call.Call.GetArgs() {
				if isEmptyArrayLocalLit(arg) {
					*ds = append(*ds, diag.Errorf(diag.CodeEmptyArrayLitArg,
						"binding %q: empty array literal used as inline function argument is type-ambiguous; "+
							"use a named binding with a declared type instead (e.g. x: arr<number> = [])", b.Name))
				}
			}
		})
		return
	}
	if b.Expr == nil {
		return
	}
	check := func(arg *turnoutpb.ArgModel) {
		if argHasEmptyArrayLit(arg) {
			*ds = append(*ds, diag.Errorf(diag.CodeEmptyArrayLitArg,
				"binding %q: empty array literal used as inline function argument is type-ambiguous; "+
					"use a named binding with a declared type instead (e.g. x: arr<number> = [])", b.Name))
		}
	}
	if c := b.Expr.Combine; c != nil && !isIdentityCombine(c) {
		for _, arg := range c.Args {
			check(arg)
		}
	}
	if p := b.Expr.Pipe; p != nil {
		for _, step := range p.Steps {
			for _, arg := range step.Args {
				check(arg)
			}
		}
	}
	if cond := b.Expr.Cond; cond != nil {
		check(cond.Condition)
		check(cond.Then)
		check(cond.ElseBranch)
	}
}

// isEmptyArrayLocalLit reports whether e is a LocalLitExprModel whose value is
// an empty array. Used to detect type-ambiguous [] in local expression call args.
func isEmptyArrayLocalLit(e *turnoutpb.LocalExprModel) bool {
	if e == nil {
		return false
	}
	litNode, ok := e.Expr.(*turnoutpb.LocalExprModel_Lit)
	if !ok || litNode.Lit == nil || litNode.Lit.GetValue() == nil {
		return false
	}
	lv, ok := litNode.Lit.GetValue().Kind.(*structpb.Value_ListValue)
	return ok && (lv.ListValue == nil || len(lv.ListValue.Values) == 0)
}

// identityElement maps each identity-combine function to a predicate that
// returns true when a structpb.Value is that function's algebraic identity:
//
//	bool_and → true   (x & true  == x)
//	add      → 0      (x + 0     == x)
//	str_concat → ""   (x ++ ""   == x)
//	arr_concat → []   (x ++ []   == x)
var identityElement = map[string]func(*structpb.Value) bool{
	"bool_and": func(v *structpb.Value) bool {
		bv, ok := v.Kind.(*structpb.Value_BoolValue)
		return ok && bv.BoolValue
	},
	"add": func(v *structpb.Value) bool {
		nv, ok := v.Kind.(*structpb.Value_NumberValue)
		return ok && nv.NumberValue == 0
	},
	"str_concat": func(v *structpb.Value) bool {
		sv, ok := v.Kind.(*structpb.Value_StringValue)
		return ok && sv.StringValue == ""
	},
	"arr_concat": func(v *structpb.Value) bool {
		lv, ok := v.Kind.(*structpb.Value_ListValue)
		return ok && (lv.ListValue == nil || len(lv.ListValue.Values) == 0)
	},
}

// isIdentityCombine reports whether c is the canonical identity lowering emitted
// by the lowerer for a single-reference binding (f(x, identity) ≡ x).
func isIdentityCombine(c *turnoutpb.CombineExpr) bool {
	isIdentity, ok := identityElement[c.Fn]
	if !ok || len(c.Args) != 2 || c.Args[0].Ref == nil || c.Args[1].Lit == nil {
		return false
	}
	return isIdentity(c.Args[1].Lit)
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview DSL enforcement (scene-graph.md §9)
// ─────────────────────────────────────────────────────────────────────────────

func compileErr(code, format string, args ...any) diag.Diagnostic {
	d := diag.Errorf(code, format, args...)
	d.Stage = "overview_compile"
	return d
}

func validateOverview(scene *turnoutpb.SceneBlock, actionIndex map[string]*turnoutpb.ActionModel, ds *diag.Diagnostics) {
	if scene.View == nil {
		return
	}
	v := scene.View

	if v.Name != "overview" {
		*ds = append(*ds, compileErr(diag.CodeOverviewUnknownView,
			"scene %q: view name must be \"overview\"; got %q", scene.Id, v.Name))
		return
	}

	enforce := ""
	if v.Enforce != nil {
		enforce = *v.Enforce
	}
	switch enforce {
	case "nodes_only", "at_least", "strict":
	default:
		*ds = append(*ds, compileErr(diag.CodeOverviewInvalidMode,
			"scene %q: view %q has unknown enforce mode %q", scene.Id, v.Name, enforce))
		return
	}

	g, parseDiags := overview.Parse(v.Flow, scene.Id)
	*ds = append(*ds, parseDiags...)
	if parseDiags.HasErrors() {
		return
	}

	actionIDs := make([]string, 0, len(scene.Actions))
	implEdges := make(map[overview.Edge]bool)
	for _, a := range scene.Actions {
		actionIDs = append(actionIDs, a.Id)
		for _, nr := range a.Next {
			if nr.Action != "" {
				implEdges[overview.Edge{From: a.Id, To: nr.Action}] = true
			}
		}
	}

	*ds = append(*ds, overview.Enforce(g, actionIDs, implEdges, enforce, scene.Id)...)
}

// ─────────────────────────────────────────────────────────────────────────────
// Binding cycle detection
// ─────────────────────────────────────────────────────────────────────────────

// detectCycles reports a CodeCyclicBinding diagnostic for each binding in
// bindings that participates in a reference cycle according to adj. Cycles
// cause infinite recursion in buildExecutionTree on the TypeScript side and
// must be caught at validation time.
func detectCycles(progName string, adj map[string][]string, bindings []*turnoutpb.BindingModel, ds *diag.Diagnostics) {
	const (
		unvisited = 0
		inStack   = 1
		done      = 2
	)
	color := make(map[string]int, len(bindings))
	reported := make(map[string]bool)
	stack := make([]string, 0, len(bindings))
	var visit func(name string)
	visit = func(name string) {
		switch color[name] {
		case done:
			return
		case inStack:
			if !reported[name] {
				reported[name] = true
				// Find where in the current DFS stack this cycle starts.
				cycleStart := 0
				for i, n := range stack {
					if n == name {
						cycleStart = i
						break
					}
				}
				// Use an explicit allocation so the cycle path never shares backing
				// memory with `stack`. append(stack[cycleStart:], name) would write
				// into the original array when cap(stack) > len(stack), corrupting
				// subsequent DFS frames.
				cycleLen := len(stack) - cycleStart
				path := make([]string, cycleLen+1)
				copy(path, stack[cycleStart:])
				path[cycleLen] = name
				*ds = append(*ds, diag.Errorf(diag.CodeCyclicBinding,
					"prog %q: binding cycle: %s", progName, strings.Join(path, " → ")))
			}
			return
		}
		color[name] = inStack
		stack = append(stack, name)
		for _, dep := range adj[name] {
			visit(dep)
		}
		stack = stack[:len(stack)-1]
		color[name] = done
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

// Package validate runs all structural and type-checking rules against the lowered Model.
// All diagnostics are collected before returning so callers see every error in one pass.
// Validation failures leave the Model unmodified; no partial output is produced.
package validate

import (
	"strings"

	"github.com/turnout/converter/internal/ast"
	"github.com/turnout/converter/internal/diag"
	"github.com/turnout/converter/internal/lower"
	"github.com/turnout/converter/internal/state"
)

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper types
// ─────────────────────────────────────────────────────────────────────────────

// bindingInfo holds the per-binding facts the validator accumulates in validateProg.
type bindingInfo struct {
	fieldType ast.FieldType
	isFunc    bool // true = Expr non-nil (function binding)
	sigil     ast.Sigil
}

// fnSpec describes one row in the built-in function alias table.
type fnSpec struct {
	arg1Type    ast.FieldType
	arg2Type    ast.FieldType
	returnType  ast.FieldType
	operatorOnly bool
	isGeneric   bool // eq/neq: any homogeneous type pair → bool
	isArrGet    bool // arr_get: arr<T>, number → T
	isArrInc    bool // arr_includes: arr<T>, T → bool
	isArrConcat bool // arr_concat: arr<T>, arr<T> → arr<T>
}

// ─────────────────────────────────────────────────────────────────────────────
// Built-in function alias table (hcl-context-spec.md §3.1)
// ─────────────────────────────────────────────────────────────────────────────

var builtinFns = map[string]fnSpec{
	// Number arithmetic — operator-only
	"add": {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeNumber, operatorOnly: true},
	"sub": {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeNumber, operatorOnly: true},
	"mul": {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeNumber, operatorOnly: true},
	"div": {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeNumber, operatorOnly: true},
	"mod": {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeNumber, operatorOnly: true},
	// Number arithmetic — call-only
	"max": {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeNumber},
	"min": {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeNumber},
	// Number comparison — operator-only
	"gt":  {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeBool, operatorOnly: true},
	"gte": {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeBool, operatorOnly: true},
	"lt":  {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeBool, operatorOnly: true},
	"lte": {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeBool, operatorOnly: true},
	// String — str_concat operator-only; rest call-only
	"str_concat":   {arg1Type: ast.FieldTypeStr, arg2Type: ast.FieldTypeStr, returnType: ast.FieldTypeStr, operatorOnly: true},
	"str_includes": {arg1Type: ast.FieldTypeStr, arg2Type: ast.FieldTypeStr, returnType: ast.FieldTypeBool},
	"str_starts":   {arg1Type: ast.FieldTypeStr, arg2Type: ast.FieldTypeStr, returnType: ast.FieldTypeBool},
	"str_ends":     {arg1Type: ast.FieldTypeStr, arg2Type: ast.FieldTypeStr, returnType: ast.FieldTypeBool},
	// Boolean — bool_and/bool_or operator-only; bool_xor call-only
	"bool_and": {arg1Type: ast.FieldTypeBool, arg2Type: ast.FieldTypeBool, returnType: ast.FieldTypeBool, operatorOnly: true},
	"bool_or":  {arg1Type: ast.FieldTypeBool, arg2Type: ast.FieldTypeBool, returnType: ast.FieldTypeBool, operatorOnly: true},
	"bool_xor": {arg1Type: ast.FieldTypeBool, arg2Type: ast.FieldTypeBool, returnType: ast.FieldTypeBool},
	// Generic equality — operator-only, polymorphic
	"eq":  {returnType: ast.FieldTypeBool, operatorOnly: true, isGeneric: true},
	"neq": {returnType: ast.FieldTypeBool, operatorOnly: true, isGeneric: true},
	// Array — call-only, polymorphic
	"arr_includes": {isArrInc: true},
	"arr_get":      {isArrGet: true},
	"arr_concat":   {isArrConcat: true},
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

// Validate runs all structural and type validation rules against the lowered Model.
// Returns diagnostics; callers must check HasErrors() before proceeding to emission.
func Validate(model *lower.Model, schema state.Schema) diag.Diagnostics {
	var ds diag.Diagnostics
	if model == nil {
		return ds
	}
	if model.Scene != nil {
		validateScene(model.Scene, schema, &ds)
	}
	if len(model.Routes) > 0 {
		knownScenes := buildKnownScenes(model)
		validateRoutes(model.Routes, knownScenes, &ds)
	}
	return ds
}

// buildKnownScenes returns a set of scene IDs present in the model.
func buildKnownScenes(model *lower.Model) map[string]bool {
	known := make(map[string]bool)
	if model.Scene != nil {
		known[model.Scene.ID] = true
	}
	return known
}

// ─────────────────────────────────────────────────────────────────────────────
// Group E — Route validation (per scene-to-scene.md §8)
// ─────────────────────────────────────────────────────────────────────────────

func validateRoutes(routes []*lower.HCLRouteBlock, knownScenes map[string]bool, ds *diag.Diagnostics) {
	for _, r := range routes {
		validateRoute(r, knownScenes, ds)
	}
}

func validateRoute(r *lower.HCLRouteBlock, knownScenes map[string]bool, ds *diag.Diagnostics) {
	catchAllCount := 0
	for i, arm := range r.Arms {
		// Validate target scene exists.
		if arm.Target != "" && !knownScenes[arm.Target] {
			*ds = append(*ds, diag.Errorf(diag.CodeUnresolvedScene,
				"route %q arm %d: target scene %q is not defined", r.ID, i, arm.Target))
		}
		for _, pat := range arm.Patterns {
			if pat == "_" {
				catchAllCount++
				if catchAllCount > 1 {
					*ds = append(*ds, diag.Errorf(diag.CodeDuplicateCatchAll,
						"route %q: match block has more than one _ catch-all arm", r.ID))
				}
				continue
			}
			validateRoutePattern(r.ID, i, pat, ds)
		}
	}
}

// validateRoutePattern validates a single non-catch-all path pattern string.
func validateRoutePattern(routeID string, armIdx int, pat string, ds *diag.Diagnostics) {
	parts := strings.Split(pat, ".")

	// Must have a non-empty, non-wildcard scene_id as the first segment.
	if len(parts) < 1 || parts[0] == "" || parts[0] == "*" {
		*ds = append(*ds, diag.Errorf(diag.CodeInvalidPathItem,
			"route %q arm %d: pattern %q has no valid scene_id prefix", routeID, armIdx, pat))
		return
	}

	// Must have at least one action segment after the scene_id.
	if len(parts) < 2 {
		*ds = append(*ds, diag.Errorf(diag.CodeBareWildcardPath,
			"route %q arm %d: pattern %q has no action segment after scene_id", routeID, armIdx, pat))
		return
	}

	// Count wildcards in action segments (parts[1:]).
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

	// Last segment must be a specific action_id, not *.
	if parts[len(parts)-1] == "*" {
		*ds = append(*ds, diag.Errorf(diag.CodeBareWildcardPath,
			"route %q arm %d: pattern %q ends with * (terminal action required)", routeID, armIdx, pat))
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Group D — Scene structural validation
// ─────────────────────────────────────────────────────────────────────────────

func validateScene(scene *lower.HCLSceneBlock, schema state.Schema, ds *diag.Diagnostics) {
	// Build action index; detect duplicates.
	actionIndex := make(map[string]*lower.HCLAction, len(scene.Actions))
	for _, a := range scene.Actions {
		if _, exists := actionIndex[a.ID]; exists {
			*ds = append(*ds, diag.Errorf(diag.CodeDuplicateActionLabel,
				"duplicate action ID %q in scene %q", a.ID, scene.ID))
		} else {
			actionIndex[a.ID] = a
		}
	}

	if len(scene.Actions) == 0 {
		*ds = append(*ds, diag.Errorf(diag.CodeSCNInvalidActionGraph,
			"scene %q has no actions", scene.ID))
	}

	if len(scene.EntryActions) == 0 {
		*ds = append(*ds, diag.Errorf(diag.CodeSCNInvalidActionGraph,
			"scene %q has no entry actions", scene.ID))
	}
	for _, ea := range scene.EntryActions {
		if _, ok := actionIndex[ea]; !ok {
			*ds = append(*ds, diag.Errorf(diag.CodeSCNInvalidActionGraph,
				"entry action %q not found in scene %q", ea, scene.ID))
		}
	}

	for _, a := range scene.Actions {
		var scope map[string]bindingInfo

		if a.Compute != nil {
			scope = validateProg(a.Compute.Prog, schema, false, ds)

			if a.Compute.Root != "" {
				if _, ok := scope[a.Compute.Root]; !ok {
					*ds = append(*ds, diag.Errorf(diag.CodeSCNActionRootNotFound,
						"action %q: compute.root %q not found in prog", a.ID, a.Compute.Root))
				}
			}

			validateActionEffects(a, scope, schema, ds)
		} else {
			scope = map[string]bindingInfo{}
		}
		_ = scope

		for _, nr := range a.Next {
			if nr.Action != "" {
				if _, ok := actionIndex[nr.Action]; !ok {
					*ds = append(*ds, diag.Errorf(diag.CodeSCNInvalidActionGraph,
						"action %q: next rule references unknown action %q", a.ID, nr.Action))
				}
			}
			validateNextRule(nr, schema, ds)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Group B — Prog / binding validation
// ─────────────────────────────────────────────────────────────────────────────

// validateProg validates all bindings in a prog block and returns a scope map.
// Uses a two-pass approach: first register all bindings (enabling forward refs),
// then run structural and type checks.
func validateProg(prog *lower.HCLProg, schema state.Schema, isTransition bool, ds *diag.Diagnostics) map[string]bindingInfo {
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
		scope[b.Name] = bindingInfo{
			fieldType: b.Type,
			isFunc:    b.Expr != nil,
			sigil:     b.Sigil,
		}
	}

	// Pass 2: structural + type checks.
	for _, b := range prog.Bindings {
		// ReservedName: user names may not start with __; auto-generated __if_X_cond is exempt.
		if strings.HasPrefix(b.Name, "__") {
			if !(strings.HasPrefix(b.Name, "__if_") && strings.HasSuffix(b.Name, "_cond")) {
				*ds = append(*ds, diag.Errorf(diag.CodeReservedName,
					"binding %q: names starting with __ are reserved", b.Name))
			}
		}

		// TransitionOutputSigil: <~ and <~> are forbidden inside transition progs.
		if isTransition && (b.Sigil == ast.SigilEgress || b.Sigil == ast.SigilBiDir) {
			*ds = append(*ds, diag.Errorf(diag.CodeTransitionOutputSigil,
				"binding %q: output sigil %s is not allowed in transition progs", b.Name, b.Sigil))
		}

		if b.Value != nil {
			if !literalMatchesFieldType(b.Value, b.Type) {
				*ds = append(*ds, diag.Errorf(diag.CodeTypeMismatch,
					"binding %q: literal value does not match declared type %s", b.Name, b.Type))
			}
			if b.Type.IsArray() {
				validateArrayLiteral(b.Value, b.Type, b.Name, ds)
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

// validateArrayLiteral checks HeterogeneousArray and NestedArrayNotAllowed.
func validateArrayLiteral(lit ast.Literal, ft ast.FieldType, bindingName string, ds *diag.Diagnostics) {
	arr, ok := lit.(*ast.ArrayLiteral)
	if !ok {
		return
	}
	elemFT := ft.ElemType()
	for _, elem := range arr.Elements {
		if _, isArr := elem.(*ast.ArrayLiteral); isArr {
			*ds = append(*ds, diag.Errorf(diag.CodeNestedArrayNotAllowed,
				"binding %q: nested arrays are not allowed in value bindings", bindingName))
			continue
		}
		if !literalMatchesFieldType(elem, elemFT) {
			*ds = append(*ds, diag.Errorf(diag.CodeHeterogeneousArray,
				"binding %q: array element does not match declared element type %s", bindingName, elemFT))
		}
	}
}

// validateCombine validates a combine expression.
func validateCombine(b *lower.HCLBinding, c *lower.HCLCombine, scope map[string]bindingInfo, ds *diag.Diagnostics) {
	spec, ok := builtinFns[c.Fn]
	if !ok {
		*ds = append(*ds, diag.Errorf(diag.CodeUnknownFnAlias,
			"binding %q: unknown function alias %q", b.Name, c.Fn))
		return
	}

	// Identity combine detection → SingleRefTypeMismatch.
	// Shape: fn ∈ identity set, args[0].Ref != "", args[1].Lit == identity element.
	if isIdentityCombine(c) {
		refName := c.Args[0].Ref
		refInfo, exists := scope[refName]
		if !exists {
			*ds = append(*ds, diag.Errorf(diag.CodeUndefinedRef,
				"binding %q: reference %q is not defined", b.Name, refName))
			return
		}
		if refInfo.fieldType != b.Type {
			*ds = append(*ds, diag.Errorf(diag.CodeSingleRefTypeMismatch,
				"binding %q: single-reference %q has type %s but binding declares type %s",
				b.Name, refName, refInfo.fieldType, b.Type))
		}
		return // identity combines are structurally correct by construction
	}

	// Validate all args: UndefinedRef / UndefinedFuncRef.
	for _, arg := range c.Args {
		validateArgRefs(b.Name, arg, scope, ds)
	}

	// ReturnTypeMismatch.
	if retType, known := resolveExpectedReturn(spec, c.Args, scope, nil); known {
		if retType != b.Type {
			*ds = append(*ds, diag.Errorf(diag.CodeReturnTypeMismatch,
				"binding %q: function %q returns %s but binding declares type %s",
				b.Name, c.Fn, retType, b.Type))
		}
	}

	// ArgTypeMismatch.
	validateCombineArgTypes(b.Name, c, spec, scope, ds)
}

// validatePipe validates a pipe expression.
func validatePipe(b *lower.HCLBinding, p *lower.HCLPipe, scope map[string]bindingInfo, ds *diag.Diagnostics) {
	// Build pipe scope: prog scope + pipe params.
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

	// Validate steps; accumulate step return types for step_ref checks.
	stepTypes := make([]ast.FieldType, 0, len(p.Steps))

	for i, step := range p.Steps {
		spec, ok := builtinFns[step.Fn]
		if !ok {
			*ds = append(*ds, diag.Errorf(diag.CodeUnknownFnAlias,
				"binding %q pipe step %d: unknown function alias %q", b.Name, i, step.Fn))
			stepTypes = append(stepTypes, 0)
			continue
		}

		for _, arg := range step.Args {
			if arg.IsStepRef {
				if arg.StepRef >= i {
					*ds = append(*ds, diag.Errorf(diag.CodeStepRefOutOfBounds,
						"binding %q pipe step %d: step_ref = %d is out of bounds (must be < %d)",
						b.Name, i, arg.StepRef, i))
				}
			} else {
				validateArgRefs(b.Name, arg, pipeScope, ds)
			}
		}

		retType, _ := resolveExpectedReturn(spec, step.Args, pipeScope, stepTypes)
		stepTypes = append(stepTypes, retType)
	}

	// ReturnTypeMismatch: last step return type must match binding type.
	if n := len(p.Steps); n > 0 {
		lastRet := stepTypes[n-1]
		if lastRet != 0 && lastRet != b.Type {
			*ds = append(*ds, diag.Errorf(diag.CodeReturnTypeMismatch,
				"binding %q: pipe last step returns %s but binding declares type %s",
				b.Name, lastRet, b.Type))
		}
	}
}

// validateCond validates a cond expression.
func validateCond(b *lower.HCLBinding, cond *lower.HCLCond, scope map[string]bindingInfo, ds *diag.Diagnostics) {
	// Condition must resolve to bool.
	if cond.Condition != nil && cond.Condition.Ref != "" {
		condRef := cond.Condition.Ref
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

	if cond.Then != nil && cond.Then.FuncRef != "" {
		ref := cond.Then.FuncRef
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

	if cond.Else != nil && cond.Else.FuncRef != "" {
		ref := cond.Else.FuncRef
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

	if hasThen && thenType != b.Type {
		*ds = append(*ds, diag.Errorf(diag.CodeReturnTypeMismatch,
			"binding %q cond: branch return type %s does not match declared type %s",
			b.Name, thenType, b.Type))
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Group C — Effect DSL / sigil validation
// ─────────────────────────────────────────────────────────────────────────────

func validateActionEffects(a *lower.HCLAction, scope map[string]bindingInfo, schema state.Schema, ds *diag.Diagnostics) {
	preparedNames := map[string]bool{}
	mergedNames := map[string]bool{}

	// Prepare entries.
	if a.Prepare != nil {
		seen := map[string]bool{}
		for _, e := range a.Prepare.Entries {
			if seen[e.BindingName] {
				*ds = append(*ds, diag.Errorf(diag.CodeDuplicatePrepareEntry,
					"action %q: duplicate prepare entry for binding %q", a.ID, e.BindingName))
				continue
			}
			seen[e.BindingName] = true
			preparedNames[e.BindingName] = true

			if _, ok := scope[e.BindingName]; !ok {
				*ds = append(*ds, diag.Errorf(diag.CodeUnresolvedPrepareBinding,
					"action %q: prepare binding %q not found in prog", a.ID, e.BindingName))
			}

			if e.FromState != "" {
				validateStatePath(e.FromState, schema, ds)
			}
		}
	}

	// Merge entries.
	if a.Merge != nil {
		seen := map[string]bool{}
		for _, e := range a.Merge.Entries {
			if seen[e.BindingName] {
				*ds = append(*ds, diag.Errorf(diag.CodeDuplicateMergeEntry,
					"action %q: duplicate merge entry for binding %q", a.ID, e.BindingName))
				continue
			}
			seen[e.BindingName] = true
			mergedNames[e.BindingName] = true

			srcInfo, inScope := scope[e.BindingName]
			if !inScope {
				*ds = append(*ds, diag.Errorf(diag.CodeUnresolvedMergeBinding,
					"action %q: merge binding %q not found in prog", a.ID, e.BindingName))
			}

			if e.ToState != "" {
				if !isValidStatePath(e.ToState) {
					*ds = append(*ds, diag.Errorf(diag.CodeInvalidStatePath,
						"action %q: to_state %q is not a valid dotted path", a.ID, e.ToState))
				} else if meta, ok := schema[e.ToState]; !ok {
					*ds = append(*ds, diag.Errorf(diag.CodeUnresolvedStatePath,
						"action %q: to_state %q is not declared in the state schema", a.ID, e.ToState))
				} else if inScope && srcInfo.fieldType != meta.Type {
					*ds = append(*ds, diag.Errorf(diag.CodeStateTypeMismatch,
						"action %q: merge binding %q has type %s but STATE field %q has type %s",
						a.ID, e.BindingName, srcInfo.fieldType, e.ToState, meta.Type))
				}
			}
		}
	}

	// Sigil-based requirement checks — iterate scope bindings.
	for name, info := range scope {
		switch info.sigil {
		case ast.SigilIngress:
			if !preparedNames[name] {
				*ds = append(*ds, diag.Errorf(diag.CodeMissingPrepareEntry,
					"action %q: binding %q has ~> sigil but no prepare entry", a.ID, name))
			}
		case ast.SigilEgress:
			if !mergedNames[name] {
				*ds = append(*ds, diag.Errorf(diag.CodeMissingMergeEntry,
					"action %q: binding %q has <~ sigil but no merge entry", a.ID, name))
			}
		case ast.SigilBiDir:
			inPrepare := preparedNames[name]
			inMerge := mergedNames[name]
			if !inPrepare && !inMerge {
				*ds = append(*ds, diag.Errorf(diag.CodeMissingPrepareEntry,
					"action %q: binding %q has <~> sigil but no prepare entry", a.ID, name))
				*ds = append(*ds, diag.Errorf(diag.CodeMissingMergeEntry,
					"action %q: binding %q has <~> sigil but no merge entry", a.ID, name))
			} else if inPrepare && !inMerge {
				*ds = append(*ds, diag.Errorf(diag.CodeBidirMissingMergeEntry,
					"action %q: binding %q has <~> sigil: appears in prepare but not in merge", a.ID, name))
			} else if !inPrepare && inMerge {
				*ds = append(*ds, diag.Errorf(diag.CodeBidirMissingPrepareEntry,
					"action %q: binding %q has <~> sigil: appears in merge but not in prepare", a.ID, name))
			}
		}
	}

	// Spurious entry checks.
	for name := range preparedNames {
		info, ok := scope[name]
		if !ok {
			continue // UnresolvedPrepareBinding already emitted
		}
		if info.sigil != ast.SigilIngress && info.sigil != ast.SigilBiDir {
			*ds = append(*ds, diag.Errorf(diag.CodeSpuriousPrepareEntry,
				"action %q: prepare entry for %q has no corresponding ~> or <~> sigil in prog", a.ID, name))
		}
	}
	for name := range mergedNames {
		info, ok := scope[name]
		if !ok {
			continue // UnresolvedMergeBinding already emitted
		}
		if info.sigil != ast.SigilEgress && info.sigil != ast.SigilBiDir {
			*ds = append(*ds, diag.Errorf(diag.CodeSpuriousMergeEntry,
				"action %q: merge entry for %q has no corresponding <~ or <~> sigil in prog", a.ID, name))
		}
	}
}

// validateNextRule validates a next/transition rule.
func validateNextRule(nr *lower.HCLNextRule, schema state.Schema, ds *diag.Diagnostics) {
	// InvalidTransitionIngress: each prepare entry must have exactly one source.
	if nr.Prepare != nil {
		for _, e := range nr.Prepare.Entries {
			count := 0
			if e.FromAction != "" {
				count++
			}
			if e.FromState != "" {
				count++
			}
			if e.FromLiteral != nil {
				count++
			}
			if count != 1 {
				*ds = append(*ds, diag.Errorf(diag.CodeInvalidTransitionIngress,
					"transition prepare entry for %q must have exactly one of from_action, from_state, from_literal; got %d",
					e.BindingName, count))
			}
			if e.FromState != "" {
				validateStatePath(e.FromState, schema, ds)
			}
		}
	}

	if nr.Compute == nil {
		return
	}

	// Validate transition prog (isTransition=true enforces TransitionOutputSigil etc.).
	nextScope := validateProg(nr.Compute.Prog, schema, true, ds)

	// Condition must resolve to bool.
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

// validateStatePath checks InvalidStatePath then UnresolvedStatePath.
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

// isValidStatePath reports whether path is a valid dotted STATE path (IDENT.IDENT+).
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

// validateArgRefs emits UndefinedRef or UndefinedFuncRef for a single arg.
func validateArgRefs(bindingName string, arg *lower.HCLArg, scope map[string]bindingInfo, ds *diag.Diagnostics) {
	if arg.Ref != "" {
		if _, ok := scope[arg.Ref]; !ok {
			*ds = append(*ds, diag.Errorf(diag.CodeUndefinedRef,
				"binding %q: reference %q is not defined", bindingName, arg.Ref))
		}
	}
	if arg.FuncRef != "" {
		info, ok := scope[arg.FuncRef]
		if !ok {
			*ds = append(*ds, diag.Errorf(diag.CodeUndefinedFuncRef,
				"binding %q: func_ref %q is not defined", bindingName, arg.FuncRef))
		} else if !info.isFunc {
			*ds = append(*ds, diag.Errorf(diag.CodeUndefinedFuncRef,
				"binding %q: func_ref %q references a value binding; a function binding is required",
				bindingName, arg.FuncRef))
		}
	}
}

// resolveExpectedReturn returns the expected return type of spec given the actual args.
// stepTypes is non-nil only inside pipe step validation, where stepTypes[i] is step i's return.
// Returns (type, true) when determinable, (0, false) otherwise.
func resolveExpectedReturn(spec fnSpec, args []*lower.HCLArg, scope map[string]bindingInfo, stepTypes []ast.FieldType) (ast.FieldType, bool) {
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

// resolveArgType infers the FieldType of an arg from scope / literal / stepTypes.
// Returns (type, true) when determinable.
func resolveArgType(arg *lower.HCLArg, scope map[string]bindingInfo, stepTypes []ast.FieldType) (ast.FieldType, bool) {
	if arg.Ref != "" {
		if info, ok := scope[arg.Ref]; ok {
			return info.fieldType, true
		}
		return 0, false
	}
	if arg.Lit != nil {
		return literalFieldType(arg.Lit)
	}
	if arg.FuncRef != "" {
		if info, ok := scope[arg.FuncRef]; ok {
			return info.fieldType, true
		}
		return 0, false
	}
	if arg.IsStepRef && stepTypes != nil && arg.StepRef >= 0 && arg.StepRef < len(stepTypes) && stepTypes[arg.StepRef] != 0 {
		return stepTypes[arg.StepRef], true
	}
	return 0, false
}

// validateCombineArgTypes emits ArgTypeMismatch for mismatched argument types.
func validateCombineArgTypes(bindingName string, c *lower.HCLCombine, spec fnSpec, scope map[string]bindingInfo, ds *diag.Diagnostics) {
	if len(c.Args) < 2 {
		return // binary shape validated upstream
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

// isIdentityCombine reports whether c is the canonical identity combine emitted by the lowerer
// for the single-reference form (name:type = identifier).
// Shape: fn ∈ {bool_and, add, str_concat, arr_concat}, args[0].Ref != "", args[1].Lit = identity element.
func isIdentityCombine(c *lower.HCLCombine) bool {
	identityFns := map[string]bool{"bool_and": true, "add": true, "str_concat": true, "arr_concat": true}
	if !identityFns[c.Fn] || len(c.Args) != 2 || c.Args[0].Ref == "" || c.Args[1].Lit == nil {
		return false
	}
	switch c.Fn {
	case "bool_and":
		b, ok := c.Args[1].Lit.(*ast.BoolLiteral)
		return ok && b.Value
	case "add":
		n, ok := c.Args[1].Lit.(*ast.NumberLiteral)
		return ok && n.Value == 0
	case "str_concat":
		s, ok := c.Args[1].Lit.(*ast.StringLiteral)
		return ok && s.Value == ""
	case "arr_concat":
		arr, ok := c.Args[1].Lit.(*ast.ArrayLiteral)
		return ok && len(arr.Elements) == 0
	}
	return false
}

// literalMatchesFieldType reports whether lit is compatible with ft.
func literalMatchesFieldType(lit ast.Literal, ft ast.FieldType) bool {
	switch ft {
	case ast.FieldTypeNumber:
		_, ok := lit.(*ast.NumberLiteral)
		return ok
	case ast.FieldTypeStr:
		_, ok := lit.(*ast.StringLiteral)
		return ok
	case ast.FieldTypeBool:
		_, ok := lit.(*ast.BoolLiteral)
		return ok
	case ast.FieldTypeArrNumber, ast.FieldTypeArrStr, ast.FieldTypeArrBool:
		arr, ok := lit.(*ast.ArrayLiteral)
		if !ok {
			return false
		}
		elemFT := ft.ElemType()
		for _, e := range arr.Elements {
			if !literalMatchesFieldType(e, elemFT) {
				return false
			}
		}
		return true
	}
	return false
}

// literalFieldType infers the FieldType from a concrete Literal.
// Returns (0, false) for empty arrays (element type indeterminate).
func literalFieldType(lit ast.Literal) (ast.FieldType, bool) {
	switch lit.(type) {
	case *ast.NumberLiteral:
		return ast.FieldTypeNumber, true
	case *ast.StringLiteral:
		return ast.FieldTypeStr, true
	case *ast.BoolLiteral:
		return ast.FieldTypeBool, true
	case *ast.ArrayLiteral:
		arr := lit.(*ast.ArrayLiteral)
		if len(arr.Elements) == 0 {
			return 0, false
		}
		elemFT, ok := literalFieldType(arr.Elements[0])
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

// isIdent reports whether s is a valid DSL identifier ([A-Za-z_][A-Za-z0-9_]*).
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

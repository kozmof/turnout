// Package validate runs all structural and type-checking rules against the
// lowered proto model. All diagnostics are collected before returning so
// callers see every error in one pass. Validation failures leave the model
// unmodified; no partial output is produced.
package validate

import (
	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/localexpr"
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

// fnKind classifies the special dispatch behaviour of a built-in function.
// The four array/generic variants are mutually exclusive.
type fnKind int

const (
	fnKindStandard  fnKind = iota // regular typed binary function
	fnKindGeneric                 // eq/neq: both operands must share the same type
	fnKindArrGet                  // arr_get: returns element type of arg1
	fnKindArrInc                  // arr_includes: returns bool
	fnKindArrConcat               // arr_concat: returns same array type as arg1
)

type fnSpec struct {
	arg1Type   ast.FieldType
	arg2Type   ast.FieldType
	returnType ast.FieldType
	kind       fnKind
}

// ─────────────────────────────────────────────────────────────────────────────
// Built-in function alias table (hcl-context-spec.md §3.1)
// ─────────────────────────────────────────────────────────────────────────────

var builtinFns = map[string]fnSpec{
	"add":          {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeNumber},
	"sub":          {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeNumber},
	"mul":          {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeNumber},
	"div":          {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeNumber},
	"mod":          {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeNumber},
	"max":          {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeNumber},
	"min":          {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeNumber},
	"gt":           {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeBool},
	"gte":          {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeBool},
	"lt":           {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeBool},
	"lte":          {arg1Type: ast.FieldTypeNumber, arg2Type: ast.FieldTypeNumber, returnType: ast.FieldTypeBool},
	"str_concat":   {arg1Type: ast.FieldTypeStr, arg2Type: ast.FieldTypeStr, returnType: ast.FieldTypeStr},
	"str_includes": {arg1Type: ast.FieldTypeStr, arg2Type: ast.FieldTypeStr, returnType: ast.FieldTypeBool},
	"str_starts":   {arg1Type: ast.FieldTypeStr, arg2Type: ast.FieldTypeStr, returnType: ast.FieldTypeBool},
	"str_ends":     {arg1Type: ast.FieldTypeStr, arg2Type: ast.FieldTypeStr, returnType: ast.FieldTypeBool},
	"bool_and":     {arg1Type: ast.FieldTypeBool, arg2Type: ast.FieldTypeBool, returnType: ast.FieldTypeBool},
	"bool_or":      {arg1Type: ast.FieldTypeBool, arg2Type: ast.FieldTypeBool, returnType: ast.FieldTypeBool},
	"bool_xor":     {arg1Type: ast.FieldTypeBool, arg2Type: ast.FieldTypeBool, returnType: ast.FieldTypeBool},
	"eq":           {returnType: ast.FieldTypeBool, kind: fnKindGeneric},
	"neq":          {returnType: ast.FieldTypeBool, kind: fnKindGeneric},
	"arr_includes": {kind: fnKindArrInc},
	"arr_get":      {kind: fnKindArrGet},
	"arr_concat":   {kind: fnKindArrConcat},
}

// ─────────────────────────────────────────────────────────────────────────────
// Position index — O(1) lookup of binding source positions
// ─────────────────────────────────────────────────────────────────────────────

func buildPosIndexFromSidecar(sc *lower.Sidecar) lower.PositionIndex {
	if sc == nil {
		return lower.EmptyPositionIndex()
	}
	return sc.ToPositionIndex()
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

// modelHasSigilBindings reports whether any prog in the model declares at least
// one binding with a non-zero sigil. Used to decide whether a nil-sidecar warning
// is warranted in Validate.
func modelHasSigilBindings(tm *turnoutpb.TurnModel) bool {
	for _, s := range tm.Scenes {
		for _, a := range s.Actions {
			if a.Compute != nil && a.Compute.Prog != nil && len(a.Compute.Prog.Sigils) > 0 {
				return true
			}
			for _, nr := range a.Next {
				if nr.Compute != nil && nr.Compute.Prog != nil && len(nr.Compute.Prog.Sigils) > 0 {
					return true
				}
			}
		}
	}
	return false
}

// Validate runs all structural and type validation rules against the proto model.
// sc carries per-binding source positions from the lowerer for positioned diagnostics;
// pass nil when validating a model loaded from disk (sigil checks still run via
// ProgModel.Sigils in the proto, but without file/line/col positions). When sc is nil
// and the model contains sigil bindings, a CodeSigilPositionLoss warning is emitted
// so callers are aware that diagnostics for those bindings will lack source positions.
// schema may be nil. Returns diagnostics; callers must check HasErrors() before
// proceeding to emission.
func Validate(tm *turnoutpb.TurnModel, schema state.Schema, sc *lower.Sidecar) diag.Diagnostics {
	var ds diag.Diagnostics
	if tm == nil {
		return ds
	}
	idx := buildPosIndexFromSidecar(sc)
	if sc == nil && modelHasSigilBindings(tm) {
		ds = append(ds, diag.Warnf(diag.CodeSigilPositionLoss,
			"validating without a sidecar: sigil diagnostics will lack source positions"))
	}
	seenSceneIDs := make(map[string]bool)
	for _, s := range tm.Scenes {
		if seenSceneIDs[s.Id] {
			ds = append(ds, diag.Errorf(diag.CodeDuplicateSceneID,
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
	switch v.Kind.(type) {
	case *structpb.Value_NumberValue:
		return ast.FieldTypeNumber, true
	case *structpb.Value_StringValue:
		return ast.FieldTypeStr, true
	case *structpb.Value_BoolValue:
		return ast.FieldTypeBool, true
	case *structpb.Value_ListValue:
		k := v.Kind.(*structpb.Value_ListValue)
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
		bFt := ast.MustFieldTypeFromString(b.Type)
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
		bFt := ast.MustFieldTypeFromString(b.Type)
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
			bFt := ast.MustFieldTypeFromString(b.Type)
			if stepTypes[n-1] != bFt {
				*ds = append(*ds, diag.Errorf(diag.CodeReturnTypeMismatch,
					"binding %q: pipe last step returns %s but binding declares type %s",
					b.Name, stepTypes[n-1], b.Type))
			}
		}
	}
}

// resolveCondBranch resolves the type of a cond then/else ArgModel branch.
// It handles all three relevant ArgModel variants: FuncRef (function binding
// reference), Ref (value binding reference), and Lit (inline literal).
// Returns (fieldType, true) when the type is known, (Invalid, false) otherwise.
func resolveCondBranch(bindingName, branchName string, arg *turnoutpb.ArgModel, scope map[string]bindingInfo, ds *diag.Diagnostics) (ast.FieldType, bool) {
	if arg == nil {
		return ast.FieldTypeInvalid, false
	}
	if arg.FuncRef != nil && *arg.FuncRef != "" {
		ref := *arg.FuncRef
		info, ok := scope[ref]
		if !ok {
			*ds = append(*ds, diag.Errorf(diag.CodeUndefinedFuncRef,
				"binding %q cond %s: %q is not defined", bindingName, branchName, ref))
			return ast.FieldTypeInvalid, false
		}
		if !info.isFunc {
			*ds = append(*ds, diag.Errorf(diag.CodeUndefinedFuncRef,
				"binding %q cond %s: %q is a value binding; a function binding is required", bindingName, branchName, ref))
			return ast.FieldTypeInvalid, false
		}
		return info.fieldType, true
	}
	if arg.Ref != nil && *arg.Ref != "" {
		ref := *arg.Ref
		info, ok := scope[ref]
		if !ok {
			*ds = append(*ds, diag.Errorf(diag.CodeUndefinedRef,
				"binding %q cond %s: %q is not defined", bindingName, branchName, ref))
			return ast.FieldTypeInvalid, false
		}
		return info.fieldType, true
	}
	if arg.Lit != nil {
		ft, ok := structpbFieldType(arg.Lit)
		return ft, ok
	}
	return ast.FieldTypeInvalid, false
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

	thenType, hasThen := resolveCondBranch(b.Name, "then", cond.Then, scope, ds)
	elseType, hasElse := resolveCondBranch(b.Name, "else", cond.ElseBranch, scope, ds)

	if hasThen && hasElse && thenType != elseType {
		*ds = append(*ds, diag.Errorf(diag.CodeBranchTypeMismatch,
			"binding %q cond: then branch type %s and else branch type %s do not match",
			b.Name, thenType, elseType))
	}

	if hasThen {
		bFt := ast.MustFieldTypeFromString(b.Type)
		if thenType != bFt {
			*ds = append(*ds, diag.Errorf(diag.CodeReturnTypeMismatch,
				"binding %q cond: branch return type %s does not match declared type %s",
				b.Name, thenType, b.Type))
		}
	}
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
	if arg.Transform != nil {
		if info, ok := scope[arg.Transform.Ref]; ok {
			return lower.TransformChainOutputType(info.fieldType, arg.Transform.Fn)
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
// by lowerSingleRefRHS for a single-reference binding (f(x, identity) ≡ x).
// Such combines are exempt from operatorOnly enforcement (validateCombine) and
// the empty-array-arg check (validateNoEmptyArrayLitArgs).
func isIdentityCombine(c *turnoutpb.CombineExpr) bool {
	isIdentity, ok := identityElement[c.Fn]
	if !ok || len(c.Args) != 2 || c.Args[0].Ref == nil || c.Args[1].Lit == nil {
		return false
	}
	return isIdentity(c.Args[1].Lit)
}

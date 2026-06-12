// Package validate runs all structural and type-checking rules against the
// lowered proto model. All diagnostics are collected before returning so
// callers see every error in one pass. Validation failures leave the model
// unmodified; no partial output is produced.
package validate

import (
	"fmt"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/fnmeta"
	"github.com/kozmof/turnout/packages/go/converter/internal/localexpr"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
	"google.golang.org/protobuf/types/known/structpb"
)

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper types
// ─────────────────────────────────────────────────────────────────────────────

// BindingKind classifies a binding as a value binding or a function binding.
// Function bindings have an Expr or ExtExpr; value bindings have a Value.
type BindingKind int

const (
	BindingKindValue BindingKind = iota // binding holds a plain value (b.Value != nil)
	BindingKindFunc                     // binding holds an expression (b.Expr or b.ExtExpr != nil)
)

type bindingInfo struct {
	fieldType ast.FieldType
	kind      BindingKind
	sigil     ast.Sigil
}

// bindingKindFor returns the BindingKind for a BindingModel.
func bindingKindFor(b *turnoutpb.BindingModel) BindingKind {
	if b.Expr != nil || b.ExtExpr != nil {
		return BindingKindFunc
	}
	return BindingKindValue
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

// ValidateInput bundles the inputs to Validate. Schema may be the zero value
// when no state schema is available.
type ValidateInput struct {
	Model  *turnoutpb.TurnModel
	Schema state.Schema
}

// Validate runs all structural and type validation rules against the proto model.
// Returns diagnostics; callers must check HasErrors() before proceeding to emission.
func Validate(in ValidateInput) diag.Diagnostics {
	tm, schema := in.Model, in.Schema
	var ds diag.DiagSink
	if tm == nil {
		return nil
	}
	seenSceneIDs := make(map[string]bool)
	for _, s := range tm.Scenes {
		if seenSceneIDs[s.Id] {
			ds.Append(diag.Errorf(diag.CodeDuplicateSceneID,
				"duplicate scene ID %q", s.Id))
		}
		seenSceneIDs[s.Id] = true
		validateScene(s, schema, &ds)
	}
	if len(tm.Routes) > 0 {
		knownScenes, knownActions := buildKnownScenesAndActions(tm)
		validateRoutes(tm.Routes, knownScenes, knownActions, &ds)
	}
	return ds.Flush()
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

func validateArrayLiteral(v *structpb.Value, ft ast.FieldType, bindingName string, ds *diag.DiagSink) {
	lv, ok := v.Kind.(*structpb.Value_ListValue)
	if !ok {
		return
	}
	elemFT, ok := ft.TryElemType()
	if !ok {
		return
	}
	for _, elem := range lv.ListValue.GetValues() {
		if _, isArr := elem.Kind.(*structpb.Value_ListValue); isArr {
			ds.Append(diag.Errorf(diag.CodeNestedArrayNotAllowed,
				"binding %q: nested arrays are not allowed in value bindings", bindingName))
			continue
		}
		if !structpbMatchesFieldType(elem, elemFT) {
			ds.Append(diag.Errorf(diag.CodeHeterogeneousArray,
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

// structpbFieldType is a package-local alias for state.StructpbFieldType.
// All callers in this package use this alias so the implementation lives
// in one place (state package) rather than being duplicated here.
func structpbFieldType(v *structpb.Value) (ast.FieldType, bool) {
	return state.StructpbFieldType(v)
}

// ─────────────────────────────────────────────────────────────────────────────
// Combine / Pipe / Cond validation
// ─────────────────────────────────────────────────────────────────────────────

func validateCombine(b *turnoutpb.BindingModel, c *turnoutpb.CombineExpr, scope map[string]bindingInfo, ds *diag.DiagSink) {
	spec, ok := fnmeta.BuiltinFn(c.Fn)
	if !ok {
		ds.Append(diag.Errorf(diag.CodeUnknownFnAlias,
			"binding %q: unknown function alias %q", b.Name, c.Fn))
		return
	}

	if isIdentityCombine(c) {
		refName := *c.Args[0].Ref
		refInfo, exists := scope[refName]
		if !exists {
			ds.Append(diag.Errorf(diag.CodeUndefinedRef,
				"binding %q: reference %q is not defined", b.Name, refName))
			return
		}
		bFt, ftOK := ast.FieldTypeFromString(b.Type)
		if !ftOK {
			ds.Append(diag.Errorf(diag.CodeTypeMismatch,
				"binding %q: unknown type string %q", b.Name, b.Type))
			return
		}
		if refInfo.fieldType != bFt {
			ds.Append(diag.Errorf(diag.CodeSingleRefTypeMismatch,
				"binding %q: single-reference %q has type %s but binding declares type %s",
				b.Name, refName, refInfo.fieldType, b.Type))
		}
		return
	}

	for _, arg := range c.Args {
		validateArgRefs(b.Name, arg, scope, ds)
	}

	if retType, known := resolveExpectedReturn(spec, c.Args, scope, nil); known {
		bFt, ftOK := ast.FieldTypeFromString(b.Type)
		if !ftOK {
			ds.Append(diag.Errorf(diag.CodeTypeMismatch,
				"binding %q: unknown type string %q", b.Name, b.Type))
			return
		}
		if retType != bFt {
			ds.Append(diag.Errorf(diag.CodeReturnTypeMismatch,
				"binding %q: function %q returns %s but binding declares type %s",
				b.Name, c.Fn, retType, b.Type))
		}
	}

	validateBinaryFnArgs(b.Name, fmt.Sprintf("binding %q", b.Name), c.Fn, spec, c.Args, scope, nil, ds)
}

func validatePipe(b *turnoutpb.BindingModel, p *turnoutpb.PipeExpr, scope map[string]bindingInfo, ds *diag.DiagSink) {
	var pipeScope map[string]bindingInfo
	if len(p.Params) == 0 {
		pipeScope = scope
	} else {
		pipeScope = make(map[string]bindingInfo, len(scope)+len(p.Params))
		for k, v := range scope {
			pipeScope[k] = v
		}
	}
	for _, param := range p.Params {
		srcInfo, ok := scope[param.SourceIdent]
		if !ok {
			ds.Append(diag.Errorf(diag.CodeUndefinedRef,
				"binding %q pipe param %q: source %q is not defined", b.Name, param.ParamName, param.SourceIdent))
			continue
		}
		if srcInfo.kind == BindingKindFunc {
			ds.Append(diag.Errorf(diag.CodePipeArgNotValue,
				"binding %q pipe param %q: source %q is a function binding; pipe params must reference value bindings",
				b.Name, param.ParamName, param.SourceIdent))
			continue
		}
		pipeScope[param.ParamName] = bindingInfo{fieldType: srcInfo.fieldType, kind: BindingKindValue}
	}

	stepTypes := make([]ast.FieldType, 0, len(p.Steps))
	stepKnown := make([]bool, 0, len(p.Steps))

	for i, step := range p.Steps {
		spec, ok := fnmeta.BuiltinFn(step.Fn)
		if !ok {
			ds.Append(diag.Errorf(diag.CodeUnknownFnAlias,
				"binding %q pipe step %d: unknown function alias %q", b.Name, i, step.Fn))
			stepTypes = append(stepTypes, 0)
			stepKnown = append(stepKnown, false)
			continue
		}

		for _, arg := range step.Args {
			if arg.StepRef != nil {
				if int(*arg.StepRef) >= i {
					ds.Append(diag.Errorf(diag.CodeStepRefOutOfBounds,
						"binding %q pipe step %d: step_ref = %d is out of bounds (must be < %d)",
						b.Name, i, *arg.StepRef, i))
				}
			} else {
				validateArgRefs(b.Name, arg, pipeScope, ds)
			}
		}

		validateBinaryFnArgs(b.Name, fmt.Sprintf("binding %q pipe step %d", b.Name, i), step.Fn, spec, step.Args, pipeScope, stepTypes, ds)
		retType, known := resolveExpectedReturn(spec, step.Args, pipeScope, stepTypes)
		stepTypes = append(stepTypes, retType)
		stepKnown = append(stepKnown, known)
	}

	if n := len(p.Steps); n > 0 {
		if stepKnown[n-1] {
			bFt, ftOK := ast.FieldTypeFromString(b.Type)
			if !ftOK {
				ds.Append(diag.Errorf(diag.CodeTypeMismatch,
					"binding %q: unknown type string %q", b.Name, b.Type))
				return
			}
			if stepTypes[n-1] != bFt {
				ds.Append(diag.Errorf(diag.CodeReturnTypeMismatch,
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
func resolveCondBranch(bindingName, branchName string, arg *turnoutpb.ArgModel, scope map[string]bindingInfo, ds *diag.DiagSink) (ast.FieldType, bool) {
	if arg == nil {
		return ast.FieldTypeInvalid, false
	}
	if arg.Ref != nil && *arg.Ref != "" {
		ref := *arg.Ref
		info, ok := scope[ref]
		if !ok {
			ds.Append(diag.Errorf(diag.CodeUndefinedRef,
				"binding %q cond %s: %q is not defined", bindingName, branchName, ref))
			return ast.FieldTypeInvalid, false
		}
		return info.fieldType, true
	}
	if arg.FuncRef != nil && *arg.FuncRef != "" {
		ref := *arg.FuncRef
		info, ok := scope[ref]
		if !ok {
			ds.Append(diag.Errorf(diag.CodeUndefinedFuncRef,
				"binding %q cond %s: %q is not defined", bindingName, branchName, ref))
			return ast.FieldTypeInvalid, false
		}
		if info.kind != BindingKindFunc {
			ds.Append(diag.Errorf(diag.CodeUndefinedFuncRef,
				"binding %q cond %s: %q is a value binding; a function binding is required", bindingName, branchName, ref))
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

func validateCond(b *turnoutpb.BindingModel, cond *turnoutpb.CondExpr, scope map[string]bindingInfo, ds *diag.DiagSink) {
	if cond.Condition != nil && cond.Condition.Ref != nil && *cond.Condition.Ref != "" {
		condRef := *cond.Condition.Ref
		info, ok := scope[condRef]
		if !ok {
			ds.Append(diag.Errorf(diag.CodeUndefinedRef,
				"binding %q cond condition: %q is not defined", b.Name, condRef))
		} else if info.fieldType != ast.FieldTypeBool {
			ds.Append(diag.Errorf(diag.CodeCondNotBool,
				"binding %q cond condition %q has type %s; bool required",
				b.Name, condRef, info.fieldType))
		}
	} else if cond.Condition != nil && cond.Condition.Lit != nil {
		if ft, ok := structpbFieldType(cond.Condition.Lit); ok && ft != ast.FieldTypeBool {
			ds.Append(diag.Errorf(diag.CodeCondNotBool,
				"binding %q cond condition literal has type %s; bool required",
				b.Name, ft))
		}
	}

	thenType, hasThen := resolveCondBranch(b.Name, "then", cond.Then, scope, ds)
	elseType, hasElse := resolveCondBranch(b.Name, "else", cond.ElseBranch, scope, ds)

	if hasThen && hasElse && thenType != elseType {
		ds.Append(diag.Errorf(diag.CodeBranchTypeMismatch,
			"binding %q cond: then branch type %s and else branch type %s do not match",
			b.Name, thenType, elseType))
	}

	if hasThen {
		bFt, ftOK := ast.FieldTypeFromString(b.Type)
		if !ftOK {
			ds.Append(diag.Errorf(diag.CodeTypeMismatch,
				"binding %q: unknown type string %q", b.Name, b.Type))
			return
		}
		if thenType != bFt {
			ds.Append(diag.Errorf(diag.CodeReturnTypeMismatch,
				"binding %q cond: branch return type %s does not match declared type %s",
				b.Name, thenType, b.Type))
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

func validateArgRefs(bindingName string, arg *turnoutpb.ArgModel, scope map[string]bindingInfo, ds *diag.DiagSink) {
	if arg.Ref != nil && *arg.Ref != "" {
		if _, ok := scope[*arg.Ref]; !ok {
			ds.Append(diag.Errorf(diag.CodeUndefinedRef,
				"binding %q: reference %q is not defined", bindingName, *arg.Ref))
		}
	}
	if arg.FuncRef != nil && *arg.FuncRef != "" {
		info, ok := scope[*arg.FuncRef]
		if !ok {
			ds.Append(diag.Errorf(diag.CodeUndefinedFuncRef,
				"binding %q: func_ref %q is not defined", bindingName, *arg.FuncRef))
		} else if info.kind != BindingKindFunc {
			ds.Append(diag.Errorf(diag.CodeUndefinedFuncRef,
				"binding %q: func_ref %q references a value binding; a function binding is required",
				bindingName, *arg.FuncRef))
		}
	}
}

func resolveExpectedReturn(spec fnmeta.FnSpec, args []*turnoutpb.ArgModel, scope map[string]bindingInfo, stepTypes []ast.FieldType) (ast.FieldType, bool) {
	switch spec.Kind {
	case fnmeta.FnKindGeneric, fnmeta.FnKindArrInc:
		return ast.FieldTypeBool, true
	case fnmeta.FnKindArrGet:
		if len(args) >= 1 {
			t, ok := resolveArgType(args[0], scope, stepTypes)
			if ok && t.IsArray() {
				return t.ElemType(), true
			}
		}
		return 0, false
	case fnmeta.FnKindArrConcat:
		if len(args) >= 1 {
			t, ok := resolveArgType(args[0], scope, stepTypes)
			if ok {
				return t, true
			}
		}
		return 0, false
	default:
		return spec.ReturnType, true
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
			return fnmeta.TransformChainOutputType(info.fieldType, arg.Transform.Fn)
		}
	}
	return 0, false
}

// validateBinaryFnArgs validates arity and operand types for a two-argument
// binary function call. contextLabel is a pre-formatted description of the call
// site included in diagnostics (e.g. `"binding \"x\""` or
// `"binding \"x\" pipe step 2"`). stepTypes is nil for combine calls.
func validateBinaryFnArgs(
	bindingName, contextLabel, fn string,
	spec fnmeta.FnSpec,
	args []*turnoutpb.ArgModel,
	scope map[string]bindingInfo,
	stepTypes []ast.FieldType,
	ds *diag.DiagSink,
) {
	maxArgs := spec.Arity()
	if len(args) > maxArgs {
		ds.Append(diag.Errorf(diag.CodeArgTypeMismatch,
			"%s: function %q accepts at most %d argument(s), got %d",
			contextLabel, fn, maxArgs, len(args)))
	}
	if len(args) < maxArgs {
		ds.Append(diag.Errorf(diag.CodeInvalidBinaryArgShape,
			"%s: function %q requires %d argument(s), got %d",
			contextLabel, fn, maxArgs, len(args)))
		return
	}
	if len(args) < 2 {
		return
	}
	t1, ok1 := resolveArgType(args[0], scope, stepTypes)
	t2, ok2 := resolveArgType(args[1], scope, stepTypes)
	validateBinaryArgTypePair(bindingName, fn, spec, t1, ok1, t2, ok2, ds)
}

// argHasEmptyArrayLit reports whether arg carries an empty array literal.
func argHasEmptyArrayLit(arg *turnoutpb.ArgModel) bool {
	if arg == nil || arg.Lit == nil {
		return false
	}
	lv, ok := arg.Lit.Kind.(*structpb.Value_ListValue)
	return ok && (lv.ListValue == nil || len(lv.ListValue.Values) == 0)
}

// walkExprArgs calls fn for every ArgModel leaf in expr, skipping identity
// combines so callers never need to add that carve-out themselves.
func walkExprArgs(expr *turnoutpb.ExprModel, fn func(*turnoutpb.ArgModel)) {
	if c := expr.Combine; c != nil && !isIdentityCombine(c) {
		for _, arg := range c.Args {
			fn(arg)
		}
	}
	if p := expr.Pipe; p != nil {
		for _, step := range p.Steps {
			for _, arg := range step.Args {
				fn(arg)
			}
		}
	}
	if cond := expr.Cond; cond != nil {
		fn(cond.Condition)
		fn(cond.Then)
		fn(cond.ElseBranch)
	}
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
func validateNoEmptyArrayLitArgs(b *turnoutpb.BindingModel, ds *diag.DiagSink) {
	if b.ExtExpr != nil {
		localexpr.WalkProto(b.ExtExpr, func(node *turnoutpb.LocalExprModel) {
			call, ok := node.Expr.(*turnoutpb.LocalExprModel_Call)
			if !ok {
				return
			}
			for _, arg := range call.Call.GetArgs() {
				if isEmptyArrayLocalLit(arg) {
					ds.Append(diag.Errorf(diag.CodeEmptyArrayLitArg,
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
	walkExprArgs(b.Expr, func(arg *turnoutpb.ArgModel) {
		if argHasEmptyArrayLit(arg) {
			ds.Append(diag.Errorf(diag.CodeEmptyArrayLitArg,
				"binding %q: empty array literal used as inline function argument is type-ambiguous; "+
					"use a named binding with a declared type instead (e.g. x: arr<number> = [])", b.Name))
		}
	})
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

// isIdentityCombine reports whether c is the canonical identity lowering emitted
// by lowerSingleRefRHS for a single-reference binding (f(x, identity) ≡ x).
// Such combines are exempt from operatorOnly enforcement (validateCombine) and
// the empty-array-arg check (validateNoEmptyArrayLitArgs).
func isIdentityCombine(c *turnoutpb.CombineExpr) bool {
	if len(c.Args) != 2 || c.Args[0].Ref == nil || *c.Args[0].Ref == "" || c.Args[1].Lit == nil {
		return false
	}
	return fnmeta.IsIdentityValue(c.Fn, c.Args[1].Lit)
}

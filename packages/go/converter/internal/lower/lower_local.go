package lower

import (
	"fmt"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"google.golang.org/protobuf/proto"
)

// ─────────────────────────────────────────────────────────────────────────────
// Local expression lowering (#if / #case / #pipe / #it)
// ─────────────────────────────────────────────────────────────────────────────

type localLowerer struct {
	target       string
	targetType   ast.FieldType
	bindingTypes map[string]ast.FieldType
	ds           *diag.Diagnostics
	counter      int
	bindings     []*turnoutpb.BindingModel
	itRef        string
	itType       ast.FieldType
	itAllowed    bool
}

// pipeContext captures the three #it-tracking fields together so they can
// be saved and restored atomically — partial restores are a latent footgun.
type pipeContext struct {
	itRef     string
	itType    ast.FieldType
	itAllowed bool
}

func newLocalLowerer(target string, targetType ast.FieldType, bindingTypes map[string]ast.FieldType, ds *diag.Diagnostics) *localLowerer {
	return &localLowerer{target: target, targetType: targetType, bindingTypes: bindingTypes, ds: ds}
}

func (c *localLowerer) savePipeCtx() pipeContext {
	return pipeContext{c.itRef, c.itType, c.itAllowed}
}

func (c *localLowerer) restorePipeCtx(prev pipeContext) {
	c.itRef, c.itType, c.itAllowed = prev.itRef, prev.itType, prev.itAllowed
}

func (c *localLowerer) lowerTop(rhs ast.BindingRHS) []*turnoutpb.BindingModel {
	switch r := rhs.(type) {
	case *ast.IfCallRHS:
		c.lowerIfInto(c.target, c.targetType, r.Cond, r.Then, r.Else)
	case *ast.CaseCallRHS:
		c.lowerCaseInto(c.target, c.targetType, r.Subject, r.Arms)
	case *ast.PipeCallRHS:
		c.lowerPipeInto(c.target, c.targetType, r.Initial, r.Steps)
	default:
		c.emitValue(c.target, c.targetType, zeroLiteralFor(c.targetType))
	}
	if len(c.bindings) == 0 {
		c.emitValue(c.target, c.targetType, zeroLiteralFor(c.targetType))
	}
	// Attach the structured source expression to the user-declared name binding
	// so the HCL emitter can reproduce the original #if/#case/#pipe form.
	if extExpr := bindingRHSToProto(rhs); extExpr != nil {
		for _, b := range c.bindings {
			if b.Name == c.target {
				b.ExtExpr = extExpr
				break
			}
		}
	}
	return c.bindings
}

// temp generates a unique temporary binding name. The counter is never reset
// within a prog, so all generated names are globally unique within that prog.
func (c *localLowerer) temp(prefix string) string {
	c.counter++
	return fmt.Sprintf("__local_%s_%s_%d", c.target, prefix, c.counter)
}

func (c *localLowerer) remember(name string, ft ast.FieldType) {
	c.bindingTypes[name] = ft
}

func (c *localLowerer) appendBinding(b *turnoutpb.BindingModel, ft ast.FieldType) {
	c.bindings = append(c.bindings, b)
	c.remember(b.Name, ft)
}

func (c *localLowerer) emitValue(name string, ft ast.FieldType, lit ast.Literal) {
	c.appendBinding(&turnoutpb.BindingModel{Name: name, Type: ft.String(), Value: literalToStructpb(lit)}, ft)
}

func (c *localLowerer) emitIdentity(name string, ft ast.FieldType, ref string) {
	c.appendBinding(lowerSingleRefRHS(name, ft, &ast.SingleRefRHS{RefName: ref}), ft)
}

func (c *localLowerer) lowerExprInto(name string, ft ast.FieldType, e ast.LocalExpr) {
	switch x := e.(type) {
	case *ast.LocalLitExpr:
		c.emitValue(name, ft, x.Value)
	case *ast.LocalRefExpr:
		if _, known := c.bindingTypes[x.Name]; !known {
			*c.ds = append(*c.ds, diag.ErrorAt(x.Pos.File, x.Pos.Line, x.Pos.Col,
				diag.CodeUndefinedRef,
				"binding %q: reference %q is not defined", c.target, x.Name))
			c.emitValue(name, ft, zeroLiteralFor(ft))
			return
		}
		c.emitIdentity(name, ft, x.Name)
	case *ast.LocalItExpr:
		if !c.itAllowed {
			*c.ds = append(*c.ds, diag.ErrorAt(x.Pos.File, x.Pos.Line, x.Pos.Col,
				diag.CodeUnsupportedConstruct, "#it is only valid inside #pipe step expressions"))
			c.emitValue(name, ft, zeroLiteralFor(ft))
			return
		}
		c.emitIdentity(name, ft, c.itRef)
	case *ast.LocalCallExpr:
		c.lowerCallInto(name, ft, x)
	case *ast.LocalInfixExpr:
		c.lowerInfixInto(name, ft, x)
	case *ast.LocalIfExpr:
		c.lowerIfInto(name, ft, x.Cond, x.Then, x.Else)
	case *ast.LocalCaseExpr:
		c.lowerCaseInto(name, ft, x.Subject, x.Arms)
	case *ast.LocalPipeExpr:
		c.lowerPipeInto(name, ft, x.Initial, x.Steps)
	default:
		c.emitValue(name, ft, zeroLiteralFor(ft))
	}
}

func (c *localLowerer) lowerExprTemp(e ast.LocalExpr, hint string, ft ast.FieldType) (string, ast.FieldType) {
	name := c.temp(hint)
	c.lowerExprInto(name, ft, e)
	return name, ft
}

func (c *localLowerer) lowerFuncTemp(e ast.LocalExpr, hint string, ft ast.FieldType) string {
	ref, _ := c.lowerExprTemp(e, hint+"_value", ft)
	fnName := c.temp(hint + "_fn")
	c.emitIdentity(fnName, ft, ref)
	return fnName
}

func (c *localLowerer) lowerCallInto(name string, ft ast.FieldType, call *ast.LocalCallExpr) {
	args := make([]*turnoutpb.ArgModel, 0, len(call.Args))
	for i, arg := range call.Args {
		// Inline simple args directly rather than emitting a temp binding.
		// Only complex sub-expressions (nested calls, #if, #case, #pipe, infix)
		// need a temp binding.
		switch x := arg.(type) {
		case *ast.LocalRefExpr:
			if _, known := c.bindingTypes[x.Name]; !known {
				*c.ds = append(*c.ds, diag.ErrorAt(x.Pos.File, x.Pos.Line, x.Pos.Col,
					diag.CodeUndefinedRef,
					"binding %q: reference %q is not defined", name, x.Name))
				args = append(args, &turnoutpb.ArgModel{Lit: literalToStructpb(zeroLiteralFor(ft))})
			} else {
				args = append(args, &turnoutpb.ArgModel{Ref: proto.String(x.Name)})
			}
		case *ast.LocalLitExpr:
			args = append(args, &turnoutpb.ArgModel{Lit: literalToStructpb(x.Value)})
		case *ast.LocalItExpr:
			if !c.itAllowed {
				*c.ds = append(*c.ds, diag.ErrorAt(x.Pos.File, x.Pos.Line, x.Pos.Col,
					diag.CodeUnsupportedConstruct, "#it is only valid inside #pipe step expressions"))
				args = append(args, &turnoutpb.ArgModel{Lit: literalToStructpb(zeroLiteralFor(ft))})
			} else {
				args = append(args, &turnoutpb.ArgModel{Ref: proto.String(c.itRef)})
			}
		default:
			argType := c.inferLocalType(arg, ft)
			ref, _ := c.lowerExprTemp(arg, fmt.Sprintf("arg%d", i), argType)
			args = append(args, &turnoutpb.ArgModel{Ref: proto.String(ref)})
		}
	}
	c.appendBinding(&turnoutpb.BindingModel{
		Name: name,
		Type: ft.String(),
		Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
			Fn:   call.FnAlias,
			Args: args,
		}},
	}, ft)
}

func (c *localLowerer) lowerInfixInto(name string, ft ast.FieldType, infix *ast.LocalInfixExpr) {
	fn := infix.Op.FnAliasForType(ft)
	leftType, rightType := localOperandTypes(fn, ft)
	leftRef, _ := c.lowerExprTemp(infix.LHS, "lhs", leftType)
	rightRef, _ := c.lowerExprTemp(infix.RHS, "rhs", rightType)
	c.appendBinding(&turnoutpb.BindingModel{
		Name: name,
		Type: ft.String(),
		Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
			Fn:   fn,
			Args: []*turnoutpb.ArgModel{{Ref: proto.String(leftRef)}, {Ref: proto.String(rightRef)}},
		}},
	}, ft)
}

func (c *localLowerer) lowerIfInto(name string, ft ast.FieldType, cond, thenExpr, elseExpr ast.LocalExpr) {
	condRef, _ := c.lowerExprTemp(cond, "cond", ast.FieldTypeBool)
	thenFn := c.lowerFuncTemp(thenExpr, "then", ft)
	elseFn := c.lowerFuncTemp(elseExpr, "else", ft)
	c.appendBinding(&turnoutpb.BindingModel{
		Name: name,
		Type: ft.String(),
		Expr: &turnoutpb.ExprModel{Cond: &turnoutpb.CondExpr{
			Condition:  &turnoutpb.ArgModel{Ref: proto.String(condRef)},
			Then:       &turnoutpb.ArgModel{FuncRef: proto.String(thenFn)},
			ElseBranch: &turnoutpb.ArgModel{FuncRef: proto.String(elseFn)},
		}},
	}, ft)
}

// lowerCaseInto emits bindings in reverse arm order (last arm first). This is
// required to produce topologically sorted output: each CondExpr binding
// references the next arm's binding as its else-branch, so inner arms must be
// defined before the outer ones that reference them. The user's declared name
// is assigned to the outermost arm (i == 0) and is therefore emitted last.
func (c *localLowerer) lowerCaseInto(name string, ft ast.FieldType, subject ast.LocalExpr, arms []ast.LocalCaseArm) {
	if len(arms) == 0 {
		*c.ds = append(*c.ds, diag.Errorf(diag.CodeUnsupportedConstruct,
			"binding %q: #case with no arms always returns zero — add at least one arm or a wildcard (_)", c.target))
		c.emitValue(name, ft, zeroLiteralFor(ft))
		return
	}
	subjectType := c.inferLocalType(subject, ft)
	subjectRef, _ := c.lowerExprTemp(subject, "subject", subjectType)
	fallbackFn := ""
	seenWildcard := false
	conditionalArms := make([]ast.LocalCaseArm, 0, len(arms))
	for _, arm := range arms {
		if seenWildcard {
			*c.ds = append(*c.ds, diag.Errorf(diag.CodeUnsupportedConstruct,
				"binding %q: #case arm is unreachable (wildcard _ must be the last arm)", c.target))
			break
		}
		if _, ok := arm.Pattern.(*ast.WildcardCasePattern); ok {
			seenWildcard = true
			fallbackFn = c.lowerFuncTemp(arm.Expr, "case_default", ft)
			continue
		}
		conditionalArms = append(conditionalArms, arm)
	}
	if fallbackFn == "" {
		fallbackFn = c.lowerFuncTemp(&ast.LocalLitExpr{Value: zeroLiteralFor(ft)}, "case_default", ft)
	}
	nextFn := fallbackFn
	for i := len(conditionalArms) - 1; i >= 0; i-- {
		arm := conditionalArms[i]
		condRef := c.lowerCasePatternCond(subjectRef, subjectType, arm)
		thenFn := c.lowerFuncTemp(arm.Expr, "case_then", ft)
		condName := c.temp("case_cond")
		if i == 0 {
			condName = name
		}
		c.appendBinding(&turnoutpb.BindingModel{
			Name: condName,
			Type: ft.String(),
			Expr: &turnoutpb.ExprModel{Cond: &turnoutpb.CondExpr{
				Condition:  &turnoutpb.ArgModel{Ref: proto.String(condRef)},
				Then:       &turnoutpb.ArgModel{FuncRef: proto.String(thenFn)},
				ElseBranch: &turnoutpb.ArgModel{FuncRef: proto.String(nextFn)},
			}},
		}, ft)
		nextFn = condName
	}
	if len(conditionalArms) == 0 {
		c.emitIdentity(name, ft, nextFn)
	}
}

func (c *localLowerer) lowerCasePatternCond(subjectRef string, subjectType ast.FieldType, arm ast.LocalCaseArm) string {
	var condRef string
	switch p := arm.Pattern.(type) {
	case *ast.LiteralCasePattern:
		litName := c.temp("case_lit")
		c.emitValue(litName, subjectType, p.Value)
		condRef = c.temp("case_match")
		c.appendBinding(&turnoutpb.BindingModel{
			Name: condRef,
			Type: ast.FieldTypeBool.String(),
			Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
				Fn:   "eq",
				Args: []*turnoutpb.ArgModel{{Ref: proto.String(subjectRef)}, {Ref: proto.String(litName)}},
			}},
		}, ast.FieldTypeBool)
	case *ast.VarBinderPattern:
		condRef = c.temp("case_bind")
		c.emitValue(condRef, ast.FieldTypeBool, &ast.BoolLiteral{Value: true})
		// Inject the binder variable so arm expressions can reference p.Name.
		// emitIdentity also calls remember(), registering the type for downstream inference.
		c.emitIdentity(p.Name, subjectType, subjectRef)
	case *ast.TupleCasePattern:
		*c.ds = append(*c.ds, diag.Errorf(diag.CodeUnsupportedConstruct,
			"binding %q: #case tuple patterns are not yet supported", c.target))
		// Keep the graph structurally valid after reporting the lowering error.
		condRef = c.temp("case_tuple_unsupported")
		c.emitValue(condRef, ast.FieldTypeBool, &ast.BoolLiteral{Value: false})
	default:
		condRef = c.temp("case_unsupported")
		c.emitValue(condRef, ast.FieldTypeBool, &ast.BoolLiteral{Value: false})
	}
	if arm.Guard == nil {
		return condRef
	}
	guardRef, _ := c.lowerExprTemp(arm.Guard, "case_guard", ast.FieldTypeBool)
	combined := c.temp("case_guarded")
	c.appendBinding(&turnoutpb.BindingModel{
		Name: combined,
		Type: ast.FieldTypeBool.String(),
		Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
			Fn:   "bool_and",
			Args: []*turnoutpb.ArgModel{{Ref: proto.String(condRef)}, {Ref: proto.String(guardRef)}},
		}},
	}, ast.FieldTypeBool)
	return combined
}

func (c *localLowerer) lowerPipeInto(name string, ft ast.FieldType, initial ast.LocalExpr, steps []ast.LocalExpr) {
	currentType := c.inferLocalType(initial, ft)
	currentRef, _ := c.lowerExprTemp(initial, "pipe_initial", currentType)
	prev := c.savePipeCtx()
	for i, step := range steps {
		stepName := name
		if i < len(steps)-1 {
			stepName = c.temp("pipe_step")
		}
		c.itRef, c.itType, c.itAllowed = currentRef, currentType, true
		stepType := ft
		if i < len(steps)-1 {
			stepType = c.inferLocalType(step, ft)
		}
		c.lowerExprInto(stepName, stepType, step)
		currentRef, currentType = stepName, stepType
	}
	c.restorePipeCtx(prev)
	if len(steps) == 0 {
		c.emitIdentity(name, ft, currentRef)
	}
}

func (c *localLowerer) inferLocalType(e ast.LocalExpr, fallback ast.FieldType) ast.FieldType {
	switch x := e.(type) {
	case *ast.LocalLitExpr:
		if ft, ok := ast.LiteralFieldType(x.Value); ok {
			return ft
		}
	case *ast.LocalRefExpr:
		if ft, ok := c.bindingTypes[x.Name]; ok {
			return ft
		}
		// Unknown refs fall through to `return fallback` below.
		// The UndefinedRef diagnostic is emitted in lowerExprInto, which also
		// emits a zero literal instead of a dangling identity binding — this
		// prevents the cascade of type-mismatch errors that a dangling ref produces.
	case *ast.LocalItExpr:
		if c.itAllowed {
			return c.itType
		}
	case *ast.LocalCallExpr:
		return localFnReturnType(x.FnAlias, fallback)
	case *ast.LocalInfixExpr:
		return localFnReturnType(x.Op.FnAliasForType(fallback), fallback)
	case *ast.LocalIfExpr:
		return c.inferLocalType(x.Then, fallback)
	case *ast.LocalCaseExpr:
		for _, arm := range x.Arms {
			if t := c.inferLocalType(arm.Expr, fallback); t != fallback {
				return t
			}
		}
	case *ast.LocalPipeExpr:
		if len(x.Steps) > 0 {
			return c.inferLocalType(x.Steps[len(x.Steps)-1], fallback)
		}
		return c.inferLocalType(x.Initial, fallback)
	}
	return fallback
}

func localFnReturnType(fn string, fallback ast.FieldType) ast.FieldType {
	switch fn {
	case "gt", "gte", "lt", "lte", "eq", "neq", "bool_and", "bool_or", "bool_xor", "str_includes", "str_starts", "str_ends", "arr_includes":
		return ast.FieldTypeBool
	case "str_concat":
		return ast.FieldTypeStr
	case "arr_concat":
		return fallback
	case "arr_get":
		// arr_get(arr<T>, number) → T; resolve the element type when we know the array type.
		if fallback.IsArray() {
			return fallback.ElemType()
		}
		return fallback
	case "add", "sub", "mul", "div", "mod", "max", "min":
		return ast.FieldTypeNumber
	default:
		// Unknown function alias — preserve the declared type context instead of
		// silently assuming number. The validator will reject the unknown alias.
		return fallback
	}
}

func localOperandTypes(fn string, fallback ast.FieldType) (ast.FieldType, ast.FieldType) {
	switch fn {
	case "str_concat", "str_includes", "str_starts", "str_ends":
		return ast.FieldTypeStr, ast.FieldTypeStr
	case "bool_and", "bool_or", "bool_xor":
		return ast.FieldTypeBool, ast.FieldTypeBool
	case "eq", "neq":
		return fallback, fallback
	default:
		return ast.FieldTypeNumber, ast.FieldTypeNumber
	}
}

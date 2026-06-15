// lower_local.go lowers #if / #case / #pipe LocalExpr trees to flat binding sequences.
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
// Local expression lowering (#if / #case / #pipe / #it)
// ─────────────────────────────────────────────────────────────────────────────

type localLowerer struct {
	target       string
	targetType   ast.FieldType
	bindingTypes map[string]ast.FieldType
	ds           *diag.DiagSink
	counter      *int
	bindings     []*turnoutpb.BindingModel
}

// pipeContext carries the #it tracking state for the current pipe scope.
// The zero value (itAllowed = false) means "not inside a #pipe step".
// A new pipeContext is constructed for each pipe step and passed explicitly
// rather than stored as mutable fields on localLowerer.
type pipeContext struct {
	itRef     string
	itType    ast.FieldType
	itAllowed bool
}

func newLocalLowerer(target string, targetType ast.FieldType, bindingTypes map[string]ast.FieldType, ds *diag.DiagSink, counter *int) *localLowerer {
	return &localLowerer{target: target, targetType: targetType, bindingTypes: bindingTypes, ds: ds, counter: counter}
}

func (c *localLowerer) lowerTop(rhs ast.BindingRHS) []*turnoutpb.BindingModel {
	pc := pipeContext{} // no active pipe at the top level
	switch r := rhs.(type) {
	case *ast.IfCallRHS:
		c.lowerIfInto(c.target, c.targetType, r.Cond, r.Then, r.Else, pc)
	case *ast.CaseCallRHS:
		c.lowerCaseInto(c.target, c.targetType, r.Subject, r.Arms, pc)
	case *ast.PipeCallRHS:
		c.lowerPipeInto(c.target, c.targetType, r.Initial, r.Steps, pc)
	default:
		c.ds.Append(diag.Errorf(diag.CodeInternalError,
			"binding %q has unhandled RHS type %T — this is a compiler bug; please report the source file", c.target, rhs))
		c.emitValue(c.target, c.targetType, zeroLiteralFor(c.targetType))
		return c.bindings
	}
	if len(c.bindings) == 0 {
		c.ds.Append(diag.Errorf(diag.CodeUnsupportedConstruct,
			"binding %q: local expression lowering produced no bindings (compiler bug)", c.target))
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
	// Invariant: the root binding must carry ExtExpr whenever it also carries a
	// flat Expr. The HCL emitter relies on ExtExpr to reproduce the original
	// #if/#case/#pipe source form; a missing ExtExpr would silently produce
	// wrong output. Emit a diagnostic instead of letting this pass silently.
	for _, b := range c.bindings {
		if b.Name == c.target && b.Expr != nil && b.ExtExpr == nil {
			c.ds.Append(diag.Errorf(diag.CodeUnsupportedConstruct,
				"internal: ext_expr not set on local-RHS root binding %q — compiler bug", c.target))
			break
		}
	}
	return c.bindings
}

// temp generates a unique temporary binding name. The counter is shared across
// all bindings in a prog, so all generated names are globally unique within that prog.
func (c *localLowerer) temp(prefix string) string {
	*c.counter++
	return names.LocalName(c.target, prefix, *c.counter)
}

func (c *localLowerer) remember(name string, ft ast.FieldType) {
	c.bindingTypes[name] = ft
}

func (c *localLowerer) appendBinding(b *turnoutpb.BindingModel, ft ast.FieldType) {
	c.bindings = append(c.bindings, b)
	c.remember(b.Name, ft)
}

func (c *localLowerer) emitValue(name string, ft ast.FieldType, lit ast.Literal) {
	c.appendBinding(&turnoutpb.BindingModel{Name: name, Type: ft.ProtoString(), Value: ast.LiteralToStructpb(lit)}, ft)
}

func (c *localLowerer) emitIdentity(name string, ft ast.FieldType, ref string) {
	bm := lowerSingleRefRHS(name, ft, &ast.SingleRefRHS{RefName: ref})
	if bm == nil {
		// ft is FieldTypeInvalid; fall back to a zero-value binding so the prog is well-formed.
		c.emitValue(name, ast.FieldTypeNumber, &ast.NumberLiteral{Value: 0})
		return
	}
	c.appendBinding(bm, ft)
}

func (c *localLowerer) lowerExprInto(name string, ft ast.FieldType, e ast.LocalExpr, pc pipeContext) {
	switch x := e.(type) {
	case *ast.LocalLitExpr:
		c.emitValue(name, ft, x.Value)
	case *ast.LocalRefExpr:
		if _, known := c.bindingTypes[x.Name]; !known {
			c.ds.Append(diag.ErrorAt(x.Pos.File, x.Pos.Line, x.Pos.Col,
				diag.CodeUndefinedRef,
				"binding %q: reference %q is not defined", c.target, x.Name))
			c.emitValue(name, ft, zeroLiteralFor(ft))
			return
		}
		c.emitIdentity(name, ft, x.Name)
	case *ast.LocalItExpr:
		if !pc.itAllowed {
			c.ds.Append(diag.ErrorAt(x.Pos.File, x.Pos.Line, x.Pos.Col,
				diag.CodeUnsupportedConstruct, "#it is only valid inside #pipe step expressions"))
			c.emitValue(name, ft, zeroLiteralFor(ft))
			return
		}
		c.emitIdentity(name, ft, pc.itRef)
	case *ast.LocalCallExpr:
		c.lowerCallInto(name, ft, x, pc)
	case *ast.LocalInfixExpr:
		c.lowerInfixInto(name, ft, x, pc)
	case *ast.LocalIfExpr:
		c.lowerIfInto(name, ft, x.Cond, x.Then, x.Else, pc)
	case *ast.LocalCaseExpr:
		c.lowerCaseInto(name, ft, x.Subject, x.Arms, pc)
	case *ast.LocalPipeExpr:
		c.lowerPipeInto(name, ft, x.Initial, x.Steps, pc)
	default:
		c.ds.Append(diag.Errorf(diag.CodeInternalError,
			"binding %q: unhandled LocalExpr type %T — this is a compiler bug; please report the source file", c.target, e))
		c.emitValue(name, ft, zeroLiteralFor(ft))
	}
}

func (c *localLowerer) lowerExprTemp(e ast.LocalExpr, hint string, ft ast.FieldType, pc pipeContext) (string, ast.FieldType) {
	name := c.temp(hint)
	c.lowerExprInto(name, ft, e, pc)
	return name, ft
}

func (c *localLowerer) lowerFuncTemp(e ast.LocalExpr, hint string, ft ast.FieldType, pc pipeContext) string {
	ref, _ := c.lowerExprTemp(e, hint+"_value", ft, pc)
	fnName := c.temp(hint + "_fn")
	c.emitIdentity(fnName, ft, ref)
	return fnName
}

// lowerLocalArgModel converts a single local-expression call argument to an
// ArgModel. Simple cases (ref, lit, #it) are inlined directly; complex
// sub-expressions (nested calls, #if, #case, #pipe, infix) are lowered into a
// temp binding and referenced by name. Centralising this logic removes the
// duplicate undefined-ref and #it-outside-pipe checks that previously existed
// in the lowerCallInto argument loop.
func (c *localLowerer) lowerLocalArgModel(arg ast.LocalExpr, argIdx int, bindingName string, ft ast.FieldType, pc pipeContext) *turnoutpb.ArgModel {
	switch x := arg.(type) {
	case *ast.LocalRefExpr:
		if _, known := c.bindingTypes[x.Name]; !known {
			c.ds.Append(diag.ErrorAt(x.Pos.File, x.Pos.Line, x.Pos.Col,
				diag.CodeUndefinedRef,
				"binding %q: reference %q is not defined", bindingName, x.Name))
			return &turnoutpb.ArgModel{Lit: ast.LiteralToStructpb(zeroLiteralFor(ft))}
		}
		return &turnoutpb.ArgModel{Ref: proto.String(x.Name)}
	case *ast.LocalLitExpr:
		return &turnoutpb.ArgModel{Lit: ast.LiteralToStructpb(x.Value)}
	case *ast.LocalItExpr:
		if !pc.itAllowed {
			c.ds.Append(diag.ErrorAt(x.Pos.File, x.Pos.Line, x.Pos.Col,
				diag.CodeUnsupportedConstruct, "#it is only valid inside #pipe step expressions"))
			return &turnoutpb.ArgModel{Lit: ast.LiteralToStructpb(zeroLiteralFor(ft))}
		}
		return &turnoutpb.ArgModel{Ref: proto.String(pc.itRef)}
	default:
		argType, argTypeOK := c.inferLocalType(arg, ft, pc)
		if !argTypeOK {
			argType = ft
		}
		ref, _ := c.lowerExprTemp(arg, fmt.Sprintf("arg%d", argIdx), argType, pc)
		return &turnoutpb.ArgModel{Ref: proto.String(ref)}
	}
}

func (c *localLowerer) lowerCallInto(name string, ft ast.FieldType, call *ast.LocalCallExpr, pc pipeContext) {
	// Planned-but-unsupported constructs get a targeted error before the generic
	// unknown-fn check so the message is clearly actionable.
	if checkUnsupportedFn(c.target, call.FnAlias, call.Pos, c.ds) {
		c.emitValue(name, ft, zeroLiteralFor(ft))
		return
	}
	// Unknown function: emit a diagnostic immediately so the error is pinned to
	// the call site rather than surfacing as cascading type-mismatch errors
	// elsewhere. This mirrors the early exit pattern used by checkOperatorOnly.
	if _, ok := fnmeta.BuiltinFn(call.FnAlias); !ok {
		c.ds.Append(diag.ErrorAt(call.Pos.File, call.Pos.Line, call.Pos.Col,
			diag.CodeUnknownFnAlias,
			"binding %q: %q is not a known function", c.target, call.FnAlias))
		c.emitValue(name, ft, zeroLiteralFor(ft))
		return
	}
	// Operator-only functions are infix-only outside of #pipe steps. Inside a
	// pipe step (itAllowed), add(#it, n) / mul(#it, n) etc. are the natural
	// calling form and are explicitly allowed.
	if !pc.itAllowed && checkOperatorOnly(c.target, call.FnAlias, call.Pos, c.ds) {
		c.emitValue(name, ft, zeroLiteralFor(ft))
		return
	}
	args := make([]*turnoutpb.ArgModel, 0, len(call.Args))
	for i, arg := range call.Args {
		args = append(args, c.lowerLocalArgModel(arg, i, name, ft, pc))
	}
	c.appendBinding(&turnoutpb.BindingModel{
		Name: name,
		Type: ft.ProtoString(),
		Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
			Fn:   call.FnAlias,
			Args: args,
		}},
	}, ft)
}

func (c *localLowerer) lowerInfixInto(name string, ft ast.FieldType, infix *ast.LocalInfixExpr, pc pipeContext) {
	fn := infix.Op.FnAliasForType(ft)
	leftType, rightType, ok := fnmeta.OperandTypes(fn, ft)
	if !ok {
		c.ds.Append(diag.ErrorAt(infix.Pos.File, infix.Pos.Line, infix.Pos.Col,
			diag.CodeInternalError,
			"binding %q: infix operator maps to unknown function %q — this is a compiler bug; please report the source file", c.target, fn))
		c.emitValue(name, ft, zeroLiteralFor(ft))
		return
	}
	leftRef, _ := c.lowerExprTemp(infix.LHS, "lhs", leftType, pc)
	rightRef, _ := c.lowerExprTemp(infix.RHS, "rhs", rightType, pc)
	c.appendBinding(&turnoutpb.BindingModel{
		Name: name,
		Type: ft.ProtoString(),
		Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
			Fn:   fn,
			Args: []*turnoutpb.ArgModel{{Ref: proto.String(leftRef)}, {Ref: proto.String(rightRef)}},
		}},
	}, ft)
}

func (c *localLowerer) lowerIfInto(name string, ft ast.FieldType, cond, thenExpr, elseExpr ast.LocalExpr, pc pipeContext) {
	condRef, _ := c.lowerExprTemp(cond, "cond", ast.FieldTypeBool, pc)
	thenFn := c.lowerFuncTemp(thenExpr, "then", ft, pc)
	elseFn := c.lowerFuncTemp(elseExpr, "else", ft, pc)
	c.appendBinding(&turnoutpb.BindingModel{
		Name: name,
		Type: ft.ProtoString(),
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
// defined before the outer arms that reference them. The user's declared name
// is assigned to the outermost arm (i == 0) and is therefore emitted last.
//
// Example for three arms [A, B, C]:
//
//	emitted order: C_then, C_cond, B_then, B_cond (else→C_cond), A_then, A_cond (=name, else→B_cond)
//
// Inverting this loop would produce forward references that the runtime cannot resolve.
func (c *localLowerer) lowerCaseInto(name string, ft ast.FieldType, subject ast.LocalExpr, arms []ast.LocalCaseArm, pc pipeContext) {
	if len(arms) == 0 {
		c.ds.Append(diag.Errorf(diag.CodeUnsupportedConstruct,
			"binding %q: #case with no arms always returns zero — add at least one arm or a wildcard (_)", c.target))
		c.emitValue(name, ft, zeroLiteralFor(ft))
		return
	}
	subjectType, _ := c.inferLocalType(subject, ft, pc)
	subjectRef, _ := c.lowerExprTemp(subject, "subject", subjectType, pc)
	fallbackFn := ""
	seenWildcard := false
	seenLiterals := make(map[string]bool)
	conditionalArms := make([]ast.LocalCaseArm, 0, len(arms))
	for i, arm := range arms {
		if seenWildcard {
			// Arms after the first wildcard are unreachable and were already
			// diagnosed by the first wildcard's j-loop. Skip without re-entering
			// the wildcard branch, which would otherwise overwrite fallbackFn.
			continue
		}
		if _, ok := arm.Pattern.(*ast.WildcardCasePattern); ok {
			// Emit unreachable-arm diagnostics immediately, before lowering the
			// wildcard body, so they are never lost if body-lowering halts the sink.
			for j := i + 1; j < len(arms); j++ {
				c.ds.Append(diag.Errorf(diag.CodeUnsupportedConstruct,
					"binding %q: arm %d is unreachable (wildcard _ must be the last arm)", c.target, j))
			}
			seenWildcard = true
			fallbackFn = c.lowerFuncTemp(arm.Expr, "case_default", ft, pc)
			continue
		}
		if p, ok := arm.Pattern.(*ast.LiteralCasePattern); ok {
			key := caseLiteralKey(p.Value)
			if seenLiterals[key] {
				c.ds.Append(diag.ErrorAt(arm.Pos.File, arm.Pos.Line, arm.Pos.Col,
					diag.CodeDuplicateCasePattern,
					"binding %q: #case arm %d has the same literal pattern as an earlier arm — arm is unreachable",
					c.target, i))
				continue
			}
			seenLiterals[key] = true
		}
		conditionalArms = append(conditionalArms, arm)
	}
	if fallbackFn == "" {
		fallbackFn = c.lowerFuncTemp(&ast.LocalLitExpr{Value: zeroLiteralFor(ft)}, "case_default", ft, pc)
	}
	nextFn := fallbackFn
	for i := len(conditionalArms) - 1; i >= 0; i-- {
		arm := conditionalArms[i]
		condRef := c.lowerCasePatternCond(subjectRef, subjectType, arm, pc)
		thenFn := c.lowerFuncTemp(arm.Expr, "case_then", ft, pc)
		condName := c.temp("case_cond")
		if i == 0 {
			condName = name
		}
		c.appendBinding(&turnoutpb.BindingModel{
			Name: condName,
			Type: ft.ProtoString(),
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

func (c *localLowerer) lowerCasePatternCond(subjectRef string, subjectType ast.FieldType, arm ast.LocalCaseArm, pc pipeContext) string {
	var condRef string
	switch p := arm.Pattern.(type) {
	case *ast.LiteralCasePattern:
		litName := c.temp("case_lit")
		c.emitValue(litName, subjectType, p.Value)
		condRef = c.temp("case_match")
		c.appendBinding(&turnoutpb.BindingModel{
			Name: condRef,
			Type: ast.FieldTypeBool.ProtoString(),
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
	default:
		condRef = c.temp("case_unsupported")
		c.emitValue(condRef, ast.FieldTypeBool, &ast.BoolLiteral{Value: false})
	}
	if arm.Guard == nil {
		return condRef
	}
	guardRef, _ := c.lowerExprTemp(arm.Guard, "case_guard", ast.FieldTypeBool, pc)
	combined := c.temp("case_guarded")
	c.appendBinding(&turnoutpb.BindingModel{
		Name: combined,
		Type: ast.FieldTypeBool.ProtoString(),
		Expr: &turnoutpb.ExprModel{Combine: &turnoutpb.CombineExpr{
			Fn:   "bool_and",
			Args: []*turnoutpb.ArgModel{{Ref: proto.String(condRef)}, {Ref: proto.String(guardRef)}},
		}},
	}, ast.FieldTypeBool)
	return combined
}

func (c *localLowerer) lowerPipeInto(name string, ft ast.FieldType, initial ast.LocalExpr, steps []ast.LocalExpr, outerPC pipeContext) {
	currentType, _ := c.inferLocalType(initial, ft, outerPC)
	currentRef, _ := c.lowerExprTemp(initial, "pipe_initial", currentType, outerPC)
	for i, step := range steps {
		stepName := name
		if i < len(steps)-1 {
			stepName = c.temp("pipe_step")
		}
		stepPC := pipeContext{itRef: currentRef, itType: currentType, itAllowed: true}
		stepType := ft
		if i < len(steps)-1 {
			stepType, _ = c.inferLocalType(step, ft, stepPC)
		}
		c.lowerExprInto(stepName, stepType, step, stepPC)
		currentRef, currentType = stepName, stepType
	}
	if len(steps) == 0 {
		c.emitIdentity(name, ft, currentRef)
	}
}

// inferLocalType infers the FieldType of a LocalExpr without lowering it.
// Returns (type, true) when the type is definitively known from the expression
// structure; returns (fallback, false) when the type cannot be determined
// (e.g. undefined reference, unknown literal form). Callers that need to
// distinguish "inferred" from "fell back" should check the bool.
func (c *localLowerer) inferLocalType(e ast.LocalExpr, fallback ast.FieldType, pc pipeContext) (ast.FieldType, bool) {
	switch x := e.(type) {
	case *ast.LocalLitExpr:
		if ft, ok := ast.LiteralFieldType(x.Value); ok {
			return ft, true
		}
	case *ast.LocalRefExpr:
		if ft, ok := c.bindingTypes[x.Name]; ok {
			return ft, true
		}
		// Unknown ref: UndefinedRef is emitted in lowerExprInto; return false
		// so callers can avoid cascading type-mismatch errors on top of it.
	case *ast.LocalItExpr:
		if pc.itAllowed {
			return pc.itType, true
		}
	case *ast.LocalCallExpr:
		return fnmeta.ReturnType(x.FnAlias, fallback), true
	case *ast.LocalInfixExpr:
		return fnmeta.ReturnType(x.Op.FnAliasForType(fallback), fallback), true
	case *ast.LocalIfExpr:
		return c.inferLocalType(x.Then, fallback, pc)
	case *ast.LocalCaseExpr:
		for _, arm := range x.Arms {
			if t, ok := c.inferLocalType(arm.Expr, fallback, pc); ok {
				return t, true
			}
		}
	case *ast.LocalPipeExpr:
		if len(x.Steps) > 0 {
			return c.inferLocalType(x.Steps[len(x.Steps)-1], fallback, pc)
		}
		return c.inferLocalType(x.Initial, fallback, pc)
	}
	return fallback, false
}

// caseLiteralKey returns a string key that uniquely identifies an ast.Literal
// value for use in duplicate-pattern detection within a single #case expression.
func caseLiteralKey(lit ast.Literal) string {
	switch v := lit.(type) {
	case *ast.NumberLiteral:
		return fmt.Sprintf("number:%v", v.Value)
	case *ast.StringLiteral:
		return fmt.Sprintf("str:%q", v.Value)
	case *ast.BoolLiteral:
		return fmt.Sprintf("bool:%v", v.Value)
	default:
		return fmt.Sprintf("%T:%v", lit, lit)
	}
}

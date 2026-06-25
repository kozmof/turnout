package emit

import (
	"fmt"
	"strings"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
)

// ─────────────────────────────────────────────────────────────────────────────
// Extended expression emitters (#if / #case / #pipe from proto ext_expr)
// ─────────────────────────────────────────────────────────────────────────────

// writeExtExpr writes `expr  = { if/case/pipe = { ... } }` from the proto LocalExprModel.
// bindingType is the declared DSL type string of the enclosing binding (e.g. "str", "number"),
// used to resolve the InfixPlus operator to "str_concat" vs "add".
func writeExtExpr(iw *iWriter, e *turnoutpb.LocalExprModel, bindingType string) {
	if iw.err != nil {
		return
	}
	iw.wl("expr  = {")
	iw.depth++
	switch x := e.Expr.(type) {
	case *turnoutpb.LocalExprModel_IfExpr:
		iw.wl("if = {")
		iw.depth++
		iw.wl("cond = %s", iw.localExprInline(x.IfExpr.GetCond(), bindingType))
		iw.wl("then = %s", iw.localExprInline(x.IfExpr.GetThen(), bindingType))
		iw.wl("else = %s", iw.localExprInline(x.IfExpr.GetElseBranch(), bindingType))
		iw.depth--
		iw.wl("}")
	case *turnoutpb.LocalExprModel_CaseExpr:
		iw.wl("case = {")
		iw.depth++
		iw.wl("subject = %s", iw.localExprInline(x.CaseExpr.GetSubject(), bindingType))
		arms := make([]string, len(x.CaseExpr.GetArms()))
		for i, arm := range x.CaseExpr.GetArms() {
			arms[i] = iw.localCaseArmInline(arm, bindingType)
		}
		iw.wl("arms    = [%s]", strings.Join(arms, ", "))
		iw.depth--
		iw.wl("}")
	case *turnoutpb.LocalExprModel_PipeExpr:
		iw.wl("pipe = {")
		iw.depth++
		iw.wl("initial = %s", iw.localExprInline(x.PipeExpr.GetInitial(), bindingType))
		steps := make([]string, len(x.PipeExpr.GetSteps()))
		for i, s := range x.PipeExpr.GetSteps() {
			steps[i] = iw.localExprInline(s, bindingType)
		}
		iw.wl("steps   = [%s]", strings.Join(steps, ", "))
		iw.depth--
		iw.wl("}")
	default:
		panic(fmt.Sprintf(
			"writeExtExpr: unhandled LocalExprModel type %T — when adding a new variant, update all three touch points: "+
				"(1) schema/turnout-model.proto (add the proto message), "+
				"(2) internal/lower/lower_local.go (emit the proto node in lowerTop / lowerIfInto etc.), "+
				"(3) internal/emit/emit.go writeExtExpr + localExprInline (render the node)",
			e.Expr,
		))
	}
	iw.depth--
	iw.wl("}")
}

// localExprInline returns the inline HCL representation of a proto LocalExprModel.
// bindingType is the declared DSL type string of the enclosing binding, used to
// resolve InfixPlus to "str_concat" (str) or "add" (number).
func (iw *iWriter) localExprInline(e *turnoutpb.LocalExprModel, bindingType string) string {
	if e == nil {
		panic("localExprInline: nil LocalExprModel — this is a compiler bug; every branch of a #if/#case/#pipe must produce a non-nil node")
	}
	if iw.err != nil {
		return `{ ref = "" }`
	}
	switch x := e.Expr.(type) {
	case *turnoutpb.LocalExprModel_Ref:
		return fmt.Sprintf(`{ ref = %q }`, x.Ref.GetName())
	case *turnoutpb.LocalExprModel_Lit:
		return fmt.Sprintf(`{ lit = %s }`, writeStructpbValue(x.Lit.GetValue()))
	case *turnoutpb.LocalExprModel_It:
		return `{ it = true }`
	case *turnoutpb.LocalExprModel_Call:
		args := make([]string, len(x.Call.GetArgs()))
		for i, a := range x.Call.GetArgs() {
			args[i] = iw.localExprInline(a, bindingType)
		}
		return fmt.Sprintf(`{ combine = { fn = %q, args = [%s] } }`, x.Call.GetFn(), strings.Join(args, ", "))
	case *turnoutpb.LocalExprModel_Infix:
		op := ast.InfixOp(int32(x.Infix.GetOp()))
		ft, ok := ast.FieldTypeFromString(bindingType)
		if !ok {
			iw.setErr(fmt.Errorf("localExprInline: unknown binding type %q", bindingType))
			return `{ ref = "" }`
		}
		fn := op.FnAliasForType(ft)
		return fmt.Sprintf(`{ combine = { fn = %q, args = [%s, %s] } }`, fn,
			iw.localExprInline(x.Infix.GetLhs(), bindingType), iw.localExprInline(x.Infix.GetRhs(), bindingType))
	case *turnoutpb.LocalExprModel_IfExpr:
		return fmt.Sprintf(`{ if = { cond = %s, then = %s, else = %s } }`,
			iw.localExprInline(x.IfExpr.GetCond(), bindingType), iw.localExprInline(x.IfExpr.GetThen(), bindingType), iw.localExprInline(x.IfExpr.GetElseBranch(), bindingType))
	case *turnoutpb.LocalExprModel_CaseExpr:
		arms := make([]string, len(x.CaseExpr.GetArms()))
		for i, arm := range x.CaseExpr.GetArms() {
			arms[i] = iw.localCaseArmInline(arm, bindingType)
		}
		return fmt.Sprintf(`{ case = { subject = %s, arms = [%s] } }`,
			iw.localExprInline(x.CaseExpr.GetSubject(), bindingType), strings.Join(arms, ", "))
	case *turnoutpb.LocalExprModel_PipeExpr:
		steps := make([]string, len(x.PipeExpr.GetSteps()))
		for i, s := range x.PipeExpr.GetSteps() {
			steps[i] = iw.localExprInline(s, bindingType)
		}
		return fmt.Sprintf(`{ pipe = { initial = %s, steps = [%s] } }`,
			iw.localExprInline(x.PipeExpr.GetInitial(), bindingType), strings.Join(steps, ", "))
	}
	panic(fmt.Sprintf(
		"localExprInline: unhandled LocalExprModel type %T — when adding a new variant, update all three touch points: "+
			"(1) schema/turnout-model.proto (add the proto message), "+
			"(2) internal/lower/lower_local.go (emit the proto node in lowerTop / lowerIfInto etc.), "+
			"(3) internal/emit/emit.go writeExtExpr + localExprInline (render the node)",
		e.Expr,
	))
}

func (iw *iWriter) localCaseArmInline(arm *turnoutpb.LocalCaseArmModel, bindingType string) string {
	s := fmt.Sprintf(`{ pattern = %s`, localPatternInline(arm.GetPattern()))
	if arm.GetGuard() != nil {
		s += fmt.Sprintf(`, guard = %s`, iw.localExprInline(arm.GetGuard(), bindingType))
	}
	s += fmt.Sprintf(`, expr = %s }`, iw.localExprInline(arm.GetExpr(), bindingType))
	return s
}

func localPatternInline(p *turnoutpb.LocalCasePatternModel) string {
	if p == nil {
		return `{ wildcard = true }`
	}
	switch x := p.Pattern.(type) {
	case *turnoutpb.LocalCasePatternModel_Wildcard:
		return `{ wildcard = true }`
	case *turnoutpb.LocalCasePatternModel_Lit:
		return fmt.Sprintf(`{ lit = %s }`, writeStructpbValue(x.Lit.GetValue()))
	case *turnoutpb.LocalCasePatternModel_VarBinder:
		return fmt.Sprintf(`{ bind = %q }`, x.VarBinder.GetName())
	}
	return `{ wildcard = true }`
}

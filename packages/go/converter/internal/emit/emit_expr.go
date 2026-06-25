package emit

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"google.golang.org/protobuf/types/known/structpb"
)

// ─────────────────────────────────────────────────────────────────────────────
// Expr block (combine / pipe / cond)
// ─────────────────────────────────────────────────────────────────────────────

func writeExpr(iw *iWriter, expr *turnoutpb.ExprModel) {
	iw.wl("expr  = {")
	iw.depth++
	switch {
	case expr.Combine != nil:
		writeCombine(iw, expr.Combine)
	case expr.Pipe != nil:
		writePipe(iw, expr.Pipe)
	case expr.Cond != nil:
		writeCond(iw, expr.Cond)
	}
	iw.depth--
	iw.wl("}")
}

func writeCombine(iw *iWriter, c *turnoutpb.CombineExpr) {
	iw.wl("combine = {")
	iw.depth++
	iw.wl("fn   = %q", c.Fn)
	iw.wl("args = %s", writeArgs(c.Args))
	iw.depth--
	iw.wl("}")
}

func writePipe(iw *iWriter, p *turnoutpb.PipeExpr) {
	iw.wl("pipe = {")
	iw.depth++

	// pipe args: { p = { ref = "v" }, ... }
	if len(p.Params) == 0 {
		iw.wl("args  = {}")
	} else {
		parts := make([]string, len(p.Params))
		for i, param := range p.Params {
			parts[i] = fmt.Sprintf("%s = { ref = %q }", param.ParamName, param.SourceIdent)
		}
		iw.wl("args  = { %s }", strings.Join(parts, ", "))
	}

	// pipe steps
	if len(p.Steps) == 0 {
		iw.wl("steps = []")
	} else {
		iw.wl("steps = [")
		iw.depth++
		for _, step := range p.Steps {
			iw.wl("{ fn = %q, args = %s },", step.Fn, writeArgs(step.Args))
		}
		iw.depth--
		iw.wl("]")
	}

	iw.depth--
	iw.wl("}")
}

func writeCond(iw *iWriter, c *turnoutpb.CondExpr) {
	iw.wl("cond = {")
	iw.depth++
	if c.Condition != nil {
		iw.wl("condition = %s", writeArg(c.Condition))
	}
	if c.Then != nil {
		iw.wl("then      = %s", writeArg(c.Then))
	}
	if c.ElseBranch != nil {
		iw.wl("else      = %s", writeArg(c.ElseBranch))
	}
	iw.depth--
	iw.wl("}")
}

// ─────────────────────────────────────────────────────────────────────────────
// Arg and Literal helpers
// ─────────────────────────────────────────────────────────────────────────────

// writeArg returns the inline HCL object representation of one arg.
func writeArg(arg *turnoutpb.ArgModel) string {
	switch {
	case arg.Ref != nil:
		return fmt.Sprintf(`{ ref = %q }`, *arg.Ref)
	case arg.Lit != nil:
		return fmt.Sprintf(`{ lit = %s }`, writeStructpbValue(arg.Lit))
	case arg.FuncRef != nil:
		return fmt.Sprintf(`{ func_ref = %q }`, *arg.FuncRef)
	case arg.StepRef != nil:
		return fmt.Sprintf(`{ step_ref = %d }`, *arg.StepRef)
	case arg.Transform != nil:
		fnParts := make([]string, len(arg.Transform.Fn))
		for i, f := range arg.Transform.Fn {
			fnParts[i] = fmt.Sprintf("%q", f)
		}
		return fmt.Sprintf(`{ transform = { ref = %q, fn = [%s] } }`, arg.Transform.Ref, strings.Join(fnParts, ", "))
	}
	return `{}`
}

// writeArgs returns the inline HCL tuple representation of an args slice.
func writeArgs(args []*turnoutpb.ArgModel) string {
	if len(args) == 0 {
		return "[]"
	}
	parts := make([]string, len(args))
	for i, a := range args {
		parts[i] = writeArg(a)
	}
	return "[" + strings.Join(parts, ", ") + "]"
}

// writeStructpbValue returns the HCL text representation of a structpb.Value.
//   - NullValue:   null
//   - NumberValue: bare number, no trailing ".0" for integers
//   - StringValue: double-quoted, with Go's %q escaping
//   - BoolValue:   true / false
//   - ListValue:   [] or [v1, v2, ...] (all on one line)
func writeStructpbValue(v *structpb.Value) string {
	if v == nil {
		return "null"
	}
	switch k := v.Kind.(type) {
	case *structpb.Value_NullValue:
		return "null"
	case *structpb.Value_NumberValue:
		return strconv.FormatFloat(k.NumberValue, 'f', -1, 64)
	case *structpb.Value_StringValue:
		return fmt.Sprintf("%q", k.StringValue)
	case *structpb.Value_BoolValue:
		if k.BoolValue {
			return "true"
		}
		return "false"
	case *structpb.Value_ListValue:
		if k.ListValue == nil || len(k.ListValue.Values) == 0 {
			return "[]"
		}
		parts := make([]string, len(k.ListValue.Values))
		for i, e := range k.ListValue.Values {
			parts[i] = writeStructpbValue(e)
		}
		return "[" + strings.Join(parts, ", ") + "]"
	}
	panic(fmt.Sprintf("writeStructpbValue: unhandled structpb kind %T — "+
		"struct/map values are not valid in Turn DSL bindings; this is a compiler bug", v.Kind))
}

// Package emit writes canonical plain HCL from the validated proto model.
// All structural and type errors must be caught before calling Emit; no DSL
// validation is performed here.
package emit

import (
	"fmt"
	"hash/fnv"
	"io"
	"strconv"
	"strings"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"google.golang.org/protobuf/types/known/structpb"
)

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

// Emit writes canonical plain HCL to w from the validated proto model.
// Returns a diagnostic if an IO error occurs during writing.
func Emit(w io.Writer, tm *turnoutpb.TurnModel) diag.Diagnostics {
	if tm == nil {
		return nil
	}
	iw := &iWriter{out: w}
	sep := false
	if tm.State != nil {
		writeStateBlock(iw, tm.State)
		sep = true
	}
	for _, s := range tm.Scenes {
		if sep {
			iw.nl()
		}
		writeSceneBlock(iw, s)
		sep = true
	}
	for _, r := range tm.Routes {
		if sep {
			iw.nl()
		}
		writeRouteBlock(iw, r)
		sep = true
	}
	if iw.err != nil {
		return diag.Diagnostics{diag.Errorf(diag.CodeEmitIOError, "emit error: %v", iw.err)}
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
// iWriter — indented line writer
// ─────────────────────────────────────────────────────────────────────────────

type iWriter struct {
	out   io.Writer
	depth int
	err   error // first error encountered (IO or delimiter); subsequent writes are no-ops
}

// setErr records the first non-IO error (e.g., delimiter collision).
func (iw *iWriter) setErr(err error) {
	if iw.err == nil {
		iw.err = err
	}
}

// wl writes one line at current indentation followed by a newline.
func (iw *iWriter) wl(format string, args ...interface{}) {
	if iw.err != nil {
		return
	}
	_, iw.err = fmt.Fprintf(iw.out, iw.tabs()+format+"\n", args...)
}

// nl writes a blank line (no content, no indentation).
func (iw *iWriter) nl() {
	if iw.err != nil {
		return
	}
	_, iw.err = fmt.Fprintln(iw.out)
}

// tabs returns the current indentation string (2 spaces per level).
func (iw *iWriter) tabs() string {
	return strings.Repeat("  ", iw.depth)
}

// ─────────────────────────────────────────────────────────────────────────────
// State block
// ─────────────────────────────────────────────────────────────────────────────

func writeStateBlock(iw *iWriter, s *turnoutpb.StateModel) {
	iw.wl("state {")
	iw.depth++
	for _, ns := range s.Namespaces {
		iw.wl("namespace %q {", ns.Name)
		iw.depth++
		for _, f := range ns.Fields {
			iw.wl("field %q {", f.Name)
			iw.depth++
			iw.wl("type  = %q", f.Type)
			iw.wl("value = %s", writeStructpbValue(f.Value))
			iw.depth--
			iw.wl("}")
		}
		iw.depth--
		iw.wl("}")
	}
	iw.depth--
	iw.wl("}")
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene block
// ─────────────────────────────────────────────────────────────────────────────

func writeSceneBlock(iw *iWriter, s *turnoutpb.SceneBlock) {
	iw.wl("scene %q {", s.Id)
	iw.depth++

	// entry_actions = ["a", "b"]
	ea := make([]string, len(s.EntryActions))
	for i, a := range s.EntryActions {
		ea[i] = fmt.Sprintf("%q", a)
	}
	iw.wl("entry_actions = [%s]", strings.Join(ea, ", "))

	// next_policy = "..." (omit if absent)
	if s.NextPolicy != nil {
		iw.wl("next_policy   = %q", *s.NextPolicy)
	}

	// view block (omit if absent)
	if s.View != nil {
		iw.nl()
		writeViewBlock(iw, s.View)
	}

	for _, a := range s.Actions {
		iw.nl()
		writeAction(iw, a)
	}

	iw.depth--
	iw.wl("}")
}

func writeViewBlock(iw *iWriter, v *turnoutpb.ViewBlock) {
	iw.wl("view %q {", v.Name)
	iw.depth++
	flow := strings.TrimRight(v.Flow, "\n")
	if err := writeHeredocField(iw, "flow", flow); err != nil {
		iw.setErr(fmt.Errorf("view %q: %w", v.Name, err))
		iw.depth--
		iw.wl("}")
		return
	}
	if v.Enforce != nil {
		iw.wl("enforce = %q", *v.Enforce)
	}
	iw.depth--
	iw.wl("}")
}

// ─────────────────────────────────────────────────────────────────────────────
// Action block
// ─────────────────────────────────────────────────────────────────────────────

func writeAction(iw *iWriter, a *turnoutpb.ActionModel) {
	iw.wl("action %q {", a.Id)
	iw.depth++

	sep := false

	if a.Text != nil {
		sep = true
		writeText(iw, *a.Text)
	}

	if a.Compute != nil {
		if sep {
			iw.nl()
		}
		sep = true
		writeCompute(iw, a.Compute)
	}

	if len(a.Prepare) > 0 {
		if sep {
			iw.nl()
		}
		sep = true
		writePrepare(iw, a.Prepare)
	}

	if len(a.Merge) > 0 {
		if sep {
			iw.nl()
		}
		sep = true
		writeMerge(iw, a.Merge)
	}

	if len(a.Publish) > 0 {
		if sep {
			iw.nl()
		}
		sep = true
		writePublish(iw, a.Publish)
	}

	for _, nr := range a.Next {
		if sep {
			iw.nl()
		}
		sep = true
		writeNextRule(iw, nr)
	}

	iw.depth--
	iw.wl("}")
}

// chooseHeredocDelim picks a safe closing delimiter for a <<- heredoc whose
// content lines will be prefixed with indent. Uses a two-phase approach:
// Phase 1 checks "EOT" with a linear scan (no allocation) since it almost
// never collides. Phase 2 builds a line-set only when the common case fails,
// then checks the remaining candidates and a hash-based fallback.
// Returns an error only if no non-colliding delimiter can be found.
func chooseHeredocDelim(text, indent string) (string, error) {
	eotMarker := indent + "EOT"
	for line := range strings.SplitSeq(text, "\n") {
		if indent+line == eotMarker {
			goto slowPath
		}
	}
	return "EOT", nil

slowPath:
	lines := strings.Split(text, "\n")
	lineSet := make(map[string]bool, len(lines))
	for _, l := range lines {
		lineSet[indent+l] = true
	}
	collides := func(delim string) bool { return lineSet[indent+delim] }

	for _, delim := range []string{"TURN_EOT", "TURN_EOT_1", "TURN_EOT_2"} {
		if !collides(delim) {
			return delim, nil
		}
	}

	// Hash fallback for adversarial content that contains all four candidates.
	hfn := fnv.New32a()
	_, _ = hfn.Write([]byte(text))
	h := hfn.Sum32()
	const maxFallbackAttempts = 100
	for extra := uint32(0); extra < maxFallbackAttempts; extra++ {
		delim := fmt.Sprintf("TURN_EOT_%08x", h^extra)
		if !collides(delim) {
			return delim, nil
		}
	}
	return "", fmt.Errorf("chooseHeredocDelim: failed to find a non-colliding delimiter after %d attempts", maxFallbackAttempts)
}

// writeText emits:
//
//	text = <<-<delim>
//	<content lines at current indentation>
//	<delim>
//
// With <<-, HCL strips leading whitespace equal to the closing marker's
// indentation. Since both content lines and the closing delimiter are at
// iw.tabs(), the strip amount equals iw.tabs(), leaving the original text
// string intact. The delimiter is chosen to avoid collision with any content line.
func writeText(iw *iWriter, text string) {
	if err := writeHeredocField(iw, "text", text); err != nil {
		iw.setErr(fmt.Errorf("text field: %w", err))
	}
}

// writeHeredocField writes a <<- heredoc assignment for the named field at the
// current indentation level. The content is written verbatim; the delimiter is
// chosen automatically to avoid collisions with any content line.
// Returns a non-nil error only if no safe delimiter can be found or an IO error
// is already recorded on iw.
func writeHeredocField(iw *iWriter, fieldName, content string) error {
	if iw.err != nil {
		return iw.err
	}
	ind := iw.tabs()
	delim, err := chooseHeredocDelim(content, ind)
	if err != nil {
		return err
	}
	if _, iw.err = fmt.Fprintf(iw.out, "%s%s = <<-%s\n", ind, fieldName, delim); iw.err != nil {
		return iw.err
	}
	for _, l := range strings.Split(content, "\n") {
		if iw.err != nil {
			return iw.err
		}
		_, iw.err = fmt.Fprintf(iw.out, "%s%s\n", ind, l)
	}
	if iw.err != nil {
		return iw.err
	}
	_, iw.err = fmt.Fprintf(iw.out, "%s%s\n", ind, delim)
	return iw.err
}

// ─────────────────────────────────────────────────────────────────────────────
// Compute block
// ─────────────────────────────────────────────────────────────────────────────

func writeCompute(iw *iWriter, c *turnoutpb.ComputeModel) {
	iw.wl("compute {")
	iw.depth++
	iw.wl("root = %q", c.Root)
	if c.Prog != nil {
		writeProg(iw, c.Prog)
	}
	iw.depth--
	iw.wl("}")
}

func writeNextCompute(iw *iWriter, c *turnoutpb.NextComputeModel) {
	iw.wl("compute {")
	iw.depth++
	iw.wl("condition = %q", c.Condition)
	if c.Prog != nil {
		writeProg(iw, c.Prog)
	}
	iw.depth--
	iw.wl("}")
}

func writeProg(iw *iWriter, p *turnoutpb.ProgModel) {
	iw.wl("prog %q {", p.Name)
	iw.depth++
	for _, b := range p.Bindings {
		writeBinding(iw, b)
	}
	iw.depth--
	iw.wl("}")
}

func writeBinding(iw *iWriter, b *turnoutpb.BindingModel) {
	iw.wl("binding %q {", b.Name)
	iw.depth++
	iw.wl("type  = %q", b.Type)
	if b.ExtExpr != nil {
		writeExtExpr(iw, b.ExtExpr, b.Type)
		iw.depth--
		iw.wl("}")
		return
	}
	if b.Value != nil {
		iw.wl("value = %s", writeStructpbValue(b.Value))
	} else if b.Expr != nil {
		writeExpr(iw, b.Expr)
	}
	iw.depth--
	iw.wl("}")
}

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
// Prepare / Merge / Publish
// ─────────────────────────────────────────────────────────────────────────────

func writePrepare(iw *iWriter, entries []*turnoutpb.PrepareEntry) {
	iw.wl("prepare {")
	iw.depth++
	for _, e := range entries {
		iw.wl("binding %q {", e.Binding)
		iw.depth++
		if e.FromState != nil {
			iw.wl("from_state = %q", *e.FromState)
		} else if e.FromHook != nil {
			iw.wl("from_hook  = %q", *e.FromHook)
		}
		iw.depth--
		iw.wl("}")
	}
	iw.depth--
	iw.wl("}")
}

func writeMerge(iw *iWriter, entries []*turnoutpb.MergeEntry) {
	iw.wl("merge {")
	iw.depth++
	for _, e := range entries {
		iw.wl("binding %q {", e.Binding)
		iw.depth++
		iw.wl("to_state = %q", e.ToState)
		iw.depth--
		iw.wl("}")
	}
	iw.depth--
	iw.wl("}")
}

func writePublish(iw *iWriter, hooks []string) {
	quoted := make([]string, len(hooks))
	for i, h := range hooks {
		quoted[i] = fmt.Sprintf("%q", h)
	}
	iw.wl("publish = [%s]", strings.Join(quoted, ", "))
}

// ─────────────────────────────────────────────────────────────────────────────
// Next rule
// ─────────────────────────────────────────────────────────────────────────────

func writeNextRule(iw *iWriter, nr *turnoutpb.NextRuleModel) {
	iw.wl("next {")
	iw.depth++

	sep := false

	if nr.Compute != nil {
		sep = true
		writeNextCompute(iw, nr.Compute)
	}

	if len(nr.Prepare) > 0 {
		if sep {
			iw.nl()
		}
		sep = true
		writeNextPrepare(iw, nr.Prepare)
	}

	if sep {
		iw.nl()
	}
	iw.wl("action = %q", nr.Action)

	iw.depth--
	iw.wl("}")
}

func writeNextPrepare(iw *iWriter, entries []*turnoutpb.NextPrepareEntry) {
	iw.wl("prepare {")
	iw.depth++
	for _, e := range entries {
		iw.wl("binding %q {", e.Binding)
		iw.depth++
		if e.FromAction != nil {
			iw.wl("from_action  = %q", *e.FromAction)
		} else if e.FromState != nil {
			iw.wl("from_state   = %q", *e.FromState)
		} else if e.FromLiteral != nil {
			iw.wl("from_literal = %s", writeStructpbValue(e.FromLiteral))
		}
		iw.depth--
		iw.wl("}")
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
//   - NumberValue: bare number, no trailing ".0" for integers
//   - StringValue: double-quoted, with Go's %q escaping
//   - BoolValue: true / false
//   - ListValue: [] or [v1, v2, ...] (all on one line)
func writeStructpbValue(v *structpb.Value) string {
	if v == nil {
		return "null"
	}
	switch k := v.Kind.(type) {
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
	return "null"
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Route block
// ─────────────────────────────────────────────────────────────────────────────

// writeRouteBlock emits:
//
//	route "<id>" {
//	  match {
//	    arm {
//	      patterns = ["pat1", "pat2"]
//	      target   = "scene_id"
//	    }
//	    ...
//	  }
//	}
func writeRouteBlock(iw *iWriter, r *turnoutpb.RouteModel) {
	iw.wl("route %q {", r.Id)
	iw.depth++
	if r.EntrySceneId != nil {
		iw.wl("entry_scene_id = %q", *r.EntrySceneId)
	}
	iw.wl("match {")
	iw.depth++
	for _, arm := range r.Match {
		iw.wl("arm {")
		iw.depth++
		// patterns = ["p1", "p2"]
		quoted := make([]string, len(arm.Patterns))
		for i, p := range arm.Patterns {
			quoted[i] = fmt.Sprintf("%q", p)
		}
		iw.wl("patterns = [%s]", strings.Join(quoted, ", "))
		iw.wl("target   = %q", arm.Target)
		iw.depth--
		iw.wl("}")
	}
	iw.depth--
	iw.wl("}")
	iw.depth--
	iw.wl("}")
}

// Package emit writes canonical plain HCL from the validated proto model.
// All structural and type errors must be caught before calling Emit; no DSL
// validation is performed here. IO errors from the writer are not surfaced as
// diagnostics — callers should detect truncated output via the writer itself.
package emit

import (
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/lower"
	"google.golang.org/protobuf/types/known/structpb"
)

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

// Emit writes canonical plain HCL to w from the validated proto model.
// sc carries HCL-only metadata (action text); it may be nil.
func Emit(w io.Writer, tm *turnoutpb.TurnModel, sc *lower.Sidecar) diag.Diagnostics {
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
		writeSceneBlock(iw, s, sc)
		sep = true
	}
	for _, r := range tm.Routes {
		if sep {
			iw.nl()
		}
		writeRouteBlock(iw, r)
		sep = true
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
// iWriter — indented line writer
// ─────────────────────────────────────────────────────────────────────────────

type iWriter struct {
	out   io.Writer
	depth int
}

// wl writes one line at current indentation followed by a newline.
func (iw *iWriter) wl(format string, args ...interface{}) {
	fmt.Fprintf(iw.out, iw.tabs()+format+"\n", args...)
}

// nl writes a blank line (no content, no indentation).
func (iw *iWriter) nl() {
	fmt.Fprintln(iw.out)
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

func writeSceneBlock(iw *iWriter, s *turnoutpb.SceneBlock, sc *lower.Sidecar) {
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

	for _, a := range s.Actions {
		iw.nl()
		writeAction(iw, a, s.Id, sc)
	}

	iw.depth--
	iw.wl("}")
}

// ─────────────────────────────────────────────────────────────────────────────
// Action block
// ─────────────────────────────────────────────────────────────────────────────

func writeAction(iw *iWriter, a *turnoutpb.ActionModel, sceneID string, sc *lower.Sidecar) {
	iw.wl("action %q {", a.Id)
	iw.depth++

	sep := false

	if sc != nil {
		if meta, ok := sc.Actions[sceneID+"/"+a.Id]; ok && meta.Text != nil {
			sep = true
			writeText(iw, *meta.Text)
		}
	}

	if a.Compute != nil {
		if sep {
			iw.nl()
		}
		sep = true
		writeCompute(iw, a.Compute, sceneID, a.Id, sc)
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
		writeNextRule(iw, nr, sceneID, a.Id, sc)
	}

	iw.depth--
	iw.wl("}")
}

// writeText emits:
//
//	text = <<-EOT
//	<content lines at current indentation>
//	EOT
//
// With <<-, HCL strips leading whitespace equal to the closing marker's
// indentation. Since both content lines and EOT are at iw.tabs(), the strip
// amount equals iw.tabs(), leaving the original text string intact.
func writeText(iw *iWriter, text string) {
	ind := iw.tabs()
	fmt.Fprintf(iw.out, "%stext = <<-EOT\n", ind)
	for _, l := range strings.Split(text, "\n") {
		fmt.Fprintf(iw.out, "%s%s\n", ind, l)
	}
	fmt.Fprintf(iw.out, "%sEOT\n", ind)
}

// ─────────────────────────────────────────────────────────────────────────────
// Compute block
// ─────────────────────────────────────────────────────────────────────────────

func writeCompute(iw *iWriter, c *turnoutpb.ComputeModel, sceneID, actionID string, sc *lower.Sidecar) {
	iw.wl("compute {")
	iw.depth++
	iw.wl("root = %q", c.Root)
	if c.Prog != nil {
		writeProg(iw, c.Prog, sceneID, actionID, sc)
	}
	iw.depth--
	iw.wl("}")
}

func writeNextCompute(iw *iWriter, c *turnoutpb.NextComputeModel, sceneID, actionID string, sc *lower.Sidecar) {
	iw.wl("compute {")
	iw.depth++
	iw.wl("condition = %q", c.Condition)
	if c.Prog != nil {
		writeProg(iw, c.Prog, sceneID, actionID, sc)
	}
	iw.depth--
	iw.wl("}")
}

func writeProg(iw *iWriter, p *turnoutpb.ProgModel, sceneID, actionID string, sc *lower.Sidecar) {
	iw.wl("prog %q {", p.Name)
	iw.depth++
	for _, b := range p.Bindings {
		writeBinding(iw, b, sceneID, actionID, p.Name, sc)
	}
	iw.depth--
	iw.wl("}")
}

func writeBinding(iw *iWriter, b *turnoutpb.BindingModel, sceneID, actionID, progName string, sc *lower.Sidecar) {
	iw.wl("binding %q {", b.Name)
	iw.depth++
	iw.wl("type  = %q", b.Type)
	if sc != nil {
		key := lower.BindingKey{SceneID: sceneID, ActionID: actionID, ProgName: progName, BindingName: b.Name}
		if extRHS, ok := sc.ExtExprs[key]; ok {
			writeExtExpr(iw, extRHS)
			iw.depth--
			iw.wl("}")
			return
		}
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

func writeNextRule(iw *iWriter, nr *turnoutpb.NextRuleModel, sceneID, actionID string, sc *lower.Sidecar) {
	iw.wl("next {")
	iw.depth++

	sep := false

	if nr.Compute != nil {
		sep = true
		writeNextCompute(iw, nr.Compute, sceneID, actionID, sc)
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
// Extended expression emitters (if / case / pipe stored in sidecar ExtExprs)
// ─────────────────────────────────────────────────────────────────────────────

// writeExtExpr writes `expr  = { if/case/pipe = { ... } }` for a sidecar RHS.
func writeExtExpr(iw *iWriter, rhs ast.BindingRHS) {
	iw.wl("expr  = {")
	iw.depth++
	switch r := rhs.(type) {
	case *ast.IfCallRHS:
		iw.wl("if = {")
		iw.depth++
		iw.wl("cond = %s", localExprInline(r.Cond))
		iw.wl("then = %s", localExprInline(r.Then))
		iw.wl("else = %s", localExprInline(r.Else))
		iw.depth--
		iw.wl("}")
	case *ast.CaseCallRHS:
		iw.wl("case = {")
		iw.depth++
		iw.wl("subject = %s", localExprInline(r.Subject))
		arms := make([]string, len(r.Arms))
		for i, arm := range r.Arms {
			arms[i] = localCaseArmInline(arm)
		}
		iw.wl("arms    = [%s]", strings.Join(arms, ", "))
		iw.depth--
		iw.wl("}")
	case *ast.PipeCallRHS:
		iw.wl("pipe = {")
		iw.depth++
		iw.wl("initial = %s", localExprInline(r.Initial))
		steps := make([]string, len(r.Steps))
		for i, s := range r.Steps {
			steps[i] = localExprInline(s)
		}
		iw.wl("steps   = [%s]", strings.Join(steps, ", "))
		iw.depth--
		iw.wl("}")
	}
	iw.depth--
	iw.wl("}")
}

// localExprInline returns the inline HCL representation of a LocalExpr node.
func localExprInline(e ast.LocalExpr) string {
	if e == nil {
		return `{ ref = "__nil__" }`
	}
	switch x := e.(type) {
	case *ast.LocalRefExpr:
		return fmt.Sprintf(`{ ref = %q }`, x.Name)
	case *ast.LocalLitExpr:
		return fmt.Sprintf(`{ lit = %s }`, localLitToHCL(x.Value))
	case *ast.LocalItExpr:
		return `{ it = true }`
	case *ast.LocalCallExpr:
		args := make([]string, len(x.Args))
		for i, a := range x.Args {
			args[i] = localExprInline(a)
		}
		return fmt.Sprintf(`{ combine = { fn = %q, args = [%s] } }`, x.FnAlias, strings.Join(args, ", "))
	case *ast.LocalInfixExpr:
		fn := x.Op.FnAlias()
		if fn == "" {
			fn = "add" // InfixPlus default; type dispatch happens at runtime
		}
		return fmt.Sprintf(`{ combine = { fn = %q, args = [%s, %s] } }`, fn, localExprInline(x.LHS), localExprInline(x.RHS))
	case *ast.LocalIfExpr:
		return fmt.Sprintf(`{ if = { cond = %s, then = %s, else = %s } }`,
			localExprInline(x.Cond), localExprInline(x.Then), localExprInline(x.Else))
	case *ast.LocalCaseExpr:
		arms := make([]string, len(x.Arms))
		for i, arm := range x.Arms {
			arms[i] = localCaseArmInline(arm)
		}
		return fmt.Sprintf(`{ case = { subject = %s, arms = [%s] } }`,
			localExprInline(x.Subject), strings.Join(arms, ", "))
	case *ast.LocalPipeExpr:
		steps := make([]string, len(x.Steps))
		for i, s := range x.Steps {
			steps[i] = localExprInline(s)
		}
		return fmt.Sprintf(`{ pipe = { initial = %s, steps = [%s] } }`,
			localExprInline(x.Initial), strings.Join(steps, ", "))
	}
	return `{ ref = "__unknown__" }`
}

func localCaseArmInline(arm ast.LocalCaseArm) string {
	s := fmt.Sprintf(`{ pattern = %s`, localPatternInline(arm.Pattern))
	if arm.Guard != nil {
		s += fmt.Sprintf(`, guard = %s`, localExprInline(arm.Guard))
	}
	s += fmt.Sprintf(`, expr = %s }`, localExprInline(arm.Expr))
	return s
}

func localPatternInline(p ast.LocalCasePattern) string {
	if p == nil {
		return `{ wildcard = true }`
	}
	switch x := p.(type) {
	case *ast.WildcardCasePattern:
		return `{ wildcard = true }`
	case *ast.LiteralCasePattern:
		return fmt.Sprintf(`{ lit = %s }`, localLitToHCL(x.Value))
	case *ast.VarBinderPattern:
		return fmt.Sprintf(`{ bind = %q }`, x.Name)
	case *ast.TupleCasePattern:
		elems := make([]string, len(x.Elems))
		for i, e := range x.Elems {
			elems[i] = localPatternInline(e)
		}
		return fmt.Sprintf(`{ tuple = [%s] }`, strings.Join(elems, ", "))
	}
	return `{ wildcard = true }`
}

// localLitToHCL converts an ast.Literal to its HCL text representation.
func localLitToHCL(lit ast.Literal) string {
	if lit == nil {
		return "null"
	}
	switch v := lit.(type) {
	case *ast.NumberLiteral:
		return strconv.FormatFloat(v.Value, 'f', -1, 64)
	case *ast.StringLiteral:
		return fmt.Sprintf("%q", v.Value)
	case *ast.BoolLiteral:
		if v.Value {
			return "true"
		}
		return "false"
	case *ast.ArrayLiteral:
		parts := make([]string, len(v.Elements))
		for i, e := range v.Elements {
			parts[i] = localLitToHCL(e)
		}
		return "[" + strings.Join(parts, ", ") + "]"
	}
	return "null"
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

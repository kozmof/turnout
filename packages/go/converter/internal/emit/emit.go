// Package emit writes canonical plain HCL from the validated lowered Model.
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
	"github.com/kozmof/turnout/packages/go/converter/internal/lower"
)

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

// Emit writes canonical plain HCL to w from the validated lowered Model.
func Emit(w io.Writer, model *lower.Model) diag.Diagnostics {
	if model == nil {
		return nil
	}
	iw := &iWriter{out: w}
	sep := false
	if model.State != nil {
		writeStateBlock(iw, model.State)
		sep = true
	}
	for _, s := range model.Scenes {
		if sep {
			iw.nl()
		}
		writeSceneBlock(iw, s)
		sep = true
	}
	for _, r := range model.Routes {
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

func writeStateBlock(iw *iWriter, s *lower.HCLStateBlock) {
	iw.wl("state {")
	iw.depth++
	for _, ns := range s.Namespaces {
		iw.wl("namespace %q {", ns.Name)
		iw.depth++
		for _, f := range ns.Fields {
			iw.wl("field %q {", f.Name)
			iw.depth++
			iw.wl("type  = %q", f.Type.String())
			iw.wl("value = %s", writeLiteral(f.Default))
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

func writeSceneBlock(iw *iWriter, s *lower.HCLSceneBlock) {
	iw.wl("scene %q {", s.ID)
	iw.depth++

	// entry_actions = ["a", "b"]
	ea := make([]string, len(s.EntryActions))
	for i, a := range s.EntryActions {
		ea[i] = fmt.Sprintf("%q", a)
	}
	iw.wl("entry_actions = [%s]", strings.Join(ea, ", "))

	// next_policy = "..." (omit if empty)
	if s.NextPolicy != "" {
		iw.wl("next_policy   = %q", s.NextPolicy)
	}

	for _, a := range s.Actions {
		iw.nl()
		writeAction(iw, a)
	}

	iw.depth--
	iw.wl("}")
}

// ─────────────────────────────────────────────────────────────────────────────
// Action block
// ─────────────────────────────────────────────────────────────────────────────

func writeAction(iw *iWriter, a *lower.HCLAction) {
	iw.wl("action %q {", a.ID)
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

	if a.Prepare != nil {
		if sep {
			iw.nl()
		}
		sep = true
		writePrepare(iw, a.Prepare)
	}

	if a.Merge != nil {
		if sep {
			iw.nl()
		}
		sep = true
		writeMerge(iw, a.Merge)
	}

	if a.Publish != nil {
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

func writeCompute(iw *iWriter, c *lower.HCLCompute) {
	iw.wl("compute {")
	iw.depth++
	iw.wl("root = %q", c.Root)
	if c.Prog != nil {
		writeProg(iw, c.Prog)
	}
	iw.depth--
	iw.wl("}")
}

func writeNextCompute(iw *iWriter, c *lower.HCLNextCompute) {
	iw.wl("compute {")
	iw.depth++
	iw.wl("condition = %q", c.Condition)
	if c.Prog != nil {
		writeProg(iw, c.Prog)
	}
	iw.depth--
	iw.wl("}")
}

func writeProg(iw *iWriter, p *lower.HCLProg) {
	iw.wl("prog %q {", p.Name)
	iw.depth++
	for _, b := range p.Bindings {
		writeBinding(iw, b)
	}
	iw.depth--
	iw.wl("}")
}

func writeBinding(iw *iWriter, b *lower.HCLBinding) {
	iw.wl("binding %q {", b.Name)
	iw.depth++
	iw.wl("type  = %q", b.Type.String())
	if b.Value != nil {
		iw.wl("value = %s", writeLiteral(b.Value))
	} else if b.Expr != nil {
		writeExpr(iw, b.Expr)
	}
	iw.depth--
	iw.wl("}")
}

// ─────────────────────────────────────────────────────────────────────────────
// Expr block (combine / pipe / cond)
// ─────────────────────────────────────────────────────────────────────────────

func writeExpr(iw *iWriter, expr *lower.HCLExpr) {
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

func writeCombine(iw *iWriter, c *lower.HCLCombine) {
	iw.wl("combine = {")
	iw.depth++
	iw.wl("fn   = %q", c.Fn)
	iw.wl("args = %s", writeArgs(c.Args))
	iw.depth--
	iw.wl("}")
}

func writePipe(iw *iWriter, p *lower.HCLPipe) {
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

func writeCond(iw *iWriter, c *lower.HCLCond) {
	iw.wl("cond = {")
	iw.depth++
	if c.Condition != nil {
		iw.wl("condition = %s", writeArg(c.Condition))
	}
	if c.Then != nil {
		iw.wl("then      = %s", writeArg(c.Then))
	}
	if c.Else != nil {
		iw.wl("else      = %s", writeArg(c.Else))
	}
	iw.depth--
	iw.wl("}")
}

// ─────────────────────────────────────────────────────────────────────────────
// Prepare / Merge / Publish
// ─────────────────────────────────────────────────────────────────────────────

func writePrepare(iw *iWriter, p *lower.HCLPrepare) {
	iw.wl("prepare {")
	iw.depth++
	for _, e := range p.Entries {
		iw.wl("binding %q {", e.BindingName)
		iw.depth++
		if e.FromState != "" {
			iw.wl("from_state = %q", e.FromState)
		} else if e.FromHook != "" {
			iw.wl("from_hook  = %q", e.FromHook)
		}
		iw.depth--
		iw.wl("}")
	}
	iw.depth--
	iw.wl("}")
}

func writeMerge(iw *iWriter, m *lower.HCLMerge) {
	iw.wl("merge {")
	iw.depth++
	for _, e := range m.Entries {
		iw.wl("binding %q {", e.BindingName)
		iw.depth++
		iw.wl("to_state = %q", e.ToState)
		iw.depth--
		iw.wl("}")
	}
	iw.depth--
	iw.wl("}")
}

func writePublish(iw *iWriter, p *lower.HCLPublish) {
	// Emit as a list attribute so the HCL is round-trip parseable.
	// A repeated `hook = "..."` block attribute would be a duplicate-key error.
	quoted := make([]string, len(p.Hooks))
	for i, h := range p.Hooks {
		quoted[i] = fmt.Sprintf("%q", h)
	}
	iw.wl("publish = [%s]", strings.Join(quoted, ", "))
}

// ─────────────────────────────────────────────────────────────────────────────
// Next rule
// ─────────────────────────────────────────────────────────────────────────────

func writeNextRule(iw *iWriter, nr *lower.HCLNextRule) {
	iw.wl("next {")
	iw.depth++

	sep := false

	if nr.Compute != nil {
		sep = true
		writeNextCompute(iw, nr.Compute)
	}

	if nr.Prepare != nil {
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

func writeNextPrepare(iw *iWriter, p *lower.HCLNextPrepare) {
	iw.wl("prepare {")
	iw.depth++
	for _, e := range p.Entries {
		iw.wl("binding %q {", e.BindingName)
		iw.depth++
		if e.FromAction != "" {
			iw.wl("from_action  = %q", e.FromAction)
		} else if e.FromState != "" {
			iw.wl("from_state   = %q", e.FromState)
		} else if e.FromLiteral != nil {
			iw.wl("from_literal = %s", writeLiteral(e.FromLiteral))
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
func writeArg(arg *lower.HCLArg) string {
	switch {
	case arg.Ref != "":
		return fmt.Sprintf(`{ ref = %q }`, arg.Ref)
	case arg.Lit != nil:
		return fmt.Sprintf(`{ lit = %s }`, writeLiteral(arg.Lit))
	case arg.FuncRef != "":
		return fmt.Sprintf(`{ func_ref = %q }`, arg.FuncRef)
	case arg.IsStepRef:
		return fmt.Sprintf(`{ step_ref = %d }`, arg.StepRef)
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
func writeArgs(args []*lower.HCLArg) string {
	if len(args) == 0 {
		return "[]"
	}
	parts := make([]string, len(args))
	for i, a := range args {
		parts[i] = writeArg(a)
	}
	return "[" + strings.Join(parts, ", ") + "]"
}

// writeLiteral returns the HCL text representation of a Literal value.
//   - NumberLiteral: bare number, no trailing ".0" for integers
//   - StringLiteral: double-quoted, with Go's %q escaping
//   - BoolLiteral: true / false
//   - ArrayLiteral: [] or [v1, v2, ...] (all on one line)
func writeLiteral(lit ast.Literal) string {
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
		if len(v.Elements) == 0 {
			return "[]"
		}
		parts := make([]string, len(v.Elements))
		for i, e := range v.Elements {
			parts[i] = writeLiteral(e)
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
func writeRouteBlock(iw *iWriter, r *lower.HCLRouteBlock) {
	iw.wl("route %q {", r.ID)
	iw.depth++
	iw.wl("match {")
	iw.depth++
	for _, arm := range r.Arms {
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

// Package emit writes canonical plain HCL from the validated proto model.
// All structural and type errors must be caught before calling Emit; no DSL
// validation is performed here.
package emit

import (
	"fmt"
	"hash/fnv"
	"io"
	"strings"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
)

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

// Emit writes canonical plain HCL to w from the validated proto model.
// Returns a diagnostic if an IO error occurs during writing, or if an internal
// compiler bug is detected during emission (e.g. an unexpected structpb kind).
func Emit(w io.Writer, tm *turnoutpb.TurnModel) (ds diag.Diagnostics) {
	defer func() {
		if r := recover(); r != nil {
			ds = diag.Diagnostics{diag.Errorf(diag.CodeInternalError,
				"emit internal error: %v — this is a compiler bug; please report the source file", r)}
		}
	}()
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

// eotCollides reports whether "EOT" would collide with any indented content line.
// Used by chooseHeredocDelim's fast path to avoid allocation when EOT is safe.
func eotCollides(text, indent string) bool {
	marker := indent + "EOT"
	for line := range strings.SplitSeq(text, "\n") {
		if indent+line == marker {
			return true
		}
	}
	return false
}

// chooseHeredocDelim picks a safe closing delimiter for a <<- heredoc whose
// content lines will be prefixed with indent. Uses a two-phase approach:
// Phase 1 checks "EOT" with a linear scan (no allocation) since it almost
// never collides. Phase 2 builds a line-set only when the common case fails,
// then checks the remaining candidates and a hash-based fallback.
// Returns an error only if no non-colliding delimiter can be found.
func chooseHeredocDelim(text, indent string) (string, error) {
	if !eotCollides(text, indent) {
		return "EOT", nil
	}

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

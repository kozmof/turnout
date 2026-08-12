// lower_inline_io.go folds inline IO clauses into the prepare / merge blocks.
package lower

import (
	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
)

// hoistInlineIO rewrites an action so that inline IO (NEW_SYNTAX.md 3) is
// indistinguishable from the block form by the time anything else looks at it.
//
// `camera_online:bool <~ @crime_scene.camera_online` becomes a prepare entry,
// and `phase:str = "scan" ~> @investigation.phase` becomes a merge entry. The
// binding's Sigil was already set by the parser, so the existing prepare/merge
// validation applies unchanged to both spellings.
//
// A binding may use one spelling or the other, never both: naming the same
// binding inline and in a block is reported rather than silently merged, because
// the two could disagree about the destination.
func hoistInlineIO(a *ast.ActionBlock, ds *diag.DiagSink) {
	if a.Compute != nil && a.Compute.Prog != nil {
		for _, b := range a.Compute.Prog.Bindings {
			hoistActionIngress(a, b, ds)
			hoistEgress(a, b, ds)
		}
		// With the prefix sigils retired, a binding written in the block form
		// carries no sigil of its own: the prepare / merge entry naming it is
		// what makes it ingress or egress. Derive it here so both spellings
		// reach the rest of the pipeline identically.
		deriveSigilsFromBlocks(a)
	}
	for _, nr := range a.Next {
		if nr.Compute == nil || nr.Compute.Prog == nil {
			continue
		}
		for _, b := range nr.Compute.Prog.Bindings {
			hoistNextIngress(nr, b, ds)
			if b.Egress != nil {
				// merge is not legal inside a transition, and the parser already
				// rejects a `merge` block there; keep the inline form consistent.
				ds.Append(diag.ErrorAt(b.Egress.Pos.File, b.Egress.Pos.Line, b.Egress.Pos.Col,
					diag.CodeTransitionOutputSigil,
					"binding %q: `~>` writes to STATE, which is not allowed inside a transition compute", b.Name))
			}
		}
	}
}

// duplicateInline reports a binding that carries both inline and block IO.
func duplicateInline(name, kind string, pos ast.Pos, ds *diag.DiagSink) {
	ds.Append(diag.ErrorAt(pos.File, pos.Line, pos.Col, diag.CodeDuplicateInlineIO,
		"binding %q declares its %s inline and in a %s block; use one or the other", name, kind, kind))
}

func hoistActionIngress(a *ast.ActionBlock, b *ast.BindingDecl, ds *diag.DiagSink) {
	if b.Ingress == nil {
		return
	}
	if a.Prepare != nil {
		for _, e := range a.Prepare.Entries {
			if e.BindingName == b.Name {
				duplicateInline(b.Name, "input", b.Pos, ds)
				return
			}
		}
	}
	var src ast.ActionPrepareSource
	switch in := b.Ingress.(type) {
	case *ast.IngressState:
		src = &ast.FromState{Pos: in.Pos, Path: in.Path}
	case *ast.IngressHook:
		src = &ast.FromHook{Pos: in.Pos, HookName: in.HookName}
	default:
		// action() and literal ingress are rejected by the parser in this
		// context; nothing valid remains to hoist.
		return
	}
	if a.Prepare == nil {
		a.Prepare = &ast.PrepareBlock{Pos: b.Pos}
	}
	a.Prepare.Entries = append(a.Prepare.Entries, &ast.PrepareEntry{
		Pos: b.Pos, BindingName: b.Name, Source: src,
	})
}

func hoistNextIngress(nr *ast.NextRule, b *ast.BindingDecl, ds *diag.DiagSink) {
	if b.Ingress == nil {
		return
	}
	if nr.Prepare != nil {
		for _, e := range nr.Prepare.Entries {
			if e.BindingName == b.Name {
				duplicateInline(b.Name, "input", b.Pos, ds)
				return
			}
		}
	}
	var src ast.NextPrepareSource
	switch in := b.Ingress.(type) {
	case *ast.IngressState:
		src = &ast.FromState{Pos: in.Pos, Path: in.Path}
	case *ast.IngressAction:
		src = &ast.FromAction{Pos: in.Pos, BindingName: in.BindingName}
	case *ast.IngressLiteral:
		src = &ast.FromLiteral{Pos: in.Pos, Value: in.Value}
	default:
		// hook() is rejected by the parser in this context.
		return
	}
	if nr.Prepare == nil {
		nr.Prepare = &ast.NextPrepareBlock{Pos: b.Pos}
	}
	nr.Prepare.Entries = append(nr.Prepare.Entries, &ast.NextPrepareEntry{
		Pos: b.Pos, BindingName: b.Name, Source: src,
	})
}

func hoistEgress(a *ast.ActionBlock, b *ast.BindingDecl, ds *diag.DiagSink) {
	if b.Egress == nil {
		return
	}
	if a.Merge != nil {
		for _, e := range a.Merge.Entries {
			if e.BindingName == b.Name {
				duplicateInline(b.Name, "output", b.Pos, ds)
				return
			}
		}
	}
	if a.Merge == nil {
		a.Merge = &ast.MergeBlock{Pos: b.Pos}
	}
	a.Merge.Entries = append(a.Merge.Entries, &ast.MergeEntry{
		Pos: b.Pos, BindingName: b.Name, ToState: b.Egress.Path,
	})
}

// deriveSigilsFromBlocks marks each prog binding named by a prepare or merge
// entry with the corresponding sigil. Inline IO already set the sigil on the
// bindings that use it, so this only fills in the block-form bindings.
func deriveSigilsFromBlocks(a *ast.ActionBlock) {
	byName := make(map[string]*ast.BindingDecl, len(a.Compute.Prog.Bindings))
	for _, b := range a.Compute.Prog.Bindings {
		byName[b.Name] = b
	}
	if a.Prepare != nil {
		for _, e := range a.Prepare.Entries {
			b, ok := byName[e.BindingName]
			if !ok {
				continue
			}
			// Only an input declaration takes its value from prepare. A binding
			// that computes its own value must not also be fed from STATE — that
			// is still a spurious prepare entry, so leave it unmarked and let the
			// existing check report it.
			if _, isInput := b.RHS.(*ast.SigilInputRHS); !isInput {
				continue
			}
			b.Sigil = addIngress(b.Sigil)
		}
	}
	if a.Merge != nil {
		for _, e := range a.Merge.Entries {
			if b, ok := byName[e.BindingName]; ok {
				b.Sigil = addEgress(b.Sigil)
			}
		}
	}
}

func addIngress(s ast.Sigil) ast.Sigil {
	if s == ast.SigilEgress || s == ast.SigilBiDir {
		return ast.SigilBiDir
	}
	return ast.SigilIngress
}

func addEgress(s ast.Sigil) ast.Sigil {
	if s == ast.SigilIngress || s == ast.SigilBiDir {
		return ast.SigilBiDir
	}
	return ast.SigilEgress
}

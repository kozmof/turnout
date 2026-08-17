// lower_inline_io.go folds inline IO clauses into the prepare / merge blocks.
package lower

import (
	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
)

// hoistInlineIO rewrites an action so that its inline IO clauses (NEW_SYNTAX.md
// 3) become the prepare / merge entries the canonical model carries.
//
// `camera_online:bool <~ @crime_scene.camera_online` becomes a prepare entry,
// and `phase:str = ("scan") ~> @investigation.phase` becomes a merge entry. The
// blocks exist only from here on: they are the wire shape the runtime reads, not
// something an author writes, so every entry is generated from one binding and
// carries that binding's name and position.
func hoistInlineIO(a *ast.ActionBlock, ds *diag.DiagSink) {
	if a.Compute != nil && a.Compute.Prog != nil {
		for _, b := range a.Compute.Prog.Bindings {
			hoistActionIngress(a, b)
			hoistEgress(a, b)
		}
	}
	for _, nr := range a.Next {
		if nr.Compute == nil || nr.Compute.Prog == nil {
			continue
		}
		for _, b := range nr.Compute.Prog.Bindings {
			hoistNextIngress(nr, b)
			if b.Egress != nil {
				// A transition selects an action; it never writes to STATE. The
				// inline clause is caught here, at the binding that carries it.
				ds.Append(diag.ErrorAt(b.Egress.Pos.File, b.Egress.Pos.Line, b.Egress.Pos.Col,
					diag.CodeTransitionOutputSigil,
					"binding %q: `~>` writes to STATE, which is not allowed inside a transition compute", b.Name))
			}
		}
	}
}

func hoistActionIngress(a *ast.ActionBlock, b *ast.BindingDecl) {
	if b.Ingress == nil {
		return
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

func hoistNextIngress(nr *ast.NextRule, b *ast.BindingDecl) {
	if b.Ingress == nil {
		return
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

func hoistEgress(a *ast.ActionBlock, b *ast.BindingDecl) {
	if b.Egress == nil {
		return
	}
	if a.Merge == nil {
		a.Merge = &ast.MergeBlock{Pos: b.Pos}
	}
	a.Merge.Entries = append(a.Merge.Entries, &ast.MergeEntry{
		Pos: b.Pos, BindingName: b.Name, ToState: b.Egress.Path,
	})
}

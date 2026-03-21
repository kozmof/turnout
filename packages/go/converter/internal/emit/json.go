package emit

import (
	"bytes"
	"encoding/json"
	"io"

	"github.com/turnout/converter/internal/ast"
	"github.com/turnout/converter/internal/emit/turnoutpb"
	"github.com/turnout/converter/internal/lower"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

//go:generate sh -c "PATH=\"$HOME/go/bin:$(go env GOPATH)/bin:$PATH\" buf generate ../../../../../"

// EmitJSON writes the lowered model as indented protobuf JSON to w.
// The schema is defined in schema/turnout-model.proto (repo root).
// Run `buf generate` from the repo root to regenerate both Go and TypeScript types.
func EmitJSON(w io.Writer, model *lower.Model) error {
	tm := modelToProto(model)
	raw, err := protojson.Marshal(tm)
	if err != nil {
		return err
	}
	// Re-indent for human readability.
	var buf bytes.Buffer
	if err = json.Indent(&buf, raw, "", "  "); err != nil {
		return err
	}
	buf.WriteByte('\n')
	_, err = w.Write(buf.Bytes())
	return err
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversion: lower.Model → turnoutpb.TurnModel
// ─────────────────────────────────────────────────────────────────────────────

func modelToProto(model *lower.Model) *turnoutpb.TurnModel {
	if model == nil {
		return &turnoutpb.TurnModel{}
	}
	tm := &turnoutpb.TurnModel{}
	if model.State != nil {
		tm.State = stateToProto(model.State)
	}
	if model.Scene != nil {
		tm.Scenes = []*turnoutpb.SceneBlock{sceneToProto(model.Scene)}
	}
	for _, r := range model.Routes {
		tm.Routes = append(tm.Routes, routeToProto(r))
	}
	return tm
}

func stateToProto(s *lower.HCLStateBlock) *turnoutpb.StateModel {
	sm := &turnoutpb.StateModel{}
	for _, ns := range s.Namespaces {
		jns := &turnoutpb.NamespaceModel{Name: ns.Name}
		for _, f := range ns.Fields {
			jns.Fields = append(jns.Fields, &turnoutpb.FieldModel{
				Name:  f.Name,
				Type:  f.Type.String(),
				Value: litToProto(f.Default),
			})
		}
		sm.Namespaces = append(sm.Namespaces, jns)
	}
	return sm
}

func sceneToProto(s *lower.HCLSceneBlock) *turnoutpb.SceneBlock {
	sb := &turnoutpb.SceneBlock{
		Id:           s.ID,
		EntryActions: s.EntryActions,
	}
	if s.NextPolicy != "" {
		sb.NextPolicy = proto.String(s.NextPolicy)
	}
	for _, a := range s.Actions {
		sb.Actions = append(sb.Actions, actionToProto(a))
	}
	return sb
}

func actionToProto(a *lower.HCLAction) *turnoutpb.ActionModel {
	am := &turnoutpb.ActionModel{Id: a.ID}
	if a.Compute != nil {
		am.Compute = computeToProto(a.Compute)
	}
	if a.Prepare != nil {
		for _, e := range a.Prepare.Entries {
			am.Prepare = append(am.Prepare, prepareEntryToProto(e))
		}
	}
	if a.Merge != nil {
		for _, e := range a.Merge.Entries {
			am.Merge = append(am.Merge, &turnoutpb.MergeEntry{
				Binding: e.BindingName,
				ToState: e.ToState,
			})
		}
	}
	if a.Publish != nil {
		am.Publish = a.Publish.Hooks
	}
	for _, nr := range a.Next {
		am.Next = append(am.Next, nextRuleToProto(nr))
	}
	return am
}

func prepareEntryToProto(e *lower.HCLPrepareEntry) *turnoutpb.PrepareEntry {
	pe := &turnoutpb.PrepareEntry{Binding: e.BindingName}
	if e.FromState != "" {
		pe.FromState = proto.String(e.FromState)
	} else if e.FromHook != "" {
		pe.FromHook = proto.String(e.FromHook)
	}
	return pe
}

func computeToProto(c *lower.HCLCompute) *turnoutpb.ComputeModel {
	cm := &turnoutpb.ComputeModel{Root: c.Root}
	if c.Prog != nil {
		cm.Prog = progToProto(c.Prog)
	}
	return cm
}

func progToProto(p *lower.HCLProg) *turnoutpb.ProgModel {
	pm := &turnoutpb.ProgModel{Name: p.Name}
	for _, b := range p.Bindings {
		pm.Bindings = append(pm.Bindings, bindingToProto(b))
	}
	return pm
}

func bindingToProto(b *lower.HCLBinding) *turnoutpb.BindingModel {
	bm := &turnoutpb.BindingModel{
		Name: b.Name,
		Type: b.Type.String(),
	}
	if b.Value != nil {
		bm.Value = litToProto(b.Value)
	} else if b.Expr != nil {
		bm.Expr = exprToProto(b.Expr)
	}
	return bm
}

func exprToProto(e *lower.HCLExpr) *turnoutpb.ExprModel {
	em := &turnoutpb.ExprModel{}
	switch {
	case e.Combine != nil:
		c := &turnoutpb.CombineExpr{Fn: e.Combine.Fn}
		for _, a := range e.Combine.Args {
			c.Args = append(c.Args, argToProto(a))
		}
		em.Combine = c
	case e.Pipe != nil:
		p := &turnoutpb.PipeExpr{}
		for _, param := range e.Pipe.Params {
			p.Params = append(p.Params, &turnoutpb.PipeParam{
				ParamName:   param.ParamName,
				SourceIdent: param.SourceIdent,
			})
		}
		for _, step := range e.Pipe.Steps {
			ps := &turnoutpb.PipeStep{Fn: step.Fn}
			for _, a := range step.Args {
				ps.Args = append(ps.Args, argToProto(a))
			}
			p.Steps = append(p.Steps, ps)
		}
		em.Pipe = p
	case e.Cond != nil:
		c := &turnoutpb.CondExpr{}
		if e.Cond.Condition != nil {
			c.Condition = argToProto(e.Cond.Condition)
		}
		if e.Cond.Then != nil {
			c.Then = argToProto(e.Cond.Then)
		}
		if e.Cond.Else != nil {
			c.ElseBranch = argToProto(e.Cond.Else)
		}
		em.Cond = c
	}
	return em
}

func argToProto(a *lower.HCLArg) *turnoutpb.ArgModel {
	am := &turnoutpb.ArgModel{}
	switch {
	case a.Ref != "":
		am.Ref = proto.String(a.Ref)
	case a.Lit != nil:
		am.Lit = litToProto(a.Lit)
	case a.FuncRef != "":
		am.FuncRef = proto.String(a.FuncRef)
	case a.IsStepRef:
		am.StepRef = proto.Int32(int32(a.StepRef))
	case a.Transform != nil:
		am.Transform = &turnoutpb.TransformArg{Ref: a.Transform.Ref, Fn: a.Transform.Fn}
	}
	return am
}

func nextRuleToProto(nr *lower.HCLNextRule) *turnoutpb.NextRuleModel {
	nrm := &turnoutpb.NextRuleModel{Action: nr.Action}
	if nr.Compute != nil {
		nrm.Compute = &turnoutpb.NextComputeModel{
			Condition: nr.Compute.Condition,
			Prog:      progToProto(nr.Compute.Prog),
		}
	}
	if nr.Prepare != nil {
		for _, e := range nr.Prepare.Entries {
			entry := &turnoutpb.NextPrepareEntry{Binding: e.BindingName}
			switch {
			case e.FromAction != "":
				entry.FromAction = proto.String(e.FromAction)
			case e.FromState != "":
				entry.FromState = proto.String(e.FromState)
			case e.FromLiteral != nil:
				entry.FromLiteral = litToProto(e.FromLiteral)
			}
			nrm.Prepare = append(nrm.Prepare, entry)
		}
	}
	return nrm
}

func routeToProto(r *lower.HCLRouteBlock) *turnoutpb.RouteModel {
	rm := &turnoutpb.RouteModel{Id: r.ID}
	for _, arm := range r.Arms {
		rm.Match = append(rm.Match, &turnoutpb.MatchArm{
			Patterns: arm.Patterns,
			Target:   arm.Target,
		})
	}
	return rm
}

// litToProto converts an ast.Literal to a structpb.Value for JSON serialisation.
func litToProto(lit ast.Literal) *structpb.Value {
	if lit == nil {
		return nil
	}
	v, _ := structpb.NewValue(litToNative(lit))
	return v
}

// litToNative converts an ast.Literal to a plain Go value suitable for structpb.NewValue.
func litToNative(lit ast.Literal) interface{} {
	if lit == nil {
		return nil
	}
	switch v := lit.(type) {
	case *ast.NumberLiteral:
		return v.Value
	case *ast.StringLiteral:
		return v.Value
	case *ast.BoolLiteral:
		return v.Value
	case *ast.ArrayLiteral:
		arr := make([]interface{}, len(v.Elements))
		for i, e := range v.Elements {
			arr[i] = litToNative(e)
		}
		return arr
	}
	return nil
}

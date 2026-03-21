package emit

import (
	"encoding/json"
	"io"

	"github.com/turnout/converter/internal/ast"
	"github.com/turnout/converter/internal/lower"
)

// EmitJSON writes the lowered model as indented JSON to w.
// The JSON schema is defined in schema/turnout-model.json (repo root) and
// consumed by the TypeScript scene runner (packages/ts/scene-runner).
// Both this file and packages/ts/scene-runner/src/types/scene-model.ts must
// stay in sync with that schema.
func EmitJSON(w io.Writer, model *lower.Model) error {
	jm := modelToJSON(model)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(jm)
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level JSON types
// ─────────────────────────────────────────────────────────────────────────────

type jsonModel struct {
	State  *jsonState   `json:"state,omitempty"`
	Scenes []*jsonScene `json:"scenes"`
	Routes []*jsonRoute `json:"routes,omitempty"`
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

type jsonState struct {
	Namespaces []*jsonNamespace `json:"namespaces"`
}

type jsonNamespace struct {
	Name   string       `json:"name"`
	Fields []*jsonField `json:"fields"`
}

type jsonField struct {
	Name  string      `json:"name"`
	Type  string      `json:"type"`
	Value interface{} `json:"value"`
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene / Action
// ─────────────────────────────────────────────────────────────────────────────

type jsonScene struct {
	ID           string        `json:"id"`
	EntryActions []string      `json:"entry_actions"`
	NextPolicy   string        `json:"next_policy,omitempty"`
	Actions      []*jsonAction `json:"actions"`
}

type jsonAction struct {
	ID      string               `json:"id"`
	Compute *jsonCompute         `json:"compute,omitempty"`
	Prepare []*jsonPrepareEntry  `json:"prepare,omitempty"`
	Merge   []*jsonMergeEntry    `json:"merge,omitempty"`
	Publish []string             `json:"publish,omitempty"`
	Next    []*jsonNextRule      `json:"next,omitempty"`
}

// ─────────────────────────────────────────────────────────────────────────────
// Compute / Prog / Binding
// ─────────────────────────────────────────────────────────────────────────────

type jsonCompute struct {
	Root string    `json:"root"`
	Prog *jsonProg `json:"prog"`
}

type jsonProg struct {
	Name     string         `json:"name"`
	Bindings []*jsonBinding `json:"bindings"`
}

type jsonBinding struct {
	Name  string      `json:"name"`
	Type  string      `json:"type"`
	Value interface{} `json:"value,omitempty"`
	Expr  *jsonExpr   `json:"expr,omitempty"`
}

type jsonExpr struct {
	Combine *jsonCombine `json:"combine,omitempty"`
	Pipe    *jsonPipe    `json:"pipe,omitempty"`
	Cond    *jsonCond    `json:"cond,omitempty"`
}

type jsonCombine struct {
	Fn   string     `json:"fn"`
	Args []*jsonArg `json:"args"`
}

type jsonPipe struct {
	Params []*jsonPipeParam `json:"params"`
	Steps  []*jsonPipeStep  `json:"steps"`
}

type jsonPipeParam struct {
	ParamName   string `json:"param_name"`
	SourceIdent string `json:"source_ident"`
}

type jsonPipeStep struct {
	Fn   string     `json:"fn"`
	Args []*jsonArg `json:"args"`
}

type jsonCond struct {
	Condition *jsonArg `json:"condition,omitempty"`
	Then      *jsonArg `json:"then,omitempty"`
	Else      *jsonArg `json:"else,omitempty"`
}

// jsonArg is a discriminated-union argument. At most one field is non-zero.
// StepRef uses a pointer so that step_ref=0 serialises as 0 rather than being omitted.
type jsonArg struct {
	Ref       string          `json:"ref,omitempty"`
	Lit       interface{}     `json:"lit,omitempty"`
	FuncRef   string          `json:"func_ref,omitempty"`
	StepRef   *int            `json:"step_ref,omitempty"`
	Transform *jsonTransform  `json:"transform,omitempty"`
}

type jsonTransform struct {
	Ref string `json:"ref"`
	Fn  string `json:"fn"`
}

// ─────────────────────────────────────────────────────────────────────────────
// Prepare / Merge
// ─────────────────────────────────────────────────────────────────────────────

type jsonPrepareEntry struct {
	Binding   string `json:"binding"`
	FromState string `json:"from_state,omitempty"`
	FromHook  string `json:"from_hook,omitempty"`
}

type jsonMergeEntry struct {
	Binding string `json:"binding"`
	ToState string `json:"to_state"`
}

// ─────────────────────────────────────────────────────────────────────────────
// Next rule
// ─────────────────────────────────────────────────────────────────────────────

type jsonNextRule struct {
	Compute *jsonNextCompute       `json:"compute,omitempty"`
	Prepare []*jsonNextPrepareEntry `json:"prepare,omitempty"`
	Action  string                 `json:"action"`
}

type jsonNextCompute struct {
	Condition string    `json:"condition"`
	Prog      *jsonProg `json:"prog"`
}

type jsonNextPrepareEntry struct {
	Binding     string      `json:"binding"`
	FromAction  string      `json:"from_action,omitempty"`
	FromState   string      `json:"from_state,omitempty"`
	FromLiteral interface{} `json:"from_literal,omitempty"`
}

// ─────────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────────

type jsonRoute struct {
	ID    string          `json:"id"`
	Match []*jsonMatchArm `json:"match"`
}

type jsonMatchArm struct {
	// Patterns holds the raw pattern strings ("_" for fallback,
	// "scene.action" or "scene.*.action[.action...]" for path expressions).
	// Multiple entries are OR-joined.
	Patterns []string `json:"patterns"`
	Target   string   `json:"target"`
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversion helpers
// ─────────────────────────────────────────────────────────────────────────────

func modelToJSON(model *lower.Model) *jsonModel {
	if model == nil {
		return &jsonModel{Scenes: []*jsonScene{}}
	}
	jm := &jsonModel{}
	if model.State != nil {
		jm.State = stateToJSON(model.State)
	}
	// Scene is singular in the model; wrap in a slice for the JSON schema.
	if model.Scene != nil {
		jm.Scenes = []*jsonScene{sceneToJSON(model.Scene)}
	} else {
		jm.Scenes = []*jsonScene{}
	}
	for _, r := range model.Routes {
		jm.Routes = append(jm.Routes, routeToJSON(r))
	}
	return jm
}

func stateToJSON(s *lower.HCLStateBlock) *jsonState {
	js := &jsonState{}
	for _, ns := range s.Namespaces {
		jns := &jsonNamespace{Name: ns.Name}
		for _, f := range ns.Fields {
			jns.Fields = append(jns.Fields, &jsonField{
				Name:  f.Name,
				Type:  f.Type.String(),
				Value: litToJSON(f.Default),
			})
		}
		js.Namespaces = append(js.Namespaces, jns)
	}
	return js
}

func sceneToJSON(s *lower.HCLSceneBlock) *jsonScene {
	js := &jsonScene{
		ID:           s.ID,
		EntryActions: s.EntryActions,
		NextPolicy:   s.NextPolicy,
	}
	for _, a := range s.Actions {
		js.Actions = append(js.Actions, actionToJSON(a))
	}
	return js
}

func actionToJSON(a *lower.HCLAction) *jsonAction {
	ja := &jsonAction{ID: a.ID}

	if a.Compute != nil {
		ja.Compute = computeToJSON(a.Compute)
	}
	if a.Prepare != nil {
		for _, e := range a.Prepare.Entries {
			ja.Prepare = append(ja.Prepare, &jsonPrepareEntry{
				Binding:   e.BindingName,
				FromState: e.FromState,
				FromHook:  e.FromHook,
			})
		}
	}
	if a.Merge != nil {
		for _, e := range a.Merge.Entries {
			ja.Merge = append(ja.Merge, &jsonMergeEntry{
				Binding: e.BindingName,
				ToState: e.ToState,
			})
		}
	}
	if a.Publish != nil {
		ja.Publish = a.Publish.Hooks
	}
	for _, nr := range a.Next {
		ja.Next = append(ja.Next, nextRuleToJSON(nr))
	}
	return ja
}

func computeToJSON(c *lower.HCLCompute) *jsonCompute {
	jc := &jsonCompute{Root: c.Root}
	if c.Prog != nil {
		jc.Prog = progToJSON(c.Prog)
	}
	return jc
}

func progToJSON(p *lower.HCLProg) *jsonProg {
	jp := &jsonProg{Name: p.Name}
	for _, b := range p.Bindings {
		jp.Bindings = append(jp.Bindings, bindingToJSON(b))
	}
	return jp
}

func bindingToJSON(b *lower.HCLBinding) *jsonBinding {
	jb := &jsonBinding{
		Name: b.Name,
		Type: b.Type.String(),
	}
	if b.Value != nil {
		jb.Value = litToJSON(b.Value)
	} else if b.Expr != nil {
		jb.Expr = exprToJSON(b.Expr)
	}
	return jb
}

func exprToJSON(e *lower.HCLExpr) *jsonExpr {
	je := &jsonExpr{}
	switch {
	case e.Combine != nil:
		jc := &jsonCombine{Fn: e.Combine.Fn}
		for _, a := range e.Combine.Args {
			jc.Args = append(jc.Args, argToJSON(a))
		}
		je.Combine = jc
	case e.Pipe != nil:
		jp := &jsonPipe{}
		for _, param := range e.Pipe.Params {
			jp.Params = append(jp.Params, &jsonPipeParam{
				ParamName:   param.ParamName,
				SourceIdent: param.SourceIdent,
			})
		}
		for _, step := range e.Pipe.Steps {
			js := &jsonPipeStep{Fn: step.Fn}
			for _, a := range step.Args {
				js.Args = append(js.Args, argToJSON(a))
			}
			jp.Steps = append(jp.Steps, js)
		}
		je.Pipe = jp
	case e.Cond != nil:
		jc := &jsonCond{}
		if e.Cond.Condition != nil {
			jc.Condition = argToJSON(e.Cond.Condition)
		}
		if e.Cond.Then != nil {
			jc.Then = argToJSON(e.Cond.Then)
		}
		if e.Cond.Else != nil {
			jc.Else = argToJSON(e.Cond.Else)
		}
		je.Cond = jc
	}
	return je
}

func argToJSON(a *lower.HCLArg) *jsonArg {
	ja := &jsonArg{}
	switch {
	case a.Ref != "":
		ja.Ref = a.Ref
	case a.Lit != nil:
		ja.Lit = litToJSON(a.Lit)
	case a.FuncRef != "":
		ja.FuncRef = a.FuncRef
	case a.IsStepRef:
		n := a.StepRef
		ja.StepRef = &n
	case a.Transform != nil:
		ja.Transform = &jsonTransform{Ref: a.Transform.Ref, Fn: a.Transform.Fn}
	}
	return ja
}

func nextRuleToJSON(nr *lower.HCLNextRule) *jsonNextRule {
	jnr := &jsonNextRule{Action: nr.Action}
	if nr.Compute != nil {
		jnr.Compute = &jsonNextCompute{
			Condition: nr.Compute.Condition,
			Prog:      progToJSON(nr.Compute.Prog),
		}
	}
	if nr.Prepare != nil {
		for _, e := range nr.Prepare.Entries {
			entry := &jsonNextPrepareEntry{
				Binding:    e.BindingName,
				FromAction: e.FromAction,
				FromState:  e.FromState,
			}
			if e.FromLiteral != nil {
				entry.FromLiteral = litToJSON(e.FromLiteral)
			}
			jnr.Prepare = append(jnr.Prepare, entry)
		}
	}
	return jnr
}

func routeToJSON(r *lower.HCLRouteBlock) *jsonRoute {
	jr := &jsonRoute{ID: r.ID}
	for _, arm := range r.Arms {
		jr.Match = append(jr.Match, &jsonMatchArm{
			Patterns: arm.Patterns,
			Target:   arm.Target,
		})
	}
	return jr
}

// litToJSON converts an ast.Literal to a JSON-compatible Go value.
func litToJSON(lit ast.Literal) interface{} {
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
			arr[i] = litToJSON(e)
		}
		return arr
	}
	return nil
}

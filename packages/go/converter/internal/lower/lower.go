// Package lower lowers a parsed TurnFile AST to the canonical proto model
// (turnoutpb.TurnModel), ready for validation and emission. No text is
// produced here; the emitter (emit package) converts TurnModel to HCL text or
// JSON.
package lower

import (
	"sort"
	"strings"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// ─────────────────────────────────────────────────────────────────────────────
// Generated binding name constants (shared with validate package)
// ─────────────────────────────────────────────────────────────────────────────

// GeneratedIfCondPrefix and GeneratedIfCondSuffix delimit the synthetic binding
// emitted for a CondExprCall condition (e.g. "__if_x_cond"). The validate
// package uses these to recognize and allow the reserved __ namespace.
const (
	GeneratedIfCondPrefix = "__if_"
	GeneratedIfCondSuffix = "_cond"
	GeneratedLocalPrefix  = "__local_"
)

// ─────────────────────────────────────────────────────────────────────────────
// Lower — entry point
// ─────────────────────────────────────────────────────────────────────────────

// LowerResult bundles the canonical proto model. Sigil metadata is embedded in
// Model.Annotations (cleared by the emitter before JSON output).
type LowerResult struct {
	Model *turnoutpb.TurnModel
}

// Lower converts a parsed TurnFile and resolved STATE schema to a LowerResult
// plus diagnostics. Returns a nil LowerResult when the input has errors.
func Lower(file *ast.TurnFile, schema state.Schema) (*LowerResult, diag.Diagnostics) {
	var ds diag.Diagnostics
	sc := newSidecar()

	stateModel := lowerStateBlock(file.StateSource, schema, &ds)

	tm := &turnoutpb.TurnModel{State: stateModel}

	for _, s := range file.Scenes {
		tm.Scenes = append(tm.Scenes, lowerSceneBlock(s, schema, sc, &ds))
	}

	tm.Routes = lowerRouteBlocks(file.Routes)

	if ds.HasErrors() {
		return nil, ds
	}
	// Embed sigil metadata in the proto model so the validator does not need a
	// separate sidecar parameter. The emitter clears this field before output.
	tm.Annotations = sc.ToAnnotations()
	return &LowerResult{Model: tm}, ds
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversion helpers
// ─────────────────────────────────────────────────────────────────────────────

// literalToStructpb converts an ast.Literal to a structpb.Value. A nil literal
// becomes a null value.
func literalToStructpb(lit ast.Literal) *structpb.Value {
	if lit == nil {
		return structpb.NewNullValue()
	}
	switch v := lit.(type) {
	case *ast.NumberLiteral:
		return structpb.NewNumberValue(v.Value)
	case *ast.StringLiteral:
		return structpb.NewStringValue(v.Value)
	case *ast.BoolLiteral:
		return structpb.NewBoolValue(v.Value)
	case *ast.ArrayLiteral:
		vals := make([]*structpb.Value, len(v.Elements))
		for i, e := range v.Elements {
			vals[i] = literalToStructpb(e)
		}
		return structpb.NewListValue(&structpb.ListValue{Values: vals})
	}
	return structpb.NewNullValue()
}

// ─────────────────────────────────────────────────────────────────────────────
// Route block lowering
// ─────────────────────────────────────────────────────────────────────────────

func lowerRouteBlocks(routes []*ast.RouteBlock) []*turnoutpb.RouteModel {
	result := make([]*turnoutpb.RouteModel, 0, len(routes))
	for _, r := range routes {
		rm := &turnoutpb.RouteModel{Id: r.ID}
		if r.EntrySceneID != "" {
			rm.EntrySceneId = proto.String(r.EntrySceneID)
		}
		if r.Match != nil {
			for _, arm := range r.Match.Arms {
				pbArm := &turnoutpb.MatchArm{Target: arm.Target}
				for _, branch := range arm.Branches {
					pbArm.Patterns = append(pbArm.Patterns, pathExprString(branch))
				}
				rm.Match = append(rm.Match, pbArm)
			}
		}
		result = append(result, rm)
	}
	return result
}

func pathExprString(pe *ast.PathExpr) string {
	if pe.Fallback {
		return "_"
	}
	parts := make([]string, 0, 1+len(pe.Segments))
	parts = append(parts, pe.SceneID)
	parts = append(parts, pe.Segments...)
	return strings.Join(parts, ".")
}

// ─────────────────────────────────────────────────────────────────────────────
// State block lowering
// ─────────────────────────────────────────────────────────────────────────────

func lowerStateBlock(src ast.StateSource, schema state.Schema, ds *diag.Diagnostics) *turnoutpb.StateModel {
	switch s := src.(type) {
	case *ast.InlineStateBlock:
		return lowerStateBlockFromAST(s)
	case *ast.StateFileDirective:
		if len(schema) == 0 {
			*ds = append(*ds, diag.Errorf(diag.CodeUnsupportedConstruct,
				"state_file %q: schema was not pre-loaded; call state.Load() before Lower()", s.Path))
		}
		return lowerStateBlockFromSchema(schema)
	default:
		return &turnoutpb.StateModel{}
	}
}

func lowerStateBlockFromAST(block *ast.InlineStateBlock) *turnoutpb.StateModel {
	sm := &turnoutpb.StateModel{Namespaces: make([]*turnoutpb.NamespaceModel, 0, len(block.Namespaces))}
	for _, ns := range block.Namespaces {
		pbNS := &turnoutpb.NamespaceModel{
			Name:   ns.Name,
			Fields: make([]*turnoutpb.FieldModel, 0, len(ns.Fields)),
		}
		for _, f := range ns.Fields {
			pbNS.Fields = append(pbNS.Fields, &turnoutpb.FieldModel{
				Name:  f.Name,
				Type:  f.Type.String(),
				Value: literalToStructpb(f.Default),
			})
		}
		sm.Namespaces = append(sm.Namespaces, pbNS)
	}
	return sm
}

// lowerStateBlockFromSchema reconstructs a state block from the flat schema map,
// sorting namespaces and fields alphabetically for deterministic output.
func lowerStateBlockFromSchema(schema state.Schema) *turnoutpb.StateModel {
	nsMap := make(map[string][]string)
	for key := range schema {
		parts := strings.SplitN(key, ".", 2)
		if len(parts) != 2 {
			continue
		}
		nsMap[parts[0]] = append(nsMap[parts[0]], parts[1])
	}

	nsNames := make([]string, 0, len(nsMap))
	for ns := range nsMap {
		nsNames = append(nsNames, ns)
	}
	sort.Strings(nsNames)

	sm := &turnoutpb.StateModel{Namespaces: make([]*turnoutpb.NamespaceModel, 0, len(nsNames))}
	for _, nsName := range nsNames {
		fieldNames := nsMap[nsName]
		sort.Strings(fieldNames)

		pbNS := &turnoutpb.NamespaceModel{Name: nsName, Fields: make([]*turnoutpb.FieldModel, 0, len(fieldNames))}
		for _, fieldName := range fieldNames {
			meta := schema[nsName+"."+fieldName]
			pbNS.Fields = append(pbNS.Fields, &turnoutpb.FieldModel{
				Name:  fieldName,
				Type:  meta.Type.String(),
				Value: literalToStructpb(meta.DefaultValue),
			})
		}
		sm.Namespaces = append(sm.Namespaces, pbNS)
	}
	return sm
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene / Action lowering
// ─────────────────────────────────────────────────────────────────────────────

func lowerSceneBlock(scene *ast.SceneBlock, schema state.Schema, sc *Sidecar, ds *diag.Diagnostics) *turnoutpb.SceneBlock {
	sb := &turnoutpb.SceneBlock{
		Id:           scene.ID,
		EntryActions: scene.EntryActions,
		Actions:      make([]*turnoutpb.ActionModel, 0, len(scene.Actions)),
	}
	if scene.NextPolicy != "" {
		sb.NextPolicy = proto.String(scene.NextPolicy)
	}
	if scene.View != nil {
		vb := &turnoutpb.ViewBlock{
			Name: scene.View.Name,
			Flow: scene.View.Flow,
		}
		if scene.View.Enforce != "" {
			vb.Enforce = proto.String(scene.View.Enforce)
		}
		sb.View = vb
	}
	for _, a := range scene.Actions {
		sb.Actions = append(sb.Actions, lowerAction(a, schema, scene.ID, sc, ds))
	}
	return sb
}

func lowerAction(a *ast.ActionBlock, schema state.Schema, sceneID string, sc *Sidecar, ds *diag.Diagnostics) *turnoutpb.ActionModel {
	resolver := newActionPrepareResolver(a.Prepare, schema)

	am := &turnoutpb.ActionModel{Id: a.ID}

	if text := lowerActionText(a.Text); text != nil {
		am.Text = text
	}

	if a.Compute != nil {
		am.Compute = &turnoutpb.ComputeModel{
			Root: a.Compute.Root,
			Prog: lowerProgInner(a.Compute.Prog, resolver, sceneID, a.ID, ComputeScope(), sc, ds),
		}
	}

	am.Prepare = lowerPrepare(a.Prepare)
	am.Merge = lowerMerge(a.Merge)
	am.Publish = lowerPublish(a.Publish)

	for i, nr := range a.Next {
		am.Next = append(am.Next, lowerNextRule(nr, schema, sceneID, a.ID, NextScope(i), sc, ds))
	}
	return am
}

// lowerActionText trims a single trailing newline from the raw string captured
// from a triple-quoted text literal or heredoc body.
//
// Scanner invariants:
//   - heredoc (<<-): body is the joined rawLines with no leading or trailing \n.
//   - triple-quote ("""): the scanner strips one leading \n and one trailing \n
//     at scan time, but if the content itself ends with \n a second one remains.
//
// A leading \n is NOT stripped here — doing so would silently eat a genuine
// blank first line written by the author.
func lowerActionText(raw *string) *string {
	if raw == nil {
		return nil
	}
	s := *raw
	if len(s) > 0 && s[len(s)-1] == '\n' {
		s = s[:len(s)-1]
	}
	return &s
}

// ─────────────────────────────────────────────────────────────────────────────
// Prepare / Merge / Publish lowering
// ─────────────────────────────────────────────────────────────────────────────

func lowerPrepare(prepare *ast.PrepareBlock) []*turnoutpb.PrepareEntry {
	if prepare == nil {
		return nil
	}
	entries := make([]*turnoutpb.PrepareEntry, 0, len(prepare.Entries))
	for _, e := range prepare.Entries {
		pe := &turnoutpb.PrepareEntry{Binding: e.BindingName}
		switch s := e.Source.(type) {
		case *ast.FromState:
			pe.FromState = proto.String(s.Path)
		case *ast.FromHook:
			pe.FromHook = proto.String(s.HookName)
		}
		entries = append(entries, pe)
	}
	return entries
}

func lowerMerge(merge *ast.MergeBlock) []*turnoutpb.MergeEntry {
	if merge == nil {
		return nil
	}
	entries := make([]*turnoutpb.MergeEntry, 0, len(merge.Entries))
	for _, e := range merge.Entries {
		entries = append(entries, &turnoutpb.MergeEntry{
			Binding: e.BindingName,
			ToState: e.ToState,
		})
	}
	return entries
}

func lowerPublish(pub *ast.PublishBlock) []string {
	if pub == nil {
		return nil
	}
	hooks := make([]string, len(pub.Hooks))
	copy(hooks, pub.Hooks)
	return hooks
}

// ─────────────────────────────────────────────────────────────────────────────
// Next rule lowering
// ─────────────────────────────────────────────────────────────────────────────

func lowerNextRule(nr *ast.NextRule, schema state.Schema, sceneID, actionID string, scope ProgScope, sc *Sidecar, ds *diag.Diagnostics) *turnoutpb.NextRuleModel {
	resolver := newTransitionPrepareResolver(nr.Prepare, schema)

	pbNR := &turnoutpb.NextRuleModel{Action: nr.ActionID}

	if nr.Compute != nil {
		pbNR.Compute = &turnoutpb.NextComputeModel{
			Condition: nr.Compute.Condition,
			Prog:      lowerProgInner(nr.Compute.Prog, resolver, sceneID, actionID, scope, sc, ds),
		}
	}

	pbNR.Prepare = lowerNextPrepare(nr.Prepare)
	return pbNR
}

func lowerNextPrepare(np *ast.NextPrepareBlock) []*turnoutpb.NextPrepareEntry {
	if np == nil {
		return nil
	}
	entries := make([]*turnoutpb.NextPrepareEntry, 0, len(np.Entries))
	for _, e := range np.Entries {
		entry := &turnoutpb.NextPrepareEntry{Binding: e.BindingName}
		switch s := e.Source.(type) {
		case *ast.FromAction:
			entry.FromAction = proto.String(s.BindingName)
		case *ast.FromState:
			entry.FromState = proto.String(s.Path)
		case *ast.FromLiteral:
			entry.FromLiteral = literalToStructpb(s.Value)
		}
		entries = append(entries, entry)
	}
	return entries
}

// ─────────────────────────────────────────────────────────────────────────────
// Prog / Binding lowering
// ─────────────────────────────────────────────────────────────────────────────

func lowerProgInner(prog *ast.ProgBlock, resolver prepareResolver, sceneID, actionID string, scope ProgScope, sc *Sidecar, ds *diag.Diagnostics) *turnoutpb.ProgModel {
	if prog == nil {
		return nil
	}
	bindingTypes := make(map[string]ast.FieldType, len(prog.Bindings))
	for _, decl := range prog.Bindings {
		bindingTypes[decl.Name] = decl.Type
	}
	pm := &turnoutpb.ProgModel{
		Name:     prog.Name,
		Bindings: make([]*turnoutpb.BindingModel, 0, len(prog.Bindings)),
	}
	for _, decl := range prog.Bindings {
		bindings := lowerBinding(decl, resolver, sceneID, actionID, scope, prog.Name, sc, ds, bindingTypes)
		pm.Bindings = append(pm.Bindings, bindings...)
	}
	return pm
}

// lowerBinding lowers one BindingDecl to one or more BindingModels.
// Sigils are captured in the sidecar keyed by (sceneID, actionID, progName, bindingName).
func lowerBinding(decl *ast.BindingDecl, resolver prepareResolver, sceneID, actionID string, scope ProgScope, progName string, sc *Sidecar, ds *diag.Diagnostics, bindingTypes map[string]ast.FieldType) []*turnoutpb.BindingModel {
	name := decl.Name
	ft := decl.Type

	var bindings []*turnoutpb.BindingModel
	switch rhs := decl.RHS.(type) {
	case *ast.LiteralRHS:
		bindings = []*turnoutpb.BindingModel{lowerLiteralRHS(name, ft, rhs)}
	case *ast.SigilInputRHS:
		// Ingress (~>): same "resolve or error" behavior as old PlaceholderRHS.
		// Bidir (<~>): use the bidirectional-specific missing-prepare diagnostic.
		if decl.Sigil == ast.SigilBiDir {
			bindings = []*turnoutpb.BindingModel{lowerBiDirInputRHS(name, ft, decl.Pos, resolver, ds)}
		} else {
			bindings = []*turnoutpb.BindingModel{lowerPlaceholderRHS(name, ft, decl.Pos, resolver, ds)}
		}
	case *ast.SingleRefRHS:
		bindings = []*turnoutpb.BindingModel{lowerSingleRefRHS(name, ft, rhs)}
	case *ast.FuncCallRHS:
		bindings = []*turnoutpb.BindingModel{lowerFuncCallRHS(name, ft, rhs, bindingTypes, ds)}
	case *ast.InfixRHS:
		bindings = []*turnoutpb.BindingModel{lowerInfixRHS(name, ft, rhs, bindingTypes, ds)}
	case *ast.IfCallRHS, *ast.CaseCallRHS, *ast.PipeCallRHS:
		bindings = lowerLocalRHS(name, ft, rhs, bindingTypes, ds)
	default:
		*ds = append(*ds, diag.ErrorAt(decl.Pos.File, decl.Pos.Line, decl.Pos.Col,
			diag.CodeUnsupportedConstruct, "unsupported binding RHS for %q", name))
		bindings = []*turnoutpb.BindingModel{{Name: name, Type: ft.String(), Value: literalToStructpb(zeroLiteralFor(ft))}}
	}

	// Capture sigil for the user-declared binding (matched by name).
	// Auto-generated bindings (e.g. __if_X_cond) have different names and keep SigilNone.
	if decl.Sigil != ast.SigilNone {
		for _, b := range bindings {
			if b.Name == name {
				sc.Set(BindingKey{SceneID: sceneID, ActionID: actionID, Scope: scope, ProgName: progName, BindingName: name}, decl.Sigil)
			}
		}
	}
	return bindings
}

// lowerLocalRHS delegates IfCallRHS / CaseCallRHS / PipeCallRHS to the
// localLowerer, making the abstraction boundary explicit in the lowerBinding switch.
func lowerLocalRHS(name string, ft ast.FieldType, rhs ast.BindingRHS, bindingTypes map[string]ast.FieldType, ds *diag.Diagnostics) []*turnoutpb.BindingModel {
	c := newLocalLowerer(name, ft, bindingTypes, ds)
	return c.lowerTop(rhs)
}

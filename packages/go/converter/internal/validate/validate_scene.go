package validate

import (
	"strings"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/overview"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
)

// ─────────────────────────────────────────────────────────────────────────────
// Group D — Scene structural validation
// ─────────────────────────────────────────────────────────────────────────────

func validateScene(scene *turnoutpb.SceneBlock, schema state.Schema, types *typeRegistry, ds *diag.DiagSink) {
	actionIndex := make(map[string]*turnoutpb.ActionModel, len(scene.Actions))
	for _, a := range scene.Actions {
		if _, exists := actionIndex[a.Id]; exists {
			ds.Append(diag.Errorf(diag.CodeDuplicateActionLabel,
				"duplicate action ID %q in scene %q", a.Id, scene.Id))
		} else {
			actionIndex[a.Id] = a
		}
	}

	validateOverview(scene, actionIndex, ds)

	if len(scene.Actions) == 0 {
		ds.Append(diag.Errorf(diag.CodeInvalidActionGraph,
			"scene %q has no actions", scene.Id))
	}

	if scene.EntryAction == "" {
		ds.Append(diag.Errorf(diag.CodeInvalidActionGraph,
			"scene %q has no entry action", scene.Id))
	} else if _, ok := actionIndex[scene.EntryAction]; !ok {
		ds.Append(diag.Errorf(diag.CodeInvalidActionGraph,
			"entry action %q not found in scene %q", scene.EntryAction, scene.Id))
	}

	// Build a map of action ID → compute scope for from_action cross-checks (3-A, 3-B).
	actionScopes := make(map[string]map[string]bindingInfo, len(scene.Actions))

	for _, a := range scene.Actions {
		var scope map[string]bindingInfo

		if a.Compute != nil {
			computeCtx := progValidateCtx{schema: schema, sceneID: scene.Id, actionID: a.Id, types: types}
			scope = validateProg(a.Compute.Prog, computeCtx, false, a.Compute.Root, actionExitNames(a), ds)

			if a.Compute.Root != "" {
				if _, ok := scope[a.Compute.Root]; !ok {
					ds.Append(diag.Errorf(diag.CodeActionRootNotFound,
						"action %q: compute.root %q not found in its compute block", a.Id, a.Compute.Root))
				}
			}

			validateActionEffects(a, scope, schema, ds)
		} else {
			scope = map[string]bindingInfo{}
		}
		actionScopes[a.Id] = scope

		for _, nr := range a.Next {
			if nr.Action != "" {
				if _, ok := actionIndex[nr.Action]; !ok {
					ds.Append(diag.Errorf(diag.CodeInvalidActionGraph,
						"action %q: next rule references unknown action %q", a.Id, nr.Action))
				}
			}
			nextCtx := progValidateCtx{schema: schema, sceneID: scene.Id, actionID: a.Id, types: types}
			validateNextRule(nr, nextCtx, scope, ds)
		}
	}
}

// actionExitNames lists every binding of an action's compute prog that is read
// from outside the prog: merge destinations, and the `from_action` sources of
// its transitions. These are the exit nodes unused-binding detection starts
// from, alongside the compute root.
//
// The transitions matter because a binding a transition reads is often not
// referenced anywhere inside the prog — a `next <flag> -> <action>` guard and
// every `next on (...) to { }` subject are exactly that shape. Without them
// the binding looks orphaned and draws a spurious UnusedBinding warning.
func actionExitNames(a *turnoutpb.ActionModel) []string {
	names := make([]string, 0, len(a.Merge)+len(a.Next))
	for _, m := range a.Merge {
		names = append(names, m.Binding)
	}
	for _, nr := range a.Next {
		for _, e := range nr.Prepare {
			if e.FromAction != nil {
				names = append(names, *e.FromAction)
			}
		}
	}
	return names
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview DSL enforcement (scene-graph.md §9)
// ─────────────────────────────────────────────────────────────────────────────

func compileErr(code diag.ErrorCode, format string, args ...any) diag.Diagnostic {
	d := diag.Errorf(code, format, args...)
	d.Stage = "overview_compile"
	return d
}

func validateOverview(scene *turnoutpb.SceneBlock, actionIndex map[string]*turnoutpb.ActionModel, ds *diag.DiagSink) {
	if scene.View == nil {
		return
	}
	v := scene.View

	// The block is unlabelled as of v2 (NEW_SYNTAX.md 2.2), so its name is always
	// "overview" and there is no wrong name left to report — which is what retired
	// SCN_OVERVIEW_UNKNOWN_VIEW.

	enforce := ""
	if v.Enforce != nil {
		enforce = *v.Enforce
	}
	switch enforce {
	case "nodes_only", "at_least", "strict":
	default:
		ds.Append(compileErr(diag.CodeOverviewInvalidMode,
			"scene %q: view %q has unknown enforce mode %q", scene.Id, v.Name, enforce))
		return
	}

	preParseCount := ds.Len()
	g, ok := overviewGraph(v, scene.Id, ds)
	if !ok || ds.Len() > preParseCount {
		return
	}

	actionIDs := make([]string, 0, len(scene.Actions))
	implEdges := make(map[overview.Edge]bool)
	for _, a := range scene.Actions {
		actionIDs = append(actionIDs, a.Id)
		for _, nr := range a.Next {
			if nr.Action != "" {
				implEdges[overview.Edge{From: a.Id, To: nr.Action}] = true
			}
		}
	}

	overview.Enforce(g, actionIDs, implEdges, enforce, scene.Id, ds)
}

// overviewGraph builds the overview graph for v, preferring the structured
// nodes/edges the lowerer populates because those carry source positions. It
// falls back to re-parsing the flow string only for models that have no
// structured graph — a hand-written model, or one produced before ViewBlock
// carried one. The fallback yields the same graph with no positions attached.
func overviewGraph(v *turnoutpb.ViewBlock, sceneID string, ds *diag.DiagSink) (overview.Graph, bool) {
	if len(v.Nodes) == 0 && len(v.Edges) == 0 {
		if strings.TrimSpace(v.Flow) != "" {
			return overview.Parse(v.Flow, sceneID, ds)
		}
		// No structured graph and no flow text: the block declared nothing.
		d := diag.Errorf(diag.CodeOverviewFlowEmpty, "scene %q: flow is empty or whitespace-only", sceneID)
		if p := v.GetSourcePos(); p != nil {
			d = diag.ErrorAt(p.File, int(p.Line), int(p.Col), diag.CodeOverviewFlowEmpty,
				"scene %q: flow is empty or whitespace-only", sceneID)
		}
		d.Stage = "overview_parse"
		ds.Append(d)
		return overview.Graph{}, false
	}

	g := overview.Graph{
		Pos:     protoPosToOverview(v.GetSourcePos()),
		Nodes:   make([]overview.Node, 0, len(v.Nodes)),
		Edges:   make([]overview.Edge, 0, len(v.Edges)),
		EdgePos: make(map[overview.Edge]overview.Pos, len(v.Edges)),
	}
	for _, n := range v.Nodes {
		g.Nodes = append(g.Nodes, overview.Node{ID: n.Id, Pos: protoPosToOverview(n.GetSourcePos())})
	}
	for _, e := range v.Edges {
		edge := overview.Edge{From: e.From, To: e.To}
		g.Edges = append(g.Edges, edge)
		// Duplicate edges are already collapsed by the parser; if one somehow
		// survives, the first position wins so the report points at the earliest.
		if _, seen := g.EdgePos[edge]; !seen {
			g.EdgePos[edge] = protoPosToOverview(e.GetSourcePos())
		}
	}
	return g, true
}

func protoPosToOverview(p *turnoutpb.SourcePos) overview.Pos {
	if p == nil {
		return overview.Pos{}
	}
	return overview.Pos{File: p.File, Line: int(p.Line), Col: int(p.Col)}
}

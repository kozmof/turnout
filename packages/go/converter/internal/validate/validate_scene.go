package validate

import (
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/overview"
	"github.com/kozmof/turnout/packages/go/converter/internal/state"
)

// ─────────────────────────────────────────────────────────────────────────────
// Group D — Scene structural validation
// ─────────────────────────────────────────────────────────────────────────────

func validateScene(scene *turnoutpb.SceneBlock, schema state.Schema, ds *diag.DiagSink) {
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
		ds.Append(diag.Errorf(diag.CodeSCNInvalidActionGraph,
			"scene %q has no actions", scene.Id))
	}

	if len(scene.EntryActions) == 0 {
		ds.Append(diag.Errorf(diag.CodeSCNInvalidActionGraph,
			"scene %q has no entry actions", scene.Id))
	}
	for _, ea := range scene.EntryActions {
		if _, ok := actionIndex[ea]; !ok {
			ds.Append(diag.Errorf(diag.CodeSCNInvalidActionGraph,
				"entry action %q not found in scene %q", ea, scene.Id))
		}
	}

	// Build a map of action ID → compute scope for from_action cross-checks (3-A, 3-B).
	actionScopes := make(map[string]map[string]bindingInfo, len(scene.Actions))

	for _, a := range scene.Actions {
		var scope map[string]bindingInfo

		if a.Compute != nil {
			mergeNames := make([]string, 0, len(a.Merge))
			for _, m := range a.Merge {
				mergeNames = append(mergeNames, m.Binding)
			}
			computeCtx := progValidateCtx{schema: schema, sceneID: scene.Id, actionID: a.Id}
			scope = validateProg(a.Compute.Prog, computeCtx, false, a.Compute.Root, mergeNames, ds)

			if a.Compute.Root != "" {
				if _, ok := scope[a.Compute.Root]; !ok {
					ds.Append(diag.Errorf(diag.CodeSCNActionRootNotFound,
						"action %q: compute.root %q not found in prog", a.Id, a.Compute.Root))
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
					ds.Append(diag.Errorf(diag.CodeSCNInvalidActionGraph,
						"action %q: next rule references unknown action %q", a.Id, nr.Action))
				}
			}
			nextCtx := progValidateCtx{schema: schema, sceneID: scene.Id, actionID: a.Id}
			validateNextRule(nr, nextCtx, scope, ds)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview DSL enforcement (scene-graph.md §9)
// ─────────────────────────────────────────────────────────────────────────────

func compileErr(code, format string, args ...any) diag.Diagnostic {
	d := diag.Errorf(code, format, args...)
	d.Stage = "overview_compile"
	return d
}

func validateOverview(scene *turnoutpb.SceneBlock, actionIndex map[string]*turnoutpb.ActionModel, ds *diag.DiagSink) {
	if scene.View == nil {
		return
	}
	v := scene.View

	if v.Name != "overview" {
		ds.Append(compileErr(diag.CodeOverviewUnknownView,
			"scene %q: view name must be \"overview\"; got %q", scene.Id, v.Name))
		return
	}

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

	g, parseDiags := overview.Parse(v.Flow, scene.Id)
	ds.AppendAll(parseDiags)
	if parseDiags.HasErrors() {
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

	ds.AppendAll(overview.Enforce(g, actionIDs, implEdges, enforce, scene.Id))
}

package validate

import (
	"strings"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
)

// ─────────────────────────────────────────────────────────────────────────────
// Group E — Route validation
// ─────────────────────────────────────────────────────────────────────────────

func validateRoutes(routes []*turnoutpb.RouteModel, knownScenes map[string]bool, knownActions map[string]map[string]bool, ds *diag.DiagSink) {
	allKnownActions := make(map[string]bool)
	for _, actionSet := range knownActions {
		for actionID := range actionSet {
			allKnownActions[actionID] = true
		}
	}
	for _, r := range routes {
		validateRoute(r, knownScenes, knownActions, allKnownActions, ds)
	}
}

func validateRoute(r *turnoutpb.RouteModel, knownScenes map[string]bool, knownActions map[string]map[string]bool, allKnownActions map[string]bool, ds *diag.DiagSink) {
	if r.EntrySceneId == nil || *r.EntrySceneId == "" {
		ds.Append(diag.Errorf(diag.CodeMissingEntryScene,
			"route %q: missing entry declaration", r.Id))
	} else if !knownScenes[*r.EntrySceneId] {
		ds.Append(diag.Errorf(diag.CodeUnresolvedEntryScene,
			"route %q: entry scene %q is not defined", r.Id, *r.EntrySceneId))
	}
	fallbackCount := 0
	for i, arm := range r.Match {
		if arm.Target != "" && !knownScenes[arm.Target] {
			ds.Append(diag.Errorf(diag.CodeUnresolvedScene,
				"route %q arm %d: target scene %q is not defined", r.Id, i, arm.Target))
		}
		for _, pat := range arm.Patterns {
			if pat == "_" {
				fallbackCount++
				if fallbackCount > 1 {
					ds.Append(diag.Errorf(diag.CodeDuplicateFallback,
						"route %q: match block has more than one _ fallback arm", r.Id))
				}
				continue
			}
			validateRoutePattern(r.Id, i, pat, knownActions, allKnownActions, ds)
		}
	}
}

func validateRoutePattern(routeID string, armIdx int, pat string, knownActions map[string]map[string]bool, allKnownActions map[string]bool, ds *diag.DiagSink) {
	parts := strings.Split(pat, ".")

	if len(parts) < 1 || parts[0] == "" || parts[0] == "*" {
		ds.Append(diag.Errorf(diag.CodeInvalidPathItem,
			"route %q arm %d: pattern %q has no valid scene_id prefix", routeID, armIdx, pat))
		return
	}

	if len(parts) < 2 {
		ds.Append(diag.Errorf(diag.CodeBareWildcardPath,
			"route %q arm %d: pattern %q has no action segment after scene_id", routeID, armIdx, pat))
		return
	}

	wildcardCount := 0
	for _, seg := range parts[1:] {
		if seg == "*" {
			wildcardCount++
		}
	}
	if wildcardCount > 1 {
		ds.Append(diag.Errorf(diag.CodeMultipleWildcards,
			"route %q arm %d: pattern %q has more than one * wildcard", routeID, armIdx, pat))
		return
	}

	if parts[len(parts)-1] == "*" {
		ds.Append(diag.Errorf(diag.CodeBareWildcardPath,
			"route %q arm %d: pattern %q ends with * (terminal action required)", routeID, armIdx, pat))
		return
	}

	// For wildcard patterns (scene_id.*.terminal[...]), cross-check the terminal
	// action name against all known action IDs across all scenes. The terminal
	// may live in any scene reached via routing, so we can only warn, not error.
	if wildcardCount == 1 {
		terminal := parts[len(parts)-1]
		if !allKnownActions[terminal] {
			ds.Append(diag.WarnAt("", 0, 0, diag.CodeWildcardTerminalUnresolvable,
				"route %q arm %d: pattern %q terminal action %q does not match any known action ID across all scenes (possible typo)",
				routeID, armIdx, pat, terminal))
		}
		return
	}

	// Cross-check: for direct scene_id.action_id patterns (exactly 2 segments,
	// no wildcards), verify the action ID exists in the named scene.
	// Skip if the scene is unknown (already reported as UnresolvedScene).
	if len(parts) == 2 {
		sceneID := parts[0]
		actionID := parts[1]
		if actionSet, sceneKnown := knownActions[sceneID]; sceneKnown {
			if !actionSet[actionID] {
				ds.Append(diag.Errorf(diag.CodeUnresolvedAction,
					"route %q arm %d: pattern %q references action %q which does not exist in scene %q",
					routeID, armIdx, pat, actionID, sceneID))
			}
		}
	}
}

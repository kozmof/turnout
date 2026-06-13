// Package overview implements parsing and enforcement of the Overview DSL
// (scene-graph.md §9). It is kept separate from the validator so that flow
// string syntax errors are caught as a distinct, clearly labelled stage.
package overview

import (
	"strings"
	"unicode/utf8"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
)

// Edge represents a directed action-to-action transition declared in a flow string.
type Edge struct{ From, To string }

// Graph is the result of parsing a flow string: a set of node names and edges.
type Graph struct {
	Nodes []string
	Edges []Edge
}

// Parse parses the flow DSL text for the named scene and appends any diagnostics
// to ds. Returns the parsed Graph (empty on parse failure). sceneID is used only
// for error messages. Returns ok=false if parsing failed.
func Parse(flow, sceneID string, ds *diag.DiagSink) (Graph, bool) {
	var localDs diag.Diagnostics
	nodes, edges, ok := parseFlow(flow, sceneID, &localDs)
	ds.AppendAll(localDs)
	if !ok {
		return Graph{}, false
	}
	return Graph{Nodes: nodes, Edges: edges}, true
}

// Enforce checks the Graph against the scene's actual action IDs and transition
// edges according to the given mode ("nodes_only", "at_least", or "strict").
// Diagnostics are appended directly to ds. sceneID is used only for error messages.
func Enforce(g Graph, actionIDs []string, implEdges map[Edge]bool, mode, sceneID string, ds *diag.DiagSink) {
	actionSet := make(map[string]bool, len(actionIDs))
	for _, id := range actionIDs {
		actionSet[id] = true
	}

	// Per spec §5.2, SCN_OVERVIEW_UNKNOWN_NODE fires only for names in overview_nodes
	// (g.Nodes). Edge-target-only names are not in overview_nodes and are not subject
	// to this check; missing edge targets are caught by SCN_OVERVIEW_MISSING_EDGE.
	for _, node := range g.Nodes {
		if !actionSet[node] {
			ds.Append(enforceErr(diag.CodeOverviewUnknownNode,
				"scene %q: flow references unknown action %q", sceneID, node))
		}
	}

	if mode == "nodes_only" {
		return
	}

	for _, e := range g.Edges {
		if !implEdges[e] {
			ds.Append(enforceErr(diag.CodeOverviewMissingEdge,
				"scene %q: flow declares edge %s |=> %s but no such next rule exists", sceneID, e.From, e.To))
		}
	}

	if mode == "strict" {
		flowNodeSet := make(map[string]bool, len(g.Nodes))
		for _, n := range g.Nodes {
			flowNodeSet[n] = true
		}
		flowEdgeSet := make(map[Edge]bool, len(g.Edges))
		for _, e := range g.Edges {
			flowEdgeSet[e] = true
		}

		for _, id := range actionIDs {
			if !flowNodeSet[id] {
				ds.Append(enforceErr(diag.CodeOverviewExtraNode,
					"scene %q: action %q exists but is not listed in flow", sceneID, id))
			}
		}

		for e := range implEdges {
			if !flowEdgeSet[e] {
				ds.Append(enforceErr(diag.CodeOverviewExtraEdge,
					"scene %q: next rule %s |=> %s exists but is not declared in flow", sceneID, e.From, e.To))
			}
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: flow string parser
// ─────────────────────────────────────────────────────────────────────────────

func parseErr(code diag.ErrorCode, sceneID, format string, args ...any) diag.Diagnostic {
	d := diag.Errorf(code, "scene %q: "+format, append([]any{sceneID}, args...)...)
	d.Stage = "overview_parse"
	return d
}

func enforceErr(code diag.ErrorCode, format string, args ...any) diag.Diagnostic {
	d := diag.Errorf(code, format, args...)
	d.Stage = "overview_enforce"
	return d
}

func parseFlow(flowText, sceneID string, ds *diag.Diagnostics) (nodes []string, edges []Edge, ok bool) {
	if strings.TrimSpace(flowText) == "" {
		*ds = append(*ds, parseErr(diag.CodeOverviewFlowEmpty, sceneID, "flow is empty or whitespace-only"))
		return nil, nil, false
	}

	var current string
	seenNodes := make(map[string]bool)
	seenEdges := make(map[Edge]bool)

	addEdge := func(from, to string) {
		e := Edge{From: from, To: to}
		if !seenEdges[e] {
			seenEdges[e] = true
			edges = append(edges, e)
		}
	}
	addNode := func(id string) {
		if !seenNodes[id] {
			seenNodes[id] = true
			nodes = append(nodes, id)
		}
	}

	for _, raw := range strings.Split(flowText, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}

		if strings.HasPrefix(line, "|=>") {
			// Edge line — sources from current.
			target := strings.TrimSpace(line[3:])
			if target == "" {
				*ds = append(*ds, parseErr(diag.CodeOverviewEdgeNoTarget, sceneID, "edge line |=> has no target identifier"))
				return nil, nil, false
			}
			if !isIdent(target) {
				*ds = append(*ds, parseErr(diag.CodeOverviewInvalidIdent, sceneID, "flow has invalid edge target %q", target))
				return nil, nil, false
			}
			if current == "" {
				*ds = append(*ds, parseErr(diag.CodeOverviewEdgeWithoutSource, sceneID, "edge |=> %q appears before any source node", target))
				return nil, nil, false
			}
			addEdge(current, target)
			// target is NOT added to nodes (spec §4.3)

		} else if strings.Contains(line, "|=>") {
			// Chain line — split into segments and wire them sequentially.
			parts := strings.Split(line, "|=>")
			for i, seg := range parts {
				parts[i] = strings.TrimSpace(seg)
			}
			if parts[len(parts)-1] == "" {
				*ds = append(*ds, parseErr(diag.CodeOverviewChainNoTarget, sceneID, "chain line ends with |=> and has no target"))
				return nil, nil, false
			}
			for _, seg := range parts {
				if !isIdent(seg) {
					*ds = append(*ds, parseErr(diag.CodeOverviewInvalidIdent, sceneID, "flow has invalid chain segment %q", seg))
					return nil, nil, false
				}
			}
			// All segments except the last become nodes (spec §4.2).
			for _, seg := range parts[:len(parts)-1] {
				addNode(seg)
			}
			for i := 0; i < len(parts)-1; i++ {
				addEdge(parts[i], parts[i+1])
			}
			current = parts[len(parts)-1]

		} else {
			// Node line.
			if !isIdent(line) {
				*ds = append(*ds, parseErr(diag.CodeOverviewInvalidIdent, sceneID, "flow has invalid node identifier %q", line))
				return nil, nil, false
			}
			addNode(line)
			current = line
		}
	}
	return nodes, edges, true
}

func isIdent(s string) bool {
	if len(s) == 0 {
		return false
	}
	first, size := utf8.DecodeRuneInString(s)
	if first == utf8.RuneError && size <= 1 {
		return false
	}
	if !((first >= 'a' && first <= 'z') || (first >= 'A' && first <= 'Z') || first == '_') {
		return false
	}
	for _, c := range s[size:] {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_' || (c >= '0' && c <= '9')) {
			return false
		}
	}
	return true
}

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

// Parse parses the flow DSL text for the named scene and returns a Graph.
// sceneID is used only for error messages.
func Parse(flow, sceneID string) (Graph, diag.Diagnostics) {
	var ds diag.Diagnostics
	nodes, edges, ok := parseFlow(flow, sceneID, &ds)
	if !ok {
		return Graph{}, ds
	}
	return Graph{Nodes: nodes, Edges: edges}, ds
}

// Enforce checks the Graph against the scene's actual action IDs and transition
// edges according to the given mode ("nodes_only", "at_least", or "strict").
// sceneID is used only for error messages.
func Enforce(g Graph, actionIDs []string, implEdges map[Edge]bool, mode, sceneID string) diag.Diagnostics {
	var ds diag.Diagnostics

	actionSet := make(map[string]bool, len(actionIDs))
	for _, id := range actionIDs {
		actionSet[id] = true
	}

	// Collect all names referenced by the overview graph in one deduplicated set,
	// then check membership once — prevents duplicate diagnostics for nodes that
	// appear in both g.Nodes and as edge endpoints.
	allReferenced := make(map[string]struct{}, len(g.Nodes)+len(g.Edges)*2)
	for _, node := range g.Nodes {
		allReferenced[node] = struct{}{}
	}
	for _, e := range g.Edges {
		allReferenced[e.From] = struct{}{}
		allReferenced[e.To] = struct{}{}
	}
	for name := range allReferenced {
		if !actionSet[name] {
			ds = append(ds, enforceErr(diag.CodeOverviewUnknownNode,
				"scene %q: flow references unknown action %q", sceneID, name))
		}
	}

	if mode == "nodes_only" {
		return ds
	}

	for _, e := range g.Edges {
		if !implEdges[e] {
			ds = append(ds, enforceErr(diag.CodeOverviewMissingEdge,
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
				ds = append(ds, enforceErr(diag.CodeOverviewExtraNode,
					"scene %q: action %q exists but is not listed in flow", sceneID, id))
			}
		}

		for e := range implEdges {
			if !flowEdgeSet[e] {
				ds = append(ds, enforceErr(diag.CodeOverviewExtraEdge,
					"scene %q: next rule %s |=> %s exists but is not declared in flow", sceneID, e.From, e.To))
			}
		}
	}

	return ds
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: flow string parser
// ─────────────────────────────────────────────────────────────────────────────

func parseErr(code, sceneID, format string, args ...any) diag.Diagnostic {
	d := diag.Errorf(code, "scene %q: "+format, append([]any{sceneID}, args...)...)
	d.Stage = "overview_parse"
	return d
}

func enforceErr(code, format string, args ...any) diag.Diagnostic {
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

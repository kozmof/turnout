package overview_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/overview"
)

// flush collects diagnostics from ds for inspection.
func flush(ds *diag.DiagSink) diag.Diagnostics { return ds.Flush() }

// hasCode reports whether any diagnostic in ds carries the given code.
func hasCode(ds diag.Diagnostics, code diag.ErrorCode) bool {
	for _, d := range ds {
		if d.Code == code {
			return true
		}
	}
	return false
}

// mustParse calls Parse and fails the test if it returns ok=false.
func mustParse(t *testing.T, flow string) overview.Graph {
	t.Helper()
	var ds diag.DiagSink
	g, ok := overview.Parse(flow, "scene", &ds)
	if !ok {
		t.Fatalf("mustParse(%q): parse failed: %v", flow, flush(&ds))
	}
	return g
}

func nodeSliceEq(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse — happy paths
// ─────────────────────────────────────────────────────────────────────────────

func TestParseNodeOnly(t *testing.T) {
	g := mustParse(t, "foo")
	if !nodeSliceEq(g.Nodes, []string{"foo"}) {
		t.Errorf("Nodes = %v; want [foo]", g.Nodes)
	}
	if len(g.Edges) != 0 {
		t.Errorf("Edges = %v; want []", g.Edges)
	}
}

func TestParseTwoNodes(t *testing.T) {
	g := mustParse(t, "foo\nbar")
	if !nodeSliceEq(g.Nodes, []string{"foo", "bar"}) {
		t.Errorf("Nodes = %v; want [foo bar]", g.Nodes)
	}
}

func TestParseEdgeLine(t *testing.T) {
	g := mustParse(t, "foo\n|=> bar")
	if !nodeSliceEq(g.Nodes, []string{"foo"}) {
		t.Errorf("Nodes = %v; want [foo]", g.Nodes)
	}
	want := []overview.Edge{{From: "foo", To: "bar"}}
	if len(g.Edges) != 1 || g.Edges[0] != want[0] {
		t.Errorf("Edges = %v; want %v", g.Edges, want)
	}
}

func TestParseChainLine(t *testing.T) {
	// All but last become nodes; edges wire sequentially.
	g := mustParse(t, "foo |=> bar |=> baz")
	// "foo" and "bar" become nodes; "baz" is edge-target-only (not a node).
	if !nodeSliceEq(g.Nodes, []string{"foo", "bar"}) {
		t.Errorf("Nodes = %v; want [foo bar]", g.Nodes)
	}
	wantEdges := []overview.Edge{{From: "foo", To: "bar"}, {From: "bar", To: "baz"}}
	if len(g.Edges) != len(wantEdges) {
		t.Fatalf("Edges = %v; want %v", g.Edges, wantEdges)
	}
	for i, e := range wantEdges {
		if g.Edges[i] != e {
			t.Errorf("Edges[%d] = %v; want %v", i, g.Edges[i], e)
		}
	}
}

func TestParseDuplicateNodeDeduplicated(t *testing.T) {
	g := mustParse(t, "foo\nfoo")
	if !nodeSliceEq(g.Nodes, []string{"foo"}) {
		t.Errorf("Nodes = %v; want [foo]", g.Nodes)
	}
}

func TestParseDuplicateEdgeDeduplicated(t *testing.T) {
	// Edge foo→bar appears via chain then again via an edge line.
	g := mustParse(t, "foo |=> bar\nfoo\n|=> bar")
	if len(g.Edges) != 1 {
		t.Errorf("Edges = %v; want exactly 1 edge", g.Edges)
	}
}

func TestParseEmptyLinesSkipped(t *testing.T) {
	g := mustParse(t, "\n\nfoo\n\nbar\n\n")
	if !nodeSliceEq(g.Nodes, []string{"foo", "bar"}) {
		t.Errorf("Nodes = %v; want [foo bar]", g.Nodes)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse — error paths
// ─────────────────────────────────────────────────────────────────────────────

func TestParseEmptyFlow(t *testing.T) {
	var ds diag.DiagSink
	_, ok := overview.Parse("", "scene", &ds)
	if ok {
		t.Fatal("expected ok=false for empty flow")
	}
	if !hasCode(flush(&ds), diag.CodeOverviewFlowEmpty) {
		t.Error("expected CodeOverviewFlowEmpty")
	}
}

func TestParseWhitespaceOnlyFlow(t *testing.T) {
	var ds diag.DiagSink
	_, ok := overview.Parse("   \n\t  ", "scene", &ds)
	if ok {
		t.Fatal("expected ok=false for whitespace-only flow")
	}
	if !hasCode(flush(&ds), diag.CodeOverviewFlowEmpty) {
		t.Error("expected CodeOverviewFlowEmpty")
	}
}

func TestParseEdgeBeforeSource(t *testing.T) {
	var ds diag.DiagSink
	_, ok := overview.Parse("|=> bar", "scene", &ds)
	if ok {
		t.Fatal("expected ok=false")
	}
	if !hasCode(flush(&ds), diag.CodeOverviewEdgeWithoutSource) {
		t.Error("expected CodeOverviewEdgeWithoutSource")
	}
}

func TestParseEdgeNoTarget(t *testing.T) {
	var ds diag.DiagSink
	_, ok := overview.Parse("foo\n|=>", "scene", &ds)
	if ok {
		t.Fatal("expected ok=false")
	}
	if !hasCode(flush(&ds), diag.CodeOverviewEdgeNoTarget) {
		t.Error("expected CodeOverviewEdgeNoTarget")
	}
}

func TestParseEdgeInvalidTargetIdent(t *testing.T) {
	var ds diag.DiagSink
	_, ok := overview.Parse("foo\n|=> 123", "scene", &ds)
	if ok {
		t.Fatal("expected ok=false")
	}
	if !hasCode(flush(&ds), diag.CodeOverviewInvalidIdent) {
		t.Error("expected CodeOverviewInvalidIdent")
	}
}

func TestParseChainNoTarget(t *testing.T) {
	var ds diag.DiagSink
	_, ok := overview.Parse("foo |=>", "scene", &ds)
	if ok {
		t.Fatal("expected ok=false")
	}
	if !hasCode(flush(&ds), diag.CodeOverviewChainNoTarget) {
		t.Error("expected CodeOverviewChainNoTarget")
	}
}

func TestParseInvalidNodeIdent(t *testing.T) {
	var ds diag.DiagSink
	_, ok := overview.Parse("123foo", "scene", &ds)
	if ok {
		t.Fatal("expected ok=false")
	}
	if !hasCode(flush(&ds), diag.CodeOverviewInvalidIdent) {
		t.Error("expected CodeOverviewInvalidIdent")
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Enforce — nodes_only mode
// ─────────────────────────────────────────────────────────────────────────────

func TestEnforceNodesOnlyAllMatch(t *testing.T) {
	g := mustParse(t, "foo\nbar")
	var ds diag.DiagSink
	overview.Enforce(g, []string{"foo", "bar"}, nil, "nodes_only", "scene", &ds)
	if ds.HasErrors() {
		t.Errorf("expected no errors, got %v", flush(&ds))
	}
}

func TestEnforceNodesOnlyUnknownNode(t *testing.T) {
	g := mustParse(t, "foo\nghost")
	var ds diag.DiagSink
	overview.Enforce(g, []string{"foo"}, nil, "nodes_only", "scene", &ds)
	if !hasCode(flush(&ds), diag.CodeOverviewUnknownNode) {
		t.Error("expected CodeOverviewUnknownNode")
	}
}

func TestEnforceNodesOnlyExtraActionIgnored(t *testing.T) {
	// nodes_only does not fire ExtraNode for actionIDs not in the graph.
	g := mustParse(t, "foo")
	var ds diag.DiagSink
	overview.Enforce(g, []string{"foo", "extra"}, nil, "nodes_only", "scene", &ds)
	if ds.HasErrors() {
		t.Errorf("expected no errors for extra action in nodes_only, got %v", flush(&ds))
	}
}

func TestEnforceNodesOnlyEdgesIgnored(t *testing.T) {
	g := mustParse(t, "foo |=> bar")
	// implEdges is empty — nodes_only should not care.
	var ds diag.DiagSink
	overview.Enforce(g, []string{"foo"}, map[overview.Edge]bool{}, "nodes_only", "scene", &ds)
	if ds.HasErrors() {
		t.Errorf("expected no errors: nodes_only ignores edges, got %v", flush(&ds))
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Enforce — at_least mode
// ─────────────────────────────────────────────────────────────────────────────

func TestEnforceAtLeastAllPresent(t *testing.T) {
	g := mustParse(t, "foo |=> bar")
	impl := map[overview.Edge]bool{{From: "foo", To: "bar"}: true}
	var ds diag.DiagSink
	overview.Enforce(g, []string{"foo"}, impl, "at_least", "scene", &ds)
	if ds.HasErrors() {
		t.Errorf("expected no errors, got %v", flush(&ds))
	}
}

func TestEnforceAtLeastMissingEdge(t *testing.T) {
	g := mustParse(t, "foo |=> bar")
	var ds diag.DiagSink
	overview.Enforce(g, []string{"foo"}, map[overview.Edge]bool{}, "at_least", "scene", &ds)
	if !hasCode(flush(&ds), diag.CodeOverviewMissingEdge) {
		t.Error("expected CodeOverviewMissingEdge")
	}
}

func TestEnforceAtLeastExtraImplEdgeIgnored(t *testing.T) {
	g := mustParse(t, "foo")
	impl := map[overview.Edge]bool{{From: "foo", To: "bar"}: true}
	var ds diag.DiagSink
	overview.Enforce(g, []string{"foo"}, impl, "at_least", "scene", &ds)
	if ds.HasErrors() {
		t.Errorf("at_least should not fire for extra impl edge, got %v", flush(&ds))
	}
}

func TestEnforceAtLeastUnknownNodeStillFires(t *testing.T) {
	g := mustParse(t, "ghost")
	var ds diag.DiagSink
	overview.Enforce(g, []string{"foo"}, nil, "at_least", "scene", &ds)
	if !hasCode(flush(&ds), diag.CodeOverviewUnknownNode) {
		t.Error("expected CodeOverviewUnknownNode in at_least mode")
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Enforce — strict mode
// ─────────────────────────────────────────────────────────────────────────────

func TestEnforceStrictExactMatch(t *testing.T) {
	g := mustParse(t, "foo |=> bar")
	impl := map[overview.Edge]bool{{From: "foo", To: "bar"}: true}
	var ds diag.DiagSink
	// "foo" is in the graph; "bar" is edge-target-only (not a graph node).
	overview.Enforce(g, []string{"foo"}, impl, "strict", "scene", &ds)
	if ds.HasErrors() {
		t.Errorf("expected no errors, got %v", flush(&ds))
	}
}

func TestEnforceStrictExtraAction(t *testing.T) {
	g := mustParse(t, "foo")
	var ds diag.DiagSink
	overview.Enforce(g, []string{"foo", "extra"}, nil, "strict", "scene", &ds)
	if !hasCode(flush(&ds), diag.CodeOverviewExtraNode) {
		t.Error("expected CodeOverviewExtraNode")
	}
}

func TestEnforceStrictExtraImplEdge(t *testing.T) {
	g := mustParse(t, "foo")
	impl := map[overview.Edge]bool{{From: "foo", To: "bar"}: true}
	var ds diag.DiagSink
	overview.Enforce(g, []string{"foo"}, impl, "strict", "scene", &ds)
	if !hasCode(flush(&ds), diag.CodeOverviewExtraEdge) {
		t.Error("expected CodeOverviewExtraEdge")
	}
}

func TestEnforceStrictMissingEdge(t *testing.T) {
	g := mustParse(t, "foo |=> bar")
	var ds diag.DiagSink
	overview.Enforce(g, []string{"foo"}, map[overview.Edge]bool{}, "strict", "scene", &ds)
	if !hasCode(flush(&ds), diag.CodeOverviewMissingEdge) {
		t.Error("expected CodeOverviewMissingEdge")
	}
}

func TestEnforceStrictMultipleErrorsCollected(t *testing.T) {
	// Both an unknown node and a missing edge fire in a single pass.
	g := mustParse(t, "ghost |=> bar")
	var ds diag.DiagSink
	overview.Enforce(g, []string{"foo"}, map[overview.Edge]bool{}, "strict", "scene", &ds)
	ds2 := flush(&ds)
	if !hasCode(ds2, diag.CodeOverviewUnknownNode) {
		t.Error("expected CodeOverviewUnknownNode")
	}
	if !hasCode(ds2, diag.CodeOverviewMissingEdge) {
		t.Error("expected CodeOverviewMissingEdge")
	}
}

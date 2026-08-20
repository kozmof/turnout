package validate_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/lower"
	"github.com/kozmof/turnout/packages/go/converter/internal/parser"
	"github.com/kozmof/turnout/packages/go/converter/internal/validate"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// boolProg builds a one-binding prog whose single value binding is `true`,
// enough to give an action a well-formed compute graph in model-level tests.
func boolProg(progName, binding string) *turnoutpb.ProgModel {
	return &turnoutpb.ProgModel{
		Name: progName,
		Bindings: []*turnoutpb.BindingModel{
			{Name: binding, Type: "bool", Value: structpb.NewBoolValue(true)},
		},
	}
}

// ─── helpers ──────────────────────────────────────────────────────────────────

// twoActionScene builds a minimal scene with two actions (a → b) and an optional
// view block injected just before the action declarations.
func twoActionScene(viewBlock string) string {
	return basicState + `
scene "test" {
  entry_action = a
` + viewBlock + `
  action "a" {
    compute "p" { v:bool := true }
    next {
      compute "q" { v:bool := true }
      action = b
    }
  }
  action "b" {
    compute "p" { v:bool := true }
  }
}
`
}

// ─── nodes_only ───────────────────────────────────────────────────────────────

func TestOverviewNodesOnlyValid(t *testing.T) {
	src := twoActionScene(`
  overview nodes_only {
    a |-> b
  }
`)
	if ds := pipeline(src); ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestOverviewNodesOnlyUnknownNode(t *testing.T) {
	// missing_action must be declared as a node line to appear in overview_nodes
	// and be checked against impl_nodes.  A pure edge target is not in overview_nodes.
	src := twoActionScene(`
  overview nodes_only {
    a
    missing_action
  }
`)
	if !hasCode(pipeline(src), diag.CodeOverviewUnknownNode) {
		t.Error("want SCN_OVERVIEW_UNKNOWN_NODE")
	}
}

// nodes_only does not care about missing edges in the implementation.
func TestOverviewNodesOnlyIgnoresMissingEdge(t *testing.T) {
	// flow declares a→b but implementation has no next rule from a to b
	src := basicState + `
scene "test" {
  entry_action = a
  overview nodes_only {
    a |-> b
  }
  action "a" {
    compute "p" { v:bool := true }
  }
  action "b" {
    compute "p" { v:bool := true }
  }
}
`
	if ds := pipeline(src); ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

// ─── at_least ─────────────────────────────────────────────────────────────────

func TestOverviewAtLeastValid(t *testing.T) {
	src := twoActionScene(`
  overview at_least {
    a |-> b
  }
`)
	if ds := pipeline(src); ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestOverviewAtLeastMissingEdge(t *testing.T) {
	// flow declares a→b but implementation has no next from a
	src := basicState + `
scene "test" {
  entry_action = a
  overview at_least {
    a |-> b
  }
  action "a" {
    compute "p" { v:bool := true }
  }
  action "b" {
    compute "p" { v:bool := true }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeOverviewMissingEdge) {
		t.Error("want SCN_OVERVIEW_MISSING_EDGE")
	}
}

// at_least allows impl to have more edges than the flow declares.
func TestOverviewAtLeastAllowsExtraImplEdge(t *testing.T) {
	// flow declares only a→b; impl also has a→c — that is fine for at_least
	src := basicState + `
scene "test" {
  entry_action = a
  overview at_least {
    a |-> b
  }
  action "a" {
    compute "p" { v:bool := true }
    next {
      compute "q" { v:bool := true }
      action = b
    }
    next {
      compute "r" { v:bool := true }
      action = c
    }
  }
  action "b" {
    compute "p" { v:bool := true }
  }
  action "c" {
    compute "p" { v:bool := true }
  }
}
`
	if ds := pipeline(src); ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

// ─── strict ───────────────────────────────────────────────────────────────────

func TestOverviewStrictValid(t *testing.T) {
	src := twoActionScene(`
  overview strict {
    a |-> b
    b
  }
`)
	if ds := pipeline(src); ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestOverviewStrictExtraNode(t *testing.T) {
	// impl has action "c" not listed in flow
	src := basicState + `
scene "test" {
  entry_action = a
  overview strict {
    a |-> b
    b
  }
  action "a" {
    compute "p" { v:bool := true }
    next {
      compute "q" { v:bool := true }
      action = b
    }
  }
  action "b" {
    compute "p" { v:bool := true }
  }
  action "c" {
    compute "p" { v:bool := true }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeOverviewExtraNode) {
		t.Error("want SCN_OVERVIEW_EXTRA_NODE")
	}
}

func TestOverviewStrictExtraEdge(t *testing.T) {
	// impl has a→c but flow only declares a→b
	src := basicState + `
scene "test" {
  entry_action = a
  overview strict {
    a |-> b
    b
    c
  }
  action "a" {
    compute "p" { v:bool := true }
    next {
      compute "q" { v:bool := true }
      action = b
    }
    next {
      compute "r" { v:bool := true }
      action = c
    }
  }
  action "b" {
    compute "p" { v:bool := true }
  }
  action "c" {
    compute "p" { v:bool := true }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeOverviewExtraEdge) {
		t.Error("want SCN_OVERVIEW_EXTRA_EDGE")
	}
}

// ─── parse errors ─────────────────────────────────────────────────────────────

// Now that the flow is part of the token stream (NEW_SYNTAX.md 2.2), several
// conditions the string parser had to detect are unrepresentable in the grammar:
// an edge cannot precede its source, and an edge endpoint cannot be a malformed
// identifier because the lexer only ever produces identifiers there. Those cases
// are parse errors now, which is why OverviewEdgeWithoutSource,
// OverviewInvalidIdent and OverviewChainNoTarget were retired from this layer.
// overview.Parse keeps its own unit tests for the string form the model carries.

func TestOverviewEdgeBeforeSourceIsParseError(t *testing.T) {
	src := twoActionScene(`
  overview nodes_only {
    |-> b
  }
`)
	if !hasCode(pipeline(src), diag.CodeParseSyntaxError) {
		t.Error("want a parse error for an edge with no source")
	}
}

func TestOverviewBadEdgeTarget(t *testing.T) {
	src := twoActionScene(`
  overview nodes_only {
    a |-> 123bad
  }
`)
	if !hasCode(pipeline(src), diag.CodeOverviewEdgeNoTarget) {
		t.Error("want OverviewEdgeNoTarget for a non-identifier target")
	}
}

func TestOverviewFlowEmpty(t *testing.T) {
	src := twoActionScene(`
  overview nodes_only {
  }
`)
	if !hasCode(pipeline(src), diag.CodeOverviewFlowEmpty) {
		t.Error("want OverviewFlowEmpty")
	}
}

func TestOverviewEdgeNoTarget(t *testing.T) {
	src := twoActionScene(`
  overview nodes_only {
    a |->
  }
`)
	if !hasCode(pipeline(src), diag.CodeOverviewEdgeNoTarget) {
		t.Error("want OverviewEdgeNoTarget")
	}
}

// TestOverviewEdgesCarryPositions is the point of moving the flow out of the
// heredoc: overview diagnostics now carry a file:line:col, where before the flow
// was an opaque string and its diagnostics had no position at all.
func TestOverviewEdgesCarryPositions(t *testing.T) {
	src := twoActionScene(`
  overview nodes_only {
    a |-> 123bad
  }
`)
	for _, d := range pipeline(src) {
		if d.Code == diag.CodeOverviewEdgeNoTarget {
			if d.Line == 0 || d.Col == 0 {
				t.Errorf("diagnostic has no position: %s", d.Format())
			}
			return
		}
	}
	t.Error("expected an OverviewEdgeNoTarget diagnostic")
}

func TestOverviewChainLinear(t *testing.T) {
	// §6.4: foo |-> bar |-> baz parses as nodes={foo,bar}, edges={(foo,bar),(bar,baz)}, current=baz
	src := basicState + `
scene "test" {
  entry_action = foo
  overview at_least {
    foo |-> bar |-> baz
  }
  action "foo" {
    compute "p" { v:bool := true }
    next { compute "q" { v:bool := true }  action = bar }
  }
  action "bar" {
    compute "p" { v:bool := true }
    next { compute "q" { v:bool := true }  action = baz }
  }
  action "baz" {
    compute "p" { v:bool := true }
  }
}
`
	if ds := pipeline(src); ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestOverviewChainContinuation(t *testing.T) {
	// §6.5: chain line sets current; subsequent |-> lines extend from the last chain element
	src := basicState + `
scene "test" {
  entry_action = analyze
  overview at_least {
    analyze |-> score |-> decide
    decide |-> approve
    decide |-> reject
  }
  action "analyze" {
    compute "p" { v:bool := true }
    next { compute "q" { v:bool := true }  action = score }
  }
  action "score" {
    compute "p" { v:bool := true }
    next { compute "q" { v:bool := true }  action = decide }
  }
  action "decide" {
    compute "p" { v:bool := true }
    next { compute "q" { v:bool := true }  action = approve }
    next { compute "r" { v:bool := true }  action = reject }
  }
  action "approve" {
    compute "p" { v:bool := true }
  }
  action "reject" {
    compute "p" { v:bool := true }
  }
}
`
	if ds := pipeline(src); ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestOverviewChainTargetNotInNodes(t *testing.T) {
	// The last chain element (baz) must NOT be in overview_nodes; strict mode
	// must require it to exist in impl_nodes via OVW_NODE_EXTRA when absent from flow.
	src := basicState + `
scene "test" {
  entry_action = foo
  overview strict {
    foo |-> bar |-> baz
    baz
  }
  action "foo" {
    compute "p" { v:bool := true }
    next { compute "q" { v:bool := true }  action = bar }
  }
  action "bar" {
    compute "p" { v:bool := true }
    next { compute "q" { v:bool := true }  action = baz }
  }
  action "baz" {
    compute "p" { v:bool := true }
  }
}
`
	if ds := pipeline(src); ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

func TestOverviewDuplicateView(t *testing.T) {
	src := basicState + `
scene "test" {
  entry_action = a
  overview nodes_only {
    a
  }
  overview nodes_only {
    a
  }
  action "a" {
    compute "p" { v:bool := true }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeOverviewDuplicate) {
		t.Error("want SCN_OVERVIEW_DUPLICATE")
	}
}

// ─── invalid enforce mode ─────────────────────────────────────────────────────

func TestOverviewInvalidMode(t *testing.T) {
	src := twoActionScene(`
  overview bogus {
    a
  }
`)
	if !hasCode(pipeline(src), diag.CodeOverviewInvalidMode) {
		t.Error("want SCN_OVERVIEW_INVALID_MODE")
	}
}

// ─── adventure story example ──────────────────────────────────────────────────

// TestOverviewAdventureStoryAtLeast runs the full adventure-story example file
// through the pipeline and expects no overview errors (the flow is at_least and
// matches the implementation exactly).
func TestOverviewAdventureStoryAtLeast(t *testing.T) {
	src := basicState + `
scene "s" {
  entry_action = a
  overview at_least {
    a |-> b
    a |-> c
    b |-> d
    c |-> d
    d
  }
  action "a" {
    compute "p" { v:bool := true }
    next { compute "q" { v:bool := true }  action = b }
    next { compute "r" { v:bool := true }  action = c }
  }
  action "b" {
    compute "p" { v:bool := true }
    next { compute "q" { v:bool := true }  action = d }
  }
  action "c" {
    compute "p" { v:bool := true }
    next { compute "q" { v:bool := true }  action = d }
  }
  action "d" {
    compute "p" { v:bool := true }
  }
}
`
	if ds := pipeline(src); ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

// ─── diagnostic positions ─────────────────────────────────────────────────────
//
// The overview block is parsed structurally, and the lowerer carries every node
// and edge into the model with its source position attached. These tests pin
// that the positions survive the trip: before they did, every overview
// diagnostic named the scene and left the author to find the line themselves.

// findCode returns the first diagnostic with the given code.
func findCode(ds diag.Diagnostics, code diag.ErrorCode) (diag.Diagnostic, bool) {
	for _, d := range ds {
		if d.Code == code {
			return d, true
		}
	}
	return diag.Diagnostic{}, false
}

// assertPositioned fails when the diagnostic carries no file/line/col.
func assertPositioned(t *testing.T, ds diag.Diagnostics, code diag.ErrorCode) diag.Diagnostic {
	t.Helper()
	d, ok := findCode(ds, code)
	if !ok {
		t.Fatalf("want a %s diagnostic, got: %v", code, ds)
	}
	if d.File == "" || d.Line == 0 {
		t.Errorf("%s has no source position: %s", code, d.Format())
	}
	return d
}

func TestOverviewUnknownNodeIsPositioned(t *testing.T) {
	src := twoActionScene(`
  overview nodes_only {
    a
    missing_action
  }
`)
	d := assertPositioned(t, pipeline(src), diag.CodeOverviewUnknownNode)
	// basicState is 8 lines, `scene` is line 9, `entry_action` line 10, the blank
	// line 11, `overview` line 12, `a` line 13, `missing_action` line 14.
	if d.Line != 14 {
		t.Errorf("line = %d, want 14 (the `missing_action` node line); got %s", d.Line, d.Format())
	}
}

func TestOverviewMissingEdgeIsPositionedAtTheArrow(t *testing.T) {
	src := twoActionScene(`
  overview at_least {
    a |-> b
    a |-> ghost
  }
`)
	d := assertPositioned(t, pipeline(src), diag.CodeOverviewMissingEdge)
	if d.Line != 14 {
		t.Errorf("line = %d, want 14 (the `a |-> ghost` line); got %s", d.Line, d.Format())
	}
	// The arrow, not the line start: `    a |-> ghost` puts `|->` at column 7.
	if d.Col != 7 {
		t.Errorf("col = %d, want 7 (the `|->` token); got %s", d.Col, d.Format())
	}
}

// Extra-node and extra-edge report something absent from the block, so they have
// no token of their own and anchor on the `overview` keyword instead.
func TestOverviewExtraNodeIsAnchoredAtTheBlock(t *testing.T) {
	src := twoActionScene(`
  overview strict {
    a
  }
`)
	d := assertPositioned(t, pipeline(src), diag.CodeOverviewExtraNode)
	if d.Line != 12 {
		t.Errorf("line = %d, want 12 (the `overview` keyword); got %s", d.Line, d.Format())
	}
}

func TestOverviewExtraEdgeIsAnchoredAtTheBlock(t *testing.T) {
	src := twoActionScene(`
  overview strict {
    a
    b
  }
`)
	d := assertPositioned(t, pipeline(src), diag.CodeOverviewExtraEdge)
	if d.Line != 12 {
		t.Errorf("line = %d, want 12 (the `overview` keyword); got %s", d.Line, d.Format())
	}
}

// A model carrying only ViewBlock.flow — hand-written, or produced before the
// structured graph existed — still validates. It just gets no positions, which
// is the best the flow string can offer.
func TestOverviewFallsBackToFlowStringWhenUnstructured(t *testing.T) {
	model := &turnoutpb.TurnModel{
		Scenes: []*turnoutpb.SceneBlock{{
			Id:          "s",
			EntryAction: "a",
			View: &turnoutpb.ViewBlock{
				Name:    "overview",
				Flow:    "a\nmissing_action\n",
				Enforce: proto.String("nodes_only"),
			},
			Actions: []*turnoutpb.ActionModel{{
				Id:      "a",
				Compute: &turnoutpb.ComputeModel{Root: "v", Prog: boolProg("p", "v")},
			}},
		}},
	}
	ds := validate.Validate(validate.ValidateInput{Model: model})
	d, ok := findCode(ds, diag.CodeOverviewUnknownNode)
	if !ok {
		t.Fatalf("want SCN_OVERVIEW_UNKNOWN_NODE from the flow-string fallback, got: %v", ds)
	}
	if d.File != "" {
		t.Errorf("flow-string fallback cannot know a position, got %s", d.Format())
	}
}

// An overview block with neither a structured graph nor flow text declared
// nothing at all, which is the empty-block error rather than a silent pass.
func TestOverviewEmptyBlockWithoutFlowIsReported(t *testing.T) {
	model := &turnoutpb.TurnModel{
		Scenes: []*turnoutpb.SceneBlock{{
			Id:          "s",
			EntryAction: "a",
			View: &turnoutpb.ViewBlock{
				Name:    "overview",
				Enforce: proto.String("nodes_only"),
			},
			Actions: []*turnoutpb.ActionModel{{
				Id:      "a",
				Compute: &turnoutpb.ComputeModel{Root: "v", Prog: boolProg("p", "v")},
			}},
		}},
	}
	if _, ok := findCode(validate.Validate(validate.ValidateInput{Model: model}), diag.CodeOverviewFlowEmpty); !ok {
		t.Error("want SCN_OVERVIEW_FLOW_EMPTY for a view with no graph and no flow")
	}
}

// ─── effect diagnostic positions ──────────────────────────────────────────────
//
// Prepare and merge entries are hoisted out of the compute block during
// lowering, so they arrive at the validator naming a binding without pointing at
// one. bindingInfo carries the binding's own position for exactly this reason.
// State type mismatches are among the most common authoring errors, so they are
// the ones that most need a line to point at.

func TestMergeTypeMismatchIsPositionedAtTheBinding(t *testing.T) {
	src := basicState + `
scene "s" {
  entry_action = a
  action "a" {
    compute "p" {
      flag:bool := (true) ~> @app.score
    }
  }
}
`
	d := assertPositioned(t, pipeline(src), diag.CodeStateTypeMismatch)
	// basicState is 8 lines; `scene` is 9, `entry_action` 10, `action` 11,
	// `compute` 12, and the offending binding is line 13.
	if d.Line != 13 {
		t.Errorf("line = %d, want 13 (the `flag:bool := ...` binding); got %s", d.Line, d.Format())
	}
}

func TestUnresolvedStatePathIsPositionedAtTheBinding(t *testing.T) {
	src := basicState + `
scene "s" {
  entry_action = a
  action "a" {
    compute "p" {
      flag:bool := (true) ~> @app.nope
    }
  }
}
`
	d := assertPositioned(t, pipeline(src), diag.CodeUnresolvedStatePath)
	if d.Line != 13 {
		t.Errorf("line = %d, want 13; got %s", d.Line, d.Format())
	}
}

// A binding with no recorded position must still produce the diagnostic, just
// without a location. Synthetic bindings and hand-written models hit this path.
func TestMergeTypeMismatchWithoutBindingPosition(t *testing.T) {
	src := basicState + `
scene "s" {
  entry_action = a
  action "a" {
    compute "p" {
      flag:bool := (true) ~> @app.score
    }
  }
}
`
	tf, ds := parser.ParseFile("test.tu", src)
	if ds.HasErrors() {
		t.Fatalf("parse: %v", ds)
	}
	lr, ds2 := lower.LowerResolvingState(tf, "")
	if ds2.HasErrors() {
		t.Fatalf("lower: %v", ds2)
	}

	// Strip the positions the lowerer attached, standing in for a model that was
	// hand-written or produced before bindings carried them.
	for _, scene := range lr.Model.Scenes {
		for _, action := range scene.Actions {
			for _, b := range action.GetCompute().GetProg().GetBindings() {
				b.SourcePos = nil
			}
		}
	}

	d, ok := findCode(validate.Validate(validate.ValidateInput{Model: lr.Model, Schema: lr.Schema}),
		diag.CodeStateTypeMismatch)
	if !ok {
		t.Fatal("the diagnostic must still fire without a position")
	}
	if d.File != "" || d.Line != 0 {
		t.Errorf("a binding with no position must not invent one, got %s", d.Format())
	}
	if d.Format() == "" {
		t.Error("the diagnostic must still be reportable without a position")
	}
}

package validate_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
)

// ─── helpers ──────────────────────────────────────────────────────────────────

// twoActionScene builds a minimal scene with two actions (a → b) and an optional
// view block injected just before the action declarations.
func twoActionScene(viewBlock string) string {
	return basicState + `
scene "test" {
  entry_actions = [a]
` + viewBlock + `
  action "a" {
    compute {
      prog "p" { |^| v:bool = true }
    }
    next {
      compute { prog "q" { |?| v:bool = true } }
      action = b
    }
  }
  action "b" {
    compute {
      prog "p" { |^| v:bool = true }
    }
  }
}
`
}

// ─── nodes_only ───────────────────────────────────────────────────────────────

func TestOverviewNodesOnlyValid(t *testing.T) {
	src := twoActionScene(`
  overview nodes_only {
    a |=> b
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
  entry_actions = [a]
  overview nodes_only {
    a |=> b
  }
  action "a" {
    compute { prog "p" { |^| v:bool = true } }
  }
  action "b" {
    compute { prog "p" { |^| v:bool = true } }
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
    a |=> b
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
  entry_actions = [a]
  overview at_least {
    a |=> b
  }
  action "a" {
    compute { prog "p" { |^| v:bool = true } }
  }
  action "b" {
    compute { prog "p" { |^| v:bool = true } }
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
  entry_actions = [a]
  overview at_least {
    a |=> b
  }
  action "a" {
    compute { prog "p" { |^| v:bool = true } }
    next {
      compute { prog "q" { |?| v:bool = true } }
      action = b
    }
    next {
      compute { prog "r" { |?| v:bool = true } }
      action = c
    }
  }
  action "b" {
    compute { prog "p" { |^| v:bool = true } }
  }
  action "c" {
    compute { prog "p" { |^| v:bool = true } }
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
    a |=> b
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
  entry_actions = [a]
  overview strict {
    a |=> b
    b
  }
  action "a" {
    compute { prog "p" { |^| v:bool = true } }
    next {
      compute { prog "q" { |?| v:bool = true } }
      action = b
    }
  }
  action "b" {
    compute { prog "p" { |^| v:bool = true } }
  }
  action "c" {
    compute { prog "p" { |^| v:bool = true } }
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
  entry_actions = [a]
  overview strict {
    a |=> b
    b
    c
  }
  action "a" {
    compute { prog "p" { |^| v:bool = true } }
    next {
      compute { prog "q" { |?| v:bool = true } }
      action = b
    }
    next {
      compute { prog "r" { |?| v:bool = true } }
      action = c
    }
  }
  action "b" {
    compute { prog "p" { |^| v:bool = true } }
  }
  action "c" {
    compute { prog "p" { |^| v:bool = true } }
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
    |=> b
  }
`)
	if !hasCode(pipeline(src), diag.CodeParseSyntaxError) {
		t.Error("want a parse error for an edge with no source")
	}
}

func TestOverviewBadEdgeTarget(t *testing.T) {
	src := twoActionScene(`
  overview nodes_only {
    a |=> 123bad
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
    a |=>
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
    a |=> 123bad
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
	// §6.4: foo |=> bar |=> baz parses as nodes={foo,bar}, edges={(foo,bar),(bar,baz)}, current=baz
	src := basicState + `
scene "test" {
  entry_actions = [foo]
  overview at_least {
    foo |=> bar |=> baz
  }
  action "foo" {
    compute { prog "p" { |^| v:bool = true } }
    next { compute { prog "q" { |?| v:bool = true } }  action = bar }
  }
  action "bar" {
    compute { prog "p" { |^| v:bool = true } }
    next { compute { prog "q" { |?| v:bool = true } }  action = baz }
  }
  action "baz" {
    compute { prog "p" { |^| v:bool = true } }
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
	// §6.5: chain line sets current; subsequent |=> lines extend from the last chain element
	src := basicState + `
scene "test" {
  entry_actions = [analyze]
  overview at_least {
    analyze |=> score |=> decide
    decide |=> approve
    decide |=> reject
  }
  action "analyze" {
    compute { prog "p" { |^| v:bool = true } }
    next { compute { prog "q" { |?| v:bool = true } }  action = score }
  }
  action "score" {
    compute { prog "p" { |^| v:bool = true } }
    next { compute { prog "q" { |?| v:bool = true } }  action = decide }
  }
  action "decide" {
    compute { prog "p" { |^| v:bool = true } }
    next { compute { prog "q" { |?| v:bool = true } }  action = approve }
    next { compute { prog "r" { |?| v:bool = true } }  action = reject }
  }
  action "approve" {
    compute { prog "p" { |^| v:bool = true } }
  }
  action "reject" {
    compute { prog "p" { |^| v:bool = true } }
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
  entry_actions = [foo]
  overview strict {
    foo |=> bar |=> baz
    baz
  }
  action "foo" {
    compute { prog "p" { |^| v:bool = true } }
    next { compute { prog "q" { |?| v:bool = true } }  action = bar }
  }
  action "bar" {
    compute { prog "p" { |^| v:bool = true } }
    next { compute { prog "q" { |?| v:bool = true } }  action = baz }
  }
  action "baz" {
    compute { prog "p" { |^| v:bool = true } }
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
  entry_actions = [a]
  overview nodes_only {
    a
  }
  overview nodes_only {
    a
  }
  action "a" {
    compute { prog "p" { |^| v:bool = true } }
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
  entry_actions = [a]
  overview at_least {
    a |=> b
    a |=> c
    b |=> d
    c |=> d
    d
  }
  action "a" {
    compute { prog "p" { |^| v:bool = true } }
    next { compute { prog "q" { |?| v:bool = true } }  action = b }
    next { compute { prog "r" { |?| v:bool = true } }  action = c }
  }
  action "b" {
    compute { prog "p" { |^| v:bool = true } }
    next { compute { prog "q" { |?| v:bool = true } }  action = d }
  }
  action "c" {
    compute { prog "p" { |^| v:bool = true } }
    next { compute { prog "q" { |?| v:bool = true } }  action = d }
  }
  action "d" {
    compute { prog "p" { |^| v:bool = true } }
  }
}
`
	if ds := pipeline(src); ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

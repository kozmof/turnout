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
  entry_actions = ["a"]
` + viewBlock + `
  action "a" {
    compute {
      root = v
      prog "p" { v:bool = true }
    }
    next {
      compute { condition = v  prog "q" { v:bool = true } }
      action = b
    }
  }
  action "b" {
    compute {
      root = v
      prog "p" { v:bool = true }
    }
  }
}
`
}

// ─── nodes_only ───────────────────────────────────────────────────────────────

func TestOverviewNodesOnlyValid(t *testing.T) {
	src := twoActionScene(`
  view "overview" {
    flow = <<-EOT
      a
        |=> b
    EOT
    enforce = "nodes_only"
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
  view "overview" {
    flow = <<-EOT
      a
      missing_action
    EOT
    enforce = "nodes_only"
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
  entry_actions = ["a"]
  view "overview" {
    flow = <<-EOT
      a
        |=> b
    EOT
    enforce = "nodes_only"
  }
  action "a" {
    compute { root = v  prog "p" { v:bool = true } }
  }
  action "b" {
    compute { root = v  prog "p" { v:bool = true } }
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
  view "overview" {
    flow = <<-EOT
      a
        |=> b
    EOT
    enforce = "at_least"
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
  entry_actions = ["a"]
  view "overview" {
    flow = <<-EOT
      a
        |=> b
    EOT
    enforce = "at_least"
  }
  action "a" {
    compute { root = v  prog "p" { v:bool = true } }
  }
  action "b" {
    compute { root = v  prog "p" { v:bool = true } }
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
  entry_actions = ["a"]
  view "overview" {
    flow = <<-EOT
      a
        |=> b
    EOT
    enforce = "at_least"
  }
  action "a" {
    compute { root = v  prog "p" { v:bool = true } }
    next {
      compute { condition = v  prog "q" { v:bool = true } }
      action = b
    }
    next {
      compute { condition = v  prog "r" { v:bool = true } }
      action = c
    }
  }
  action "b" {
    compute { root = v  prog "p" { v:bool = true } }
  }
  action "c" {
    compute { root = v  prog "p" { v:bool = true } }
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
  view "overview" {
    flow = <<-EOT
      a
        |=> b
      b
    EOT
    enforce = "strict"
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
  entry_actions = ["a"]
  view "overview" {
    flow = <<-EOT
      a
        |=> b
      b
    EOT
    enforce = "strict"
  }
  action "a" {
    compute { root = v  prog "p" { v:bool = true } }
    next {
      compute { condition = v  prog "q" { v:bool = true } }
      action = b
    }
  }
  action "b" {
    compute { root = v  prog "p" { v:bool = true } }
  }
  action "c" {
    compute { root = v  prog "p" { v:bool = true } }
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
  entry_actions = ["a"]
  view "overview" {
    flow = <<-EOT
      a
        |=> b
      b
      c
    EOT
    enforce = "strict"
  }
  action "a" {
    compute { root = v  prog "p" { v:bool = true } }
    next {
      compute { condition = v  prog "q" { v:bool = true } }
      action = b
    }
    next {
      compute { condition = v  prog "r" { v:bool = true } }
      action = c
    }
  }
  action "b" {
    compute { root = v  prog "p" { v:bool = true } }
  }
  action "c" {
    compute { root = v  prog "p" { v:bool = true } }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeOverviewExtraEdge) {
		t.Error("want SCN_OVERVIEW_EXTRA_EDGE")
	}
}

// ─── parse errors ─────────────────────────────────────────────────────────────

func TestOverviewParseErrorEdgeBeforeNode(t *testing.T) {
	src := twoActionScene(`
  view "overview" {
    flow = <<-EOT
      |=> b
    EOT
    enforce = "nodes_only"
  }
`)
	if !hasCode(pipeline(src), diag.CodeOverviewEdgeWithoutSource) {
		t.Error("want SCN_OVERVIEW_EDGE_WITHOUT_SOURCE")
	}
}

func TestOverviewParseErrorBadIdent(t *testing.T) {
	src := twoActionScene(`
  view "overview" {
    flow = <<-EOT
      a
        |=> 123bad
    EOT
    enforce = "nodes_only"
  }
`)
	if !hasCode(pipeline(src), diag.CodeOverviewInvalidIdent) {
		t.Error("want SCN_OVERVIEW_INVALID_IDENT")
	}
}

func TestOverviewFlowEmpty(t *testing.T) {
	src := twoActionScene(`
  view "overview" {
    flow = "   "
    enforce = "nodes_only"
  }
`)
	if !hasCode(pipeline(src), diag.CodeOverviewFlowEmpty) {
		t.Error("want SCN_OVERVIEW_FLOW_EMPTY")
	}
}

func TestOverviewEdgeNoTarget(t *testing.T) {
	src := twoActionScene(`
  view "overview" {
    flow = <<-EOT
      a
        |=>
    EOT
    enforce = "nodes_only"
  }
`)
	if !hasCode(pipeline(src), diag.CodeOverviewEdgeNoTarget) {
		t.Error("want SCN_OVERVIEW_EDGE_NO_TARGET")
	}
}

func TestOverviewChainNoTarget(t *testing.T) {
	src := twoActionScene(`
  view "overview" {
    flow = <<-EOT
      a |=>
    EOT
    enforce = "nodes_only"
  }
`)
	if !hasCode(pipeline(src), diag.CodeOverviewChainNoTarget) {
		t.Error("want SCN_OVERVIEW_CHAIN_NO_TARGET")
	}
}

func TestOverviewChainLinear(t *testing.T) {
	// §6.4: foo |=> bar |=> baz parses as nodes={foo,bar}, edges={(foo,bar),(bar,baz)}, current=baz
	src := basicState + `
scene "test" {
  entry_actions = ["foo"]
  view "overview" {
    flow = <<-EOT
      foo |=> bar |=> baz
    EOT
    enforce = "at_least"
  }
  action "foo" {
    compute { root = v  prog "p" { v:bool = true } }
    next { compute { condition = v  prog "q" { v:bool = true } }  action = bar }
  }
  action "bar" {
    compute { root = v  prog "p" { v:bool = true } }
    next { compute { condition = v  prog "q" { v:bool = true } }  action = baz }
  }
  action "baz" {
    compute { root = v  prog "p" { v:bool = true } }
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
  entry_actions = ["analyze"]
  view "overview" {
    flow = <<-EOT
      analyze |=> score |=> decide
        |=> approve
        |=> reject
    EOT
    enforce = "at_least"
  }
  action "analyze" {
    compute { root = v  prog "p" { v:bool = true } }
    next { compute { condition = v  prog "q" { v:bool = true } }  action = score }
  }
  action "score" {
    compute { root = v  prog "p" { v:bool = true } }
    next { compute { condition = v  prog "q" { v:bool = true } }  action = decide }
  }
  action "decide" {
    compute { root = v  prog "p" { v:bool = true } }
    next { compute { condition = v  prog "q" { v:bool = true } }  action = approve }
    next { compute { condition = v  prog "r" { v:bool = true } }  action = reject }
  }
  action "approve" {
    compute { root = v  prog "p" { v:bool = true } }
  }
  action "reject" {
    compute { root = v  prog "p" { v:bool = true } }
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
  entry_actions = ["foo"]
  view "overview" {
    flow = <<-EOT
      foo |=> bar |=> baz
      baz
    EOT
    enforce = "strict"
  }
  action "foo" {
    compute { root = v  prog "p" { v:bool = true } }
    next { compute { condition = v  prog "q" { v:bool = true } }  action = bar }
  }
  action "bar" {
    compute { root = v  prog "p" { v:bool = true } }
    next { compute { condition = v  prog "q" { v:bool = true } }  action = baz }
  }
  action "baz" {
    compute { root = v  prog "p" { v:bool = true } }
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
  entry_actions = ["a"]
  view "overview" {
    flow = <<-EOT
      a
    EOT
    enforce = "nodes_only"
  }
  view "overview" {
    flow = <<-EOT
      a
    EOT
    enforce = "nodes_only"
  }
  action "a" {
    compute { root = v  prog "p" { v:bool = true } }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeOverviewDuplicate) {
		t.Error("want SCN_OVERVIEW_DUPLICATE")
	}
}

func TestOverviewUnknownViewName(t *testing.T) {
	src := basicState + `
scene "test" {
  entry_actions = ["a"]
  view "sidebar" {
    flow = <<-EOT
      a
    EOT
    enforce = "nodes_only"
  }
  action "a" {
    compute { root = v  prog "p" { v:bool = true } }
  }
}
`
	if !hasCode(pipeline(src), diag.CodeOverviewUnknownView) {
		t.Error("want SCN_OVERVIEW_UNKNOWN_VIEW")
	}
}

// ─── invalid enforce mode ─────────────────────────────────────────────────────

func TestOverviewInvalidMode(t *testing.T) {
	src := twoActionScene(`
  view "overview" {
    flow = <<-EOT
      a
    EOT
    enforce = "bogus"
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
  entry_actions = ["a"]
  view "overview" {
    flow = <<-EOT
      a
        |=> b
        |=> c
      b
        |=> d
      c
        |=> d
      d
    EOT
    enforce = "at_least"
  }
  action "a" {
    compute { root = v  prog "p" { v:bool = true } }
    next { compute { condition = v  prog "q" { v:bool = true } }  action = b }
    next { compute { condition = v  prog "r" { v:bool = true } }  action = c }
  }
  action "b" {
    compute { root = v  prog "p" { v:bool = true } }
    next { compute { condition = v  prog "q" { v:bool = true } }  action = d }
  }
  action "c" {
    compute { root = v  prog "p" { v:bool = true } }
    next { compute { condition = v  prog "q" { v:bool = true } }  action = d }
  }
  action "d" {
    compute { root = v  prog "p" { v:bool = true } }
  }
}
`
	if ds := pipeline(src); ds.HasErrors() {
		for _, d := range ds {
			t.Errorf("unexpected error: %s", d.Format())
		}
	}
}

package parser_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
)

// overviewOf parses a scene carrying the given overview block and returns it.
func overviewOf(t *testing.T, block string) *ast.ViewBlock {
	t.Helper()
	tf := mustParse(t, minimalTurnFile(block+`
  action "a" {
    compute "p" { v:bool := true }
  }`))
	return tf.Scenes[0].View
}

// TestOverviewBlockChain covers the chain form: `a |=> b |=> c` wires
// sequentially and every segment but the last becomes a node, matching the
// heredoc flow rules that migrated files rely on (NEW_SYNTAX.md 2.2).
func TestOverviewBlockChain(t *testing.T) {
	v := overviewOf(t, `  overview strict {
    a |=> b |=> c
  }`)
	if v == nil {
		t.Fatal("overview block is nil")
	}
	if v.Enforce != "strict" {
		t.Errorf("enforce = %q, want strict", v.Enforce)
	}
	if len(v.Edges) != 2 {
		t.Fatalf("edges = %v, want a→b and b→c", v.Edges)
	}
	if v.Edges[0].From != "a" || v.Edges[0].To != "b" {
		t.Errorf("edge[0] = %v, want a→b", v.Edges[0])
	}
	if v.Edges[1].From != "b" || v.Edges[1].To != "c" {
		t.Errorf("edge[1] = %v, want b→c", v.Edges[1])
	}
	// The final segment is a target, not a declared node.
	if len(v.Nodes) != 2 || v.Nodes[0] != "a" || v.Nodes[1] != "b" {
		t.Errorf("nodes = %v, want [a b]", v.Nodes)
	}
}

// TestOverviewBlockBareNode covers a node statement with no outgoing edge, which
// is how a terminal action gets into the strict-mode contract.
func TestOverviewBlockBareNode(t *testing.T) {
	v := overviewOf(t, `  overview nodes_only {
    a |=> b
    b
  }`)
	if len(v.Nodes) != 2 || v.Nodes[1] != "b" {
		t.Errorf("nodes = %v, want [a b]", v.Nodes)
	}
}

// TestOverviewBlockDedup covers the dedup of repeated nodes and edges.
func TestOverviewBlockDedup(t *testing.T) {
	v := overviewOf(t, `  overview nodes_only {
    a |=> b
    a |=> b
    a
  }`)
	if len(v.Edges) != 1 {
		t.Errorf("edges = %v, want one after dedup", v.Edges)
	}
	if len(v.Nodes) != 1 {
		t.Errorf("nodes = %v, want [a] after dedup", v.Nodes)
	}
}

// TestOverviewBlockNoMode covers omitting the enforce mode; the validator then
// rejects the empty mode rather than the parser.
func TestOverviewBlockNoMode(t *testing.T) {
	v := overviewOf(t, `  overview {
    a |=> b
  }`)
	if v.Enforce != "" {
		t.Errorf("enforce = %q, want empty", v.Enforce)
	}
	if len(v.Edges) != 1 {
		t.Errorf("edges = %v, want one", v.Edges)
	}
}

// TestOverviewBlockNonIdentStatement covers the recovery path for a statement
// that does not begin with an action name.
func TestOverviewBlockNonIdentStatement(t *testing.T) {
	mustParseFail(t, minimalTurnFile(`  overview strict {
    42
  }
  action "a" {
    compute "p" { v:bool := true }
  }`))
}

// TestOverviewBlockMissingBrace covers the missing-open-brace recovery path.
func TestOverviewBlockMissingBrace(t *testing.T) {
	mustParseFail(t, minimalTurnFile(`  overview strict
  action "a" {
    compute "p" { v:bool := true }
  }`))
}

// TestEntryActionBareAndQuoted covers the entry_action reference: it is a bare
// identifier as of v2 (NEW_SYNTAX.md 2.3), with the quoted form still accepted
// for one release.
func TestEntryActionBareAndQuoted(t *testing.T) {
	for _, ref := range []string{`a`, `"a"`} {
		tf := mustParse(t, `state { ns { val:number = 0 } }
scene "test" {
  entry_action = `+ref+`
  action "a" { compute "p" { v:bool := true } }
}
`)
		if got := tf.Scenes[0].EntryAction; got != "a" {
			t.Errorf("%s: entry_action = %q, want %q", ref, got, "a")
		}
	}
}

// TestEntryActionRejectsNonReference covers parseRefVal's error branch.
func TestEntryActionRejectsNonReference(t *testing.T) {
	mustParseFail(t, `state { ns { val:number = 0 } }
scene "test" {
  entry_action = 42
  action "a" { compute "p" { v:bool := true } }
}
`)
}

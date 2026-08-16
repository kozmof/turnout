package lower_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/names"
	"google.golang.org/protobuf/proto"
)

// TestLowerNestedInfix covers NEW_SYNTAX.md 1.1: a multi-operator expression
// flattens to one binding per operator, temps first, with the user's name on the
// final binding. `x + y + z` associates left, so the inner `x + y` becomes a
// generated binding that the outer add references.
func TestLowerNestedInfix(t *testing.T) {
	tm := mustLower(t, minimal(`  entry_actions = [a]
  action "a" {
    compute "p" {
      x:number = 1
      y:number = 2
      z:number = 3
      out:number := x + y + z
    }
  }`))
	bs := tm.Scenes[0].Actions[0].Compute.Prog.Bindings
	if len(bs) != 5 {
		t.Fatalf("binding count = %d, want 5 (x, y, z, one temp, out)", len(bs))
	}
	tmp := bs[3]
	if !names.IsGeneratedLocalName(tmp.Name) {
		t.Errorf("bindings[3] = %q, want a generated local name", tmp.Name)
	}
	if tmp.Expr.Combine.Args[0].GetRef() != "x" {
		t.Errorf("temp arg0 = %v, want x", tmp.Expr.Combine.Args[0])
	}
	out := bs[4]
	if out.Name != "out" {
		t.Fatalf("bindings[4] = %q, want out", out.Name)
	}
	if out.Expr.Combine.Args[0].GetRef() != tmp.Name || out.Expr.Combine.Args[1].GetRef() != "z" {
		t.Errorf("out args = %v, want (temp, z)", out.Expr.Combine.Args)
	}
}

// TestLowerNestedInfixPrecedence checks the tighter-binding operator is the one
// lowered into a temp.
func TestLowerNestedInfixPrecedence(t *testing.T) {
	tm := mustLower(t, minimal(`  entry_actions = [a]
  action "a" {
    compute "p" {
      x:number = 1
      y:number = 2
      z:number = 3
      out:number := x + y * z
    }
  }`))
	bs := tm.Scenes[0].Actions[0].Compute.Prog.Bindings
	if bs[3].Expr.Combine.Fn != "mul" {
		t.Errorf("temp fn = %q, want mul", bs[3].Expr.Combine.Fn)
	}
	if bs[4].Expr.Combine.Fn != "add" || bs[4].Expr.Combine.Args[0].GetRef() != "x" {
		t.Errorf("out = %v, want add(x, temp)", bs[4].Expr.Combine)
	}
}

// TestLowerSingleInfixUnchanged is the counterpart to the parser normalization
// test: a single-operator expression still lowers to exactly one binding.
func TestLowerSingleInfixUnchanged(t *testing.T) {
	tm := mustLower(t, minimal(`  entry_actions = [a]
  action "a" {
    compute "p" {
      x:number = 1
      y:number = 2
      out:number := x + y
    }
  }`))
	bs := tm.Scenes[0].Actions[0].Compute.Prog.Bindings
	if len(bs) != 3 {
		t.Fatalf("binding count = %d, want 3 (no temps for one operator)", len(bs))
	}
	if bs[2].Expr.Combine.Args[0].GetRef() != "x" || bs[2].Expr.Combine.Args[1].GetRef() != "y" {
		t.Errorf("operands were not inlined: %v", bs[2].Expr.Combine.Args)
	}
}

// TestLowerStandaloneTransformMatchesPlusZero covers 1.3: the standalone form
// lowers to exactly what the `+ 0` idiom it retires produced, so migrating a
// file cannot change its graph.
func TestLowerStandaloneTransformMatchesPlusZero(t *testing.T) {
	prog := func(expr string) string {
		return minimal(`  entry_actions = [a]
  action "a" {
    compute "p" {
      rate:number = 1
      out:number := ` + expr + `
    }
  }`)
	}
	got := binding(t, mustLower(t, prog(`rate.floor()`)), 1)
	want := binding(t, mustLower(t, prog(`rate.floor() + 0`)), 1)
	if !proto.Equal(got, want) {
		t.Errorf("standalone transform lowered differently from `+ 0`:\n got: %v\nwant: %v", got, want)
	}
	if got.Expr.Combine.Args[0].GetTransform() == nil {
		t.Errorf("arg0 = %v, want a transform arg", got.Expr.Combine.Args[0])
	}
}

// TestLowerNextSugarMatchesBlockForm covers 1.4: `next cond -> X` lowers to the
// same NextRuleModel as the block form, apart from the generated names.
func TestLowerNextSugarMatchesBlockForm(t *testing.T) {
	body := func(next string) string {
		return minimal(`  entry_actions = [a]
  action "a" {
    compute "p" {
      ready:bool := true
    }
` + next + `
  }
  action "b" {
    compute "q" { done:bool := true }
  }`)
	}
	sugar := mustLower(t, body(`    next ready -> b`))
	block := mustLower(t, body(`    next {
      compute "to_b" {
        ready:bool
        go_b:bool := ready
      }
      prepare {
        ready { from_action = ready }
      }
      action = b
    }`))

	sr := sugar.Scenes[0].Actions[0].Next[0]
	br := block.Scenes[0].Actions[0].Next[0]
	if sr.Action != br.Action {
		t.Errorf("action = %q, want %q", sr.Action, br.Action)
	}
	if len(sr.Compute.Prog.Bindings) != len(br.Compute.Prog.Bindings) {
		t.Fatalf("binding count = %d, want %d", len(sr.Compute.Prog.Bindings), len(br.Compute.Prog.Bindings))
	}
	if sr.Compute.Condition != sr.Compute.Prog.Bindings[1].Name {
		t.Errorf("condition %q does not name the result binding", sr.Compute.Condition)
	}
	if !names.IsGeneratedLocalName(sr.Compute.Condition) {
		t.Errorf("condition = %q, want a generated name", sr.Compute.Condition)
	}
	if len(sr.Prepare) != 1 || sr.Prepare[0].GetFromAction() != "ready" {
		t.Errorf("prepare = %v, want one from_action=ready entry", sr.Prepare)
	}
}

// TestLowerNextSugarUnconditional covers `next <action>`, which carries no
// compute block — the canonical shape for an unconditional transition.
func TestLowerNextSugarUnconditional(t *testing.T) {
	tm := mustLower(t, minimal(`  entry_actions = [a]
  action "a" {
    compute "p" { ready:bool := true }
    next b
  }
  action "b" {
    compute "q" { done:bool := true }
  }`))
	r := tm.Scenes[0].Actions[0].Next[0]
	if r.Action != "b" || r.Compute != nil {
		t.Errorf("rule = %+v, want a bare transition to b", r)
	}
}

// TestLowerOverviewFlowText covers 2.2: the structured overview block is
// serialized back to the canonical flow string the model still carries. Edges
// come first, then any node with no outgoing edge, so nodes_only enforcement
// still sees terminal actions.
func TestLowerOverviewFlowText(t *testing.T) {
	tm := mustLower(t, minimal(`  entry_actions = [a]
  overview strict {
    a |=> b
    b
  }
  action "a" {
    compute "p" { v:bool := true }
    next b
  }
  action "b" {
    compute "q" { v:bool := true }
  }`))
	v := tm.Scenes[0].View
	if v == nil {
		t.Fatal("view is nil")
	}
	if got, want := v.Flow, "a |=> b\nb\n"; got != want {
		t.Errorf("flow = %q, want %q", got, want)
	}
	if v.Enforce == nil || *v.Enforce != "strict" {
		t.Errorf("enforce = %v, want strict", v.Enforce)
	}
}

// TestLowerOverviewFlowTextEdgesOnly covers the branch where every node is an
// edge source, so no bare node lines are appended.
func TestLowerOverviewFlowTextEdgesOnly(t *testing.T) {
	tm := mustLower(t, minimal(`  entry_actions = [a]
  overview at_least {
    a |=> b
  }
  action "a" {
    compute "p" { v:bool := true }
    next b
  }
  action "b" {
    compute "q" { v:bool := true }
  }`))
	if got, want := tm.Scenes[0].View.Flow, "a |=> b\n"; got != want {
		t.Errorf("flow = %q, want %q", got, want)
	}
}

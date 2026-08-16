package lower_test

import (
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/lower"
	"github.com/kozmof/turnout/packages/go/converter/internal/parser"
)

func TestAnonymousEgressLowersToSyntheticBindingAndMerge(t *testing.T) {
	src := `state { billing { total:number = 0 } }
scene "s" {
  entry_actions = [a]
  action "a" {
    compute "p" {
      foo:number = 1
      bar:number = 2
      (foo + bar) ~> @billing.total
      done:bool := true
    }
  }
}`
	tf, parseDs := parser.ParseFile("test.tu", src)
	if parseDs.HasErrors() {
		t.Fatalf("parse failed: %v", parseDs)
	}
	lr, lowerDs := lower.LowerResolvingState(tf, "")
	if lowerDs.HasErrors() {
		t.Fatalf("lower failed: %v", lowerDs)
	}
	a := lr.Model.Scenes[0].Actions[0]
	var found bool
	for _, b := range a.Compute.Prog.Bindings {
		if b.Name == "__egress_1" {
			found = true
			if b.Type != ast.FieldTypeNumber.ProtoString() || b.Expr == nil {
				t.Fatalf("synthetic binding = %#v", b)
			}
		}
	}
	if !found {
		t.Fatal("missing __egress_1 binding")
	}
	if len(a.Merge) != 1 || a.Merge[0].Binding != "__egress_1" || a.Merge[0].ToState != "billing.total" {
		t.Fatalf("merge = %#v", a.Merge)
	}
}

func TestAnonymousEgressInTransitionRejected(t *testing.T) {
	src := `state { app { active:bool = false } }
scene "s" {
  entry_actions = [a]
  action "a" {
    compute "p" { done:bool := true }
    next {
      compute "n" {
        (true) ~> @app.active
        go:bool := true
      }
      action = b
    }
  }
  action "b" { compute "q" { done:bool := true } }
}`
	tf, parseDs := parser.ParseFile("test.tu", src)
	if parseDs.HasErrors() {
		t.Fatalf("parse failed: %v", parseDs)
	}
	_, lowerDs := lower.LowerResolvingState(tf, "")
	found := false
	for _, d := range lowerDs {
		if d.Code == diag.CodeTransitionOutputSigil {
			found = true
		}
	}
	if !found {
		t.Fatalf("want TransitionOutputSigil, got %v", lowerDs)
	}
}

package lower_test

import (
	"fmt"
	"slices"
	"testing"

	"github.com/kozmof/turnout/packages/go/converter/internal/ast"
	"github.com/kozmof/turnout/packages/go/converter/internal/diag"
	"github.com/kozmof/turnout/packages/go/converter/internal/emit/turnoutpb"
	"github.com/kozmof/turnout/packages/go/converter/internal/lower"
	"github.com/kozmof/turnout/packages/go/converter/internal/names"
	"github.com/kozmof/turnout/packages/go/converter/internal/parser"
	"google.golang.org/protobuf/proto"
)

func TestAnonymousEgressLowersToSyntheticBindingAndMerge(t *testing.T) {
	src := `state { billing { total:number = 0 } }
scene "s" {
  entry_action = a
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
  entry_action = a
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

// ─── promoted result: a trailing anonymous egress ────────────────────────────

// TestPromotedResultLowersLikeANamedResult is the equivalence claim of the
// shorthand: `(true) ~> @app.paged` as the last item of an action compute block
// produces the model a named `:=` result produces, with `__result` where the
// author's name would have been — as the binding, the merge entry, and the root.
func TestPromotedResultLowersLikeANamedResult(t *testing.T) {
	const body = `state { app { paged:bool = false } }
scene "s" {
  entry_action = a
  action "a" {
    compute "p" {
%s
    }
  }
}`
	shorthand := loneAction(t, fmt.Sprintf(body, `      (true) ~> @app.paged`))
	explicit := loneAction(t, fmt.Sprintf(body, `      watched:bool := (true) ~> @app.paged`))

	if shorthand.Compute.Root != names.GeneratedResultName {
		t.Errorf("root = %q, want %q", shorthand.Compute.Root, names.GeneratedResultName)
	}
	if explicit.Compute.Root != "watched" {
		t.Fatalf("explicit root = %q, want watched", explicit.Compute.Root)
	}

	// Rename the explicit form's binding to the generated name everywhere the model
	// carries it — the binding, the root, the merge entry, and the prog's sigil map
	// key. From there the two models must be identical, which is what "modulo the
	// name" means.
	explicit.Compute.Root = names.GeneratedResultName
	for _, b := range explicit.Compute.Prog.Bindings {
		if b.Name == "watched" {
			b.Name = names.GeneratedResultName
		}
	}
	for _, m := range explicit.Merge {
		if m.Binding == "watched" {
			m.Binding = names.GeneratedResultName
		}
	}
	if sigil, ok := explicit.Compute.Prog.Sigils["watched"]; ok {
		delete(explicit.Compute.Prog.Sigils, "watched")
		explicit.Compute.Prog.Sigils[names.GeneratedResultName] = sigil
	}
	if !proto.Equal(explicit, shorthand) {
		t.Errorf("promoted result differs from the named form\nexplicit:  %v\nshorthand: %v", explicit, shorthand)
	}
}

// TestPromotedResultTypeComesFromDestination covers the one thing the shorthand
// cannot get from the source line: the binding has no type annotation, so the
// destination STATE field supplies it.
func TestPromotedResultTypeComesFromDestination(t *testing.T) {
	a := loneAction(t, `state { app { total:number = 0 } }
scene "s" {
  entry_action = a
  action "a" {
    compute "p" {
      (7) ~> @app.total
    }
  }
}`)
	for _, b := range a.Compute.Prog.Bindings {
		if b.Name == names.GeneratedResultName {
			if b.Type != ast.FieldTypeNumber.ProtoString() {
				t.Fatalf("promoted binding type = %q, want number", b.Type)
			}
			return
		}
	}
	t.Fatalf("no %q binding in %#v", names.GeneratedResultName, a.Compute.Prog.Bindings)
}

// TestPromotedResultStaysOutOfEgressNumbering is what pays for the dedicated
// name: the result keeps it however many writes precede it, so inserting a write
// above the result renames nothing. With the result drawn from the __egress_N
// sequence instead, every name below the insertion would shift.
func TestPromotedResultStaysOutOfEgressNumbering(t *testing.T) {
	const body = `state {
  app {
    note:str = ""
    paged:bool = false
  }
}
scene "s" {
  entry_action = a
  action "a" {
    compute "p" {
%s      (true) ~> @app.paged
    }
  }
}`
	before := loneAction(t, fmt.Sprintf(body, `      ("one") ~> @app.note
`))
	after := loneAction(t, fmt.Sprintf(body, `      ("zero") ~> @app.note
      ("one") ~> @app.note
`))

	if got := bindingNames(before); !slices.Contains(got, "__egress_1") || slices.Contains(got, "__egress_2") {
		t.Errorf("one write above the result: names = %v, want __egress_1 only", got)
	}
	if got := bindingNames(after); !slices.Contains(got, "__egress_2") {
		t.Errorf("two writes above the result: names = %v, want __egress_2 present", got)
	}
	for _, a := range []*turnoutpb.ActionModel{before, after} {
		if a.Compute.Root != names.GeneratedResultName {
			t.Errorf("root = %q, want %q regardless of the writes above it", a.Compute.Root, names.GeneratedResultName)
		}
	}
}

// loneAction lowers src and returns its single action.
func loneAction(t *testing.T, src string) *turnoutpb.ActionModel {
	t.Helper()
	return mustLower(t, src).Scenes[0].Actions[0]
}

func bindingNames(a *turnoutpb.ActionModel) []string {
	out := make([]string, 0, len(a.Compute.Prog.Bindings))
	for _, b := range a.Compute.Prog.Bindings {
		out = append(out, b.Name)
	}
	return out
}
